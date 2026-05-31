import { validateToolCall } from "@mariozechner/pi-ai";
import type { Tool as PiAiTool, ToolCall } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import type {
  RegisteredTool,
  RuntimeMode,
  Tool,
  ToolContext,
  ToolEntry,
  ToolExecutor,
  ToolMode,
  ToolResult,
  ToolScope,
} from "./types.js";
import type { EmbeddingProvider } from "../../memory/embeddings/provider.js";
import type { ModulePermissions } from "./module-permissions.js";
import { TOOL_EXECUTION_TIMEOUT_MS } from "../../constants/timeouts.js";
import type Database from "better-sqlite3";
import {
  loadAllToolConfigs,
  initializeToolConfig,
  saveToolConfig,
  type ToolConfig,
} from "../../memory/tool-config.js";
import type { ToolIndex } from "./tool-index.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Registry");

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private scopes: Map<string, ToolScope> = new Map();
  private toolModules: Map<string, string> = new Map();
  private permissions: ModulePermissions | null = null;
  private toolArrayCache: PiAiTool[] | null = null;
  private toolConfigs: Map<string, ToolConfig> = new Map(); // Runtime tool configurations
  private db: Database.Database | null = null;
  private pluginToolNames: Map<string, string[]> = new Map();
  private toolIndex: ToolIndex | null = null;
  private embedderRef: EmbeddingProvider | null = null;
  private onToolsChangedCallbacks: Array<(removed: string[], added: PiAiTool[]) => void> = [];
  private mode: RuntimeMode;
  private toolModes: Map<string, ToolMode> = new Map();
  private toolTags: Map<string, string[]> = new Map();
  private allowFrom: Set<number> = new Set();

  constructor(mode: RuntimeMode = "user") {
    this.mode = mode;
  }

  register<TParams = unknown>(
    tool: Tool,
    executor: ToolExecutor<TParams>,
    scope?: ToolScope,
    mode: ToolMode = "both",
    tags?: string[]
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, { tool, executor: executor as ToolExecutor });
    if (scope && scope !== "always" && scope !== "open") {
      this.scopes.set(tool.name, scope);
    }
    this.toolModes.set(tool.name, mode);
    if (tags && tags.length > 0) {
      this.toolTags.set(tool.name, tags);
    }
    this.toolModules.set(tool.name, tool.name.split("_")[0]);
    this.toolArrayCache = null;
  }

  setPermissions(mp: ModulePermissions): void {
    this.permissions = mp;
  }

  setMode(mode: RuntimeMode): void {
    this.mode = mode;
    this.toolArrayCache = null;
    const count = Array.from(this.tools.values()).filter((rt) => {
      const toolMode = this.toolModes.get(rt.tool.name);
      return !toolMode || toolMode === "both" || toolMode === mode;
    }).length;
    log.info(`Mode switched to ${mode}, ${count} tools available`);
  }

  setAllowFrom(ids: number[]): void {
    this.allowFrom = new Set(ids);
  }

  getAvailableModules(): string[] {
    const modules = new Set(this.toolModules.values());
    return Array.from(modules).sort();
  }

  getModuleToolCount(module: string): number {
    let count = 0;
    for (const mod of this.toolModules.values()) {
      if (mod === module) count++;
    }
    return count;
  }

  getModuleTools(module: string): Array<{ name: string; scope: ToolScope }> {
    const result: Array<{ name: string; scope: ToolScope }> = [];
    for (const [name, mod] of this.toolModules) {
      if (mod === module) {
        result.push({ name, scope: this.getEffectiveScope(name) });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  getAll(): PiAiTool[] {
    if (!this.toolArrayCache) {
      this.toolArrayCache = Array.from(this.tools.values()).map((rt) => rt.tool);
    }
    return this.toolArrayCache;
  }

  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Check mode restriction (defense-in-depth: tools are also filtered from LLM tool list)
    const toolMode = this.toolModes.get(toolCall.name);
    if (toolMode && toolMode !== "both" && toolMode !== this.mode) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" requires ${toolMode} mode (current: ${this.mode})`,
      };
    }

    // Check if tool is enabled
    if (!this.isToolEnabled(toolCall.name)) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is currently disabled`,
      };
    }

    const scope = this.getEffectiveScope(toolCall.name);
    if (scope === "disabled") {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is currently disabled`,
      };
    }
    if (scope === "dm-only" && context.isGroup) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is not available in group chats`,
      };
    }
    if (scope === "group-only" && !context.isGroup) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is only available in group chats`,
      };
    }
    if (scope === "admin-only") {
      const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
      if (!isAdmin) {
        return {
          success: false,
          error: `Tool "${toolCall.name}" is restricted to admin users`,
        };
      }
    }
    if (scope === "allowlist") {
      const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
      if (!isAdmin) {
        if (!this.allowFrom.has(context.senderId)) {
          return {
            success: false,
            error: `Tool "${toolCall.name}" is restricted to allowed users`,
          };
        }
      }
    }

    if (context.isGroup && this.permissions) {
      const module = this.toolModules.get(toolCall.name);
      if (module) {
        const level = this.permissions.getLevel(context.chatId, module);
        if (level === "disabled") {
          return {
            success: false,
            error: `Module "${module}" is disabled in this group`,
          };
        }
        if (level === "admin") {
          const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
          if (!isAdmin) {
            return {
              success: false,
              error: `Module "${module}" is restricted to admins in this group`,
            };
          }
        }
      }
    }

    try {
      const validatedArgs = validateToolCall(this.getAll(), toolCall);

      let timeoutHandle: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        registered.executor(validatedArgs, context),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(
                new Error(
                  `Tool "${toolCall.name}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s`
                )
              ),
            TOOL_EXECUTION_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      return result;
    } catch (error) {
      log.error({ err: error }, `Error executing tool ${toolCall.name}`);
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  getForContext(
    isGroup: boolean,
    toolLimit: number | null,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): PiAiTool[] {
    const filtered = Array.from(this.tools.values())
      .filter((rt) => this.passesFilters(rt.tool.name, isGroup, chatId, isAdmin, senderId))
      .map((rt) => rt.tool);

    if (toolLimit !== null && filtered.length > toolLimit) {
      log.warn(
        `Provider tool limit: ${toolLimit}, after scope filter: ${filtered.length}. Truncating to ${toolLimit} tools.`
      );
      return filtered.slice(0, toolLimit);
    }
    return filtered;
  }

  isPluginModule(moduleName: string): boolean {
    return this.pluginToolNames.has(moduleName);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get count(): number {
    return this.tools.size;
  }

  getToolCategory(name: string): "data-bearing" | "action" | undefined {
    const registered = this.tools.get(name);
    return registered?.tool.category;
  }

  /**
   * Load tool configurations from database and seed missing ones
   */
  loadConfigFromDB(db: Database.Database): void {
    this.db = db;
    this.toolConfigs = loadAllToolConfigs(db);

    // Seed DB with defaults for tools that don't have config yet
    let seeded = false;
    for (const [toolName] of this.tools) {
      if (!this.toolConfigs.has(toolName)) {
        const defaultScope = this.scopes.get(toolName) ?? "always";
        initializeToolConfig(db, toolName, true, defaultScope);
        seeded = true;
      }
    }
    // Reload once after all seeds
    if (seeded) {
      this.toolConfigs = loadAllToolConfigs(db);
    }

    // Clear cache to force regeneration with new configs
    this.toolArrayCache = null;
  }

  /**
   * Get effective scope for a tool (config override or default)
   */
  private getEffectiveScope(toolName: string): ToolScope {
    const config = this.toolConfigs.get(toolName);
    if (config?.scope !== null && config?.scope !== undefined) {
      return config.scope === "always" ? "open" : config.scope;
    }
    const codeScope = this.scopes.get(toolName) ?? "open";
    return codeScope === "always" ? "open" : codeScope;
  }

  /**
   * Check if a tool is enabled
   */
  isToolEnabled(toolName: string): boolean {
    const config = this.toolConfigs.get(toolName);
    return config?.enabled ?? true;
  }

  /**
   * Update tool enabled status
   */
  setToolEnabled(toolName: string, enabled: boolean, updatedBy?: number): boolean {
    if (!this.tools.has(toolName) || !this.db) return false;

    const currentConfig = this.toolConfigs.get(toolName);
    const scope = currentConfig?.scope ?? this.scopes.get(toolName) ?? "always";

    saveToolConfig(this.db, toolName, enabled, scope, updatedBy);

    // Update in-memory cache
    this.toolConfigs = loadAllToolConfigs(this.db);
    this.toolArrayCache = null;

    return true;
  }

  /**
   * Update tool scope
   */
  updateToolScope(toolName: string, scope: ToolScope, updatedBy?: number): boolean {
    if (!this.tools.has(toolName) || !this.db) return false;

    const currentConfig = this.toolConfigs.get(toolName);
    const enabled = currentConfig?.enabled ?? true;

    saveToolConfig(this.db, toolName, enabled, scope, updatedBy);

    // Update in-memory cache
    this.toolConfigs = loadAllToolConfigs(this.db);
    this.toolArrayCache = null;

    return true;
  }

  /**
   * Get tool configuration
   */
  getToolConfig(toolName: string): { enabled: boolean; scope: ToolScope } | null {
    if (!this.tools.has(toolName)) return null;

    const config = this.toolConfigs.get(toolName);
    const enabled = config?.enabled ?? true;
    const scope = config?.scope ?? this.scopes.get(toolName) ?? "always";

    return { enabled, scope };
  }

  /**
   * Register all tools belonging to a plugin (tracks ownership for hot-reload).
   */
  registerPluginTools(
    pluginName: string,
    tools: Array<{ tool: Tool; executor: ToolExecutor; scope?: ToolScope }>
  ): number {
    const names: string[] = [];
    for (const { tool, executor, scope } of tools) {
      if (this.tools.has(tool.name)) continue;
      this.tools.set(tool.name, { tool, executor });
      if (scope && scope !== "always" && scope !== "open") {
        this.scopes.set(tool.name, scope);
      }
      this.toolModes.set(tool.name, "both");
      this.toolModules.set(tool.name, pluginName);
      names.push(tool.name);
    }
    this.pluginToolNames.set(pluginName, names);

    // Seed new tools into DB config (if DB is initialized)
    if (this.db) {
      let seeded = false;
      for (const name of names) {
        if (!this.toolConfigs.has(name)) {
          const defaultScope = this.scopes.get(name) ?? "always";
          initializeToolConfig(this.db, name, true, defaultScope);
          seeded = true;
        }
      }
      if (seeded) {
        this.toolConfigs = loadAllToolConfigs(this.db);
      }
    }

    this.toolArrayCache = null;

    // Notify Tool RAG about new tools
    if (names.length > 0) {
      const addedTools = names.map((n) => this.tools.get(n)?.tool).filter((t): t is Tool => !!t);
      this.notifyToolsChanged([], addedTools);
    }

    return names.length;
  }

  /**
   * Replace all tools belonging to a plugin with new ones (hot-reload).
   * Atomically removes old tools then registers new ones.
   */
  replacePluginTools(
    pluginName: string,
    newTools: Array<{ tool: Tool; executor: ToolExecutor; scope?: ToolScope }>
  ): void {
    // Collect old tool names before removal (allowed to re-register these)
    const previousNames = new Set(this.pluginToolNames.get(pluginName) ?? []);
    this.removePluginTools(pluginName);
    const names: string[] = [];
    for (const { tool, executor, scope } of newTools) {
      // Prevent overwriting core/other-plugin tools
      if (this.tools.has(tool.name) && !previousNames.has(tool.name)) {
        log.warn(
          `Plugin "${pluginName}" tried to overwrite existing tool "${tool.name}" — skipped`
        );
        continue;
      }
      this.tools.set(tool.name, { tool, executor });
      if (scope && scope !== "always" && scope !== "open") {
        this.scopes.set(tool.name, scope);
      }
      this.toolModes.set(tool.name, "both");
      this.toolModules.set(tool.name, pluginName);
      names.push(tool.name);
    }
    this.pluginToolNames.set(pluginName, names);

    // Seed new tools into DB config (if DB is initialized)
    if (this.db) {
      let seeded = false;
      for (const name of names) {
        if (!this.toolConfigs.has(name)) {
          const defaultScope = this.scopes.get(name) ?? "always";
          initializeToolConfig(this.db, name, true, defaultScope);
          seeded = true;
        }
      }
      if (seeded) {
        this.toolConfigs = loadAllToolConfigs(this.db);
      }
    }

    this.toolArrayCache = null;

    // Notify Tool RAG about replaced tools
    const removedNames = [...previousNames].filter((n) => !names.includes(n));
    const addedTools = names.map((n) => this.tools.get(n)?.tool).filter((t): t is Tool => !!t);
    if (removedNames.length > 0 || addedTools.length > 0) {
      this.notifyToolsChanged(removedNames, addedTools);
    }
  }

  /**
   * Remove all tools belonging to a plugin.
   */
  removePluginTools(pluginName: string): void {
    const tracked = this.pluginToolNames.get(pluginName);
    if (tracked) {
      for (const name of tracked) {
        this.tools.delete(name);
        this.scopes.delete(name);
        this.toolModes.delete(name);
        this.toolModules.delete(name);
      }
      this.pluginToolNames.delete(pluginName);
    }
    this.toolArrayCache = null;
  }

  // ─── Tool RAG ──────────────────────────────────────────────────

  setToolIndex(index: ToolIndex): void {
    this.toolIndex = index;
  }

  getToolIndex(): ToolIndex | null {
    return this.toolIndex;
  }

  setEmbedder(embedder: EmbeddingProvider | null): void {
    this.embedderRef = embedder;
  }

  getEmbedder(): EmbeddingProvider | null {
    return this.embedderRef;
  }

  // ─── ToolSearch helpers ────────────────────────────────────────

  /**
   * Return the TypeBox parameter schema for a tool, or null if not found.
   * Used by tool_search executor to provide full schemas to the LLM.
   */
  getToolSchema(name: string): TSchema | null {
    const registered = this.tools.get(name);
    return registered?.tool.parameters ?? null;
  }

  /**
   * Return a ToolEntry snapshot for a named tool (scope, mode, tags, executor).
   * Returns null if the tool is not registered.
   */
  getEntry(name: string): ToolEntry | null {
    const registered = this.tools.get(name);
    if (!registered) return null;
    return {
      tool: registered.tool,
      executor: registered.executor,
      scope: this.getEffectiveScope(name),
      mode: this.toolModes.get(name) ?? "both",
      tags: this.toolTags.get(name),
    };
  }

  /**
   * Returns true if a tool passes all scope/mode/enabled filters for the given context.
   * Extracted from getForContext() for reuse by tool_search and getCoreTools().
   */
  passesFilters(
    name: string,
    isGroup: boolean,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): boolean {
    if (!this.tools.has(name)) return false;

    // Mode restriction (user vs bot)
    const toolMode = this.toolModes.get(name);
    if (toolMode && toolMode !== "both" && toolMode !== this.mode) return false;

    // Enabled check
    if (!this.isToolEnabled(name)) return false;

    const effectiveScope = this.getEffectiveScope(name);
    if (effectiveScope === "disabled") return false;

    const excluded = isGroup ? "dm-only" : "group-only";
    if (effectiveScope === excluded) return false;

    if (effectiveScope === "admin-only" && !isAdmin) return false;

    if (effectiveScope === "allowlist" && !isAdmin) {
      if (!senderId || !this.allowFrom.has(senderId)) return false;
    }

    if (isGroup && chatId && this.permissions) {
      const module = this.toolModules.get(name);
      if (module) {
        const level = this.permissions.getLevel(chatId, module);
        if (level === "disabled") return false;
        if (level === "admin" && !isAdmin) return false;
      }
    }

    return true;
  }

  /**
   * Return PiAiTool[] for all tools tagged "core" that pass scope/mode filters.
   * Used by the runtime when tool_search.enabled is true to build the initial tool set.
   */
  getCoreTools(
    isGroup: boolean,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): PiAiTool[] {
    return Array.from(this.tools.entries())
      .filter(([name]) => {
        const tags = this.toolTags.get(name);
        if (!tags?.includes("core")) return false;
        return this.passesFilters(name, isGroup, chatId, isAdmin, senderId);
      })
      .map(([, rt]) => rt.tool);
  }

  onToolsChanged(callback: (removed: string[], added: PiAiTool[]) => void): void {
    this.onToolsChangedCallbacks.push(callback);
  }

  private notifyToolsChanged(removed: string[], added: PiAiTool[]): void {
    for (const cb of this.onToolsChangedCallbacks) {
      try {
        cb(removed, added);
      } catch (error) {
        log.error({ err: error }, "onToolsChanged callback error");
      }
    }
  }

  /**
   * Select tools using semantic RAG search on the user message.
   * Falls back to getForContext() if search returns nothing.
   */
  async getForContextWithRAG(
    query: string,
    queryEmbedding: number[],
    isGroup: boolean,
    toolLimit: number | null,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): Promise<PiAiTool[]> {
    // Get scope-filtered tools (no limit applied yet)
    const scopeFiltered = this.getForContext(isGroup, null, chatId, isAdmin, senderId);
    const scopeSet = new Set(scopeFiltered.map((t) => t.name));

    if (!this.toolIndex) {
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    // Collect always-on tools
    const selected = new Map<string, PiAiTool>();
    for (const tool of scopeFiltered) {
      if (this.toolIndex.isAlwaysIncluded(tool.name)) {
        selected.set(tool.name, tool);
      }
    }

    // Semantic search
    try {
      const results = await this.toolIndex.search(query, queryEmbedding);

      // Add results that pass the scope filter
      for (const result of results) {
        if (scopeSet.has(result.name) && !selected.has(result.name)) {
          const tool = scopeFiltered.find((t) => t.name === result.name);
          if (tool) selected.set(result.name, tool);
        }
      }
    } catch (error) {
      log.warn({ err: error }, "Search failed, falling back to full tool set");
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    // Fallback: if no results from search, send all scope-filtered
    if (selected.size === 0) {
      log.warn("No tools matched query, sending all scope-filtered tools");
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    const result = Array.from(selected.values());
    return this.applyLimit(result, toolLimit);
  }

  private applyLimit(tools: PiAiTool[], toolLimit: number | null): PiAiTool[] {
    if (toolLimit !== null && tools.length > toolLimit) {
      log.warn(
        `Provider tool limit: ${toolLimit}, selected: ${tools.length}. Truncating to ${toolLimit} tools.`
      );
      return tools.slice(0, toolLimit);
    }
    return tools;
  }
}
