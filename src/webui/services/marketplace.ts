/**
 * Marketplace service — fetch, install, uninstall, and update plugins
 * from one or more community registries at GitHub.
 *
 * Supports the built-in official registry (TONresistor/teleton-plugins) plus
 * any number of extra sources configured in config.marketplace.extra_sources.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { adaptPlugin, ensurePluginDeps } from "../../agent/tools/plugin-loader.js";
import type { ToolRegistry } from "../../agent/tools/registry.js";
import type {
  MarketplaceDeps,
  RegistryEntry,
  MarketplacePlugin,
  MarketplaceSource,
} from "../types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("WebUI");

const OFFICIAL_REGISTRY_URL =
  "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main/registry.json";
const OFFICIAL_PLUGIN_BASE_URL =
  "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main";
const OFFICIAL_GITHUB_API_BASE =
  "https://api.github.com/repos/TONresistor/teleton-plugins/contents";
const OFFICIAL_LABEL = "Official";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PLUGINS_DIR = WORKSPACE_PATHS.PLUGINS_DIR;

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;

interface ManifestData {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools?: Array<{ name: string; description: string }>;
  secrets?: Record<string, { required: boolean; description: string; env?: string }>;
}

interface SourceDescriptor {
  registryUrl: string;
  pluginBaseUrl: string;
  githubApiBase: string;
  label: string;
  isOfficial: boolean;
}

interface ServiceDeps extends MarketplaceDeps {
  toolRegistry: ToolRegistry;
}

/**
 * Derive raw file base URL and GitHub Contents API base from a registry.json URL.
 * Handles the common pattern:
 *   https://raw.githubusercontent.com/OWNER/REPO/BRANCH/registry.json
 *   → base:     https://raw.githubusercontent.com/OWNER/REPO/BRANCH
 *   → api base: https://api.github.com/repos/OWNER/REPO/contents
 */
function deriveSourceUrls(registryUrl: string): { pluginBaseUrl: string; githubApiBase: string } {
  try {
    const url = new URL(registryUrl);
    if (url.hostname === "raw.githubusercontent.com") {
      // path: /OWNER/REPO/BRANCH/registry.json  (or any path ending in /*.json)
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 4) {
        const [owner, repo, branch, ...rest] = parts;
        // base URL (strip the filename)
        const fileParts = rest.slice(0, -1);
        const pluginBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${fileParts.length ? "/" + fileParts.join("/") : ""}`;
        const githubApiBase = `https://api.github.com/repos/${owner}/${repo}/contents${fileParts.length ? "/" + fileParts.join("/") : ""}`;
        return { pluginBaseUrl, githubApiBase };
      }
    }
  } catch {
    // fall through
  }
  // Fallback: strip the last path segment for the base URL; no API base available
  const lastSlash = registryUrl.lastIndexOf("/");
  const pluginBaseUrl = lastSlash > 8 ? registryUrl.slice(0, lastSlash) : registryUrl;
  return { pluginBaseUrl, githubApiBase: "" };
}

export class MarketplaceService {
  private deps: ServiceDeps;
  // Per-source cache keyed by registryUrl
  private sourceCache = new Map<string, { entries: RegistryEntry[]; fetchedAt: number }>();
  private fetchPromises = new Map<string, Promise<RegistryEntry[]>>();
  private manifestCache = new Map<string, { data: ManifestData; fetchedAt: number }>();
  private installing = new Set<string>();

  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  // ── Source descriptors ───────────────────────────────────────────────

  private getSources(): SourceDescriptor[] {
    const sources: SourceDescriptor[] = [
      {
        registryUrl: OFFICIAL_REGISTRY_URL,
        pluginBaseUrl: OFFICIAL_PLUGIN_BASE_URL,
        githubApiBase: OFFICIAL_GITHUB_API_BASE,
        label: OFFICIAL_LABEL,
        isOfficial: true,
      },
    ];

    const extra = this.deps.config.marketplace?.extra_sources ?? [];
    for (const s of extra) {
      if (!s.enabled) continue;
      const { pluginBaseUrl, githubApiBase } = deriveSourceUrls(s.url);
      sources.push({
        registryUrl: s.url,
        pluginBaseUrl,
        githubApiBase,
        label: s.label ?? s.url,
        isOfficial: false,
      });
    }

    return sources;
  }

  /**
   * Return all configured sources (for the UI source management panel).
   */
  listSources(): MarketplaceSource[] {
    const extra = this.deps.config.marketplace?.extra_sources ?? [];
    const result: MarketplaceSource[] = [
      {
        url: OFFICIAL_REGISTRY_URL,
        label: OFFICIAL_LABEL,
        enabled: true,
        isOfficial: true,
      },
    ];
    for (const s of extra) {
      result.push({
        url: s.url,
        label: s.label ?? s.url,
        enabled: s.enabled ?? true,
        isOfficial: false,
      });
    }
    return result;
  }

  // ── Registry ────────────────────────────────────────────────────────

  async getRegistry(forceRefresh = false): Promise<RegistryEntry[]> {
    const sources = this.getSources();
    const allEntries = await Promise.allSettled(
      sources.map((s) => this.getSourceRegistry(s, forceRefresh))
    );

    const merged: RegistryEntry[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < sources.length; i++) {
      const result = allEntries[i];
      const src = sources[i];
      if (result.status === "rejected") {
        log.warn({ err: result.reason }, `Registry fetch failed for ${src.registryUrl}`);
        continue;
      }
      for (const entry of result.value) {
        // Deduplicate by id — first source (official) wins
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          merged.push({ ...entry, _sourceUrl: src.registryUrl } as RegistryEntry & {
            _sourceUrl: string;
          });
        }
      }
    }

    return merged;
  }

  private async getSourceRegistry(
    src: SourceDescriptor,
    forceRefresh: boolean
  ): Promise<RegistryEntry[]> {
    const cached = this.sourceCache.get(src.registryUrl);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.entries;
    }

    // Dedup concurrent fetches per source
    const existing = this.fetchPromises.get(src.registryUrl);
    if (existing) return existing;

    const promise = this.fetchRegistry(src.registryUrl);
    this.fetchPromises.set(src.registryUrl, promise);
    try {
      const entries = await promise;
      this.sourceCache.set(src.registryUrl, { entries, fetchedAt: Date.now() });
      return entries;
    } catch (err) {
      if (cached) {
        log.warn({ err }, `Registry fetch failed for ${src.registryUrl}, using stale cache`);
        return cached.entries;
      }
      throw err;
    } finally {
      this.fetchPromises.delete(src.registryUrl);
    }
  }

  private async fetchRegistry(registryUrl: string): Promise<RegistryEntry[]> {
    const res = await fetch(registryUrl);
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    // Registry format: { version: "1.0.0", plugins: [...] }  OR  plain array
    const plugins = Array.isArray(data) ? data : data?.plugins;
    if (!Array.isArray(plugins)) throw new Error("Registry has no plugins array");

    // Validate each entry — defense-in-depth against poisoned registries
    const VALID_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;
    for (const entry of plugins) {
      if (!entry.id || !entry.name || !entry.path) {
        throw new Error(`Invalid registry entry: missing required fields (id=${entry.id ?? "?"})`);
      }
      if (!VALID_PATH.test(entry.path) || entry.path.includes("..")) {
        throw new Error(`Invalid registry path for "${entry.id}": "${entry.path}"`);
      }
    }

    return plugins as RegistryEntry[];
  }

  // ── Remote manifest ─────────────────────────────────────────────────

  private async fetchRemoteManifest(
    entry: RegistryEntry,
    pluginBaseUrl: string
  ): Promise<ManifestData> {
    const cacheKey = `${pluginBaseUrl}::${entry.id}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }

    const url = `${pluginBaseUrl}/${entry.path}/manifest.json`;
    const res = await fetch(url);
    if (!res.ok) {
      // Fallback: construct from registry entry
      return {
        name: entry.name,
        version: "0.0.0",
        description: entry.description,
        author: entry.author,
      };
    }
    const raw = await res.json();
    // Normalize author: manifest may have { name, url } object or a plain string
    const data: ManifestData = {
      ...raw,
      author: normalizeAuthor(raw.author),
    };
    this.manifestCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  }

  // ── List plugins (combined view) ────────────────────────────────────

  async listPlugins(forceRefresh = false): Promise<MarketplacePlugin[]> {
    const sources = this.getSources();

    // Fetch all registries in parallel
    const registryResults = await Promise.allSettled(
      sources.map((s) => this.getSourceRegistry(s, forceRefresh))
    );

    const results: MarketplacePlugin[] = [];
    const seenIds = new Set<string>();

    for (let si = 0; si < sources.length; si++) {
      const src = sources[si];
      const regResult = registryResults[si];
      if (regResult.status === "rejected") continue;

      const registry = regResult.value;

      // Fetch all manifests for this source in parallel
      const manifests = await Promise.allSettled(
        registry.map((entry) => this.fetchRemoteManifest(entry, src.pluginBaseUrl))
      );

      for (let i = 0; i < registry.length; i++) {
        const entry = registry[i];

        // Deduplicate by id — first source wins
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);

        const manifestResult = manifests[i];
        const manifest: ManifestData =
          manifestResult.status === "fulfilled"
            ? manifestResult.value
            : {
                name: entry.name,
                version: "0.0.0",
                description: entry.description,
                author: entry.author,
              };

        // Cross-reference with loaded modules
        const installed = this.deps.modules.find(
          (m) => m.name === entry.id || m.name === entry.name
        );
        const installedVersion = installed?.version ?? null;
        const remoteVersion = manifest.version || "0.0.0";

        let status: MarketplacePlugin["status"] = "available";
        if (installedVersion) {
          status = installedVersion !== remoteVersion ? "updatable" : "installed";
        }

        // Get tool info from remote manifest or from loaded module
        let toolCount = manifest.tools?.length ?? 0;
        let tools: Array<{ name: string; description: string }> = manifest.tools ?? [];

        if (installed) {
          // Use live data from registry for installed plugins
          const moduleTools = this.deps.toolRegistry.getModuleTools(installed.name);
          const allToolDefs = this.deps.toolRegistry.getAll();
          const toolMap = new Map(allToolDefs.map((t) => [t.name, t]));
          tools = moduleTools.map((mt) => ({
            name: mt.name,
            description: toolMap.get(mt.name)?.description ?? "",
          }));
          toolCount = tools.length;
        }

        // Determine source type and label
        const source: MarketplacePlugin["source"] = src.isOfficial
          ? "official"
          : src.label.toLowerCase().includes("community")
            ? "community"
            : "custom";

        results.push({
          id: entry.id,
          name: entry.name,
          description: manifest.description || entry.description,
          author: manifest.author || entry.author,
          tags: entry.tags,
          remoteVersion,
          installedVersion,
          status,
          toolCount,
          tools,
          secrets: manifest.secrets,
          source,
          sourceLabel: src.label,
        });
      }
    }

    return results;
  }

  // ── Install ─────────────────────────────────────────────────────────

  async installPlugin(
    pluginId: string
  ): Promise<{ name: string; version: string; toolCount: number }> {
    this.validateId(pluginId);

    if (this.installing.has(pluginId)) {
      throw new ConflictError(`Plugin "${pluginId}" is already being installed`);
    }

    // Check if already installed (resolve via registry name, not just ID)
    const existing = this.findModuleByPluginId(pluginId);
    if (existing) {
      throw new ConflictError(`Plugin "${pluginId}" is already installed`);
    }

    this.installing.add(pluginId);
    const pluginDir = join(PLUGINS_DIR, pluginId);

    try {
      // Find entry in registry (search all sources)
      const registry = await this.getRegistry();
      const entry = registry.find((e) => e.id === pluginId);
      if (!entry) throw new Error(`Plugin "${pluginId}" not found in registry`);

      // Find which source provides this entry
      const sourceUrl = (entry as RegistryEntry & { _sourceUrl?: string })._sourceUrl;
      const srcDescriptor =
        this.getSources().find((s) => s.registryUrl === sourceUrl) ?? this.getSources()[0]; // fallback to official

      // Fetch remote manifest
      const _manifest = await this.fetchRemoteManifest(entry, srcDescriptor.pluginBaseUrl);

      // Create plugin directory
      mkdirSync(pluginDir, { recursive: true });

      // Download the entire plugin directory from GitHub
      await this.downloadDir(entry.path, pluginDir, srcDescriptor.githubApiBase);

      // Install npm deps if package.json exists
      await ensurePluginDeps(pluginDir, pluginId);

      // Import the plugin module
      const indexPath = join(pluginDir, "index.js");
      const moduleUrl = pathToFileURL(indexPath).href + `?t=${Date.now()}`;
      const mod = await import(moduleUrl);

      // Adapt plugin (validates manifest, tools, SDK version, etc.)
      const adapted = adaptPlugin(
        mod,
        pluginId,
        this.deps.config,
        this.deps.loadedModuleNames,
        this.deps.sdkDeps
      );

      // Run migrations
      adapted.migrate?.(this.deps.pluginContext.db);

      // Register tools
      const tools = adapted.tools(this.deps.config);
      const toolCount = this.deps.toolRegistry.registerPluginTools(adapted.name, tools);

      // Start plugin
      await adapted.start?.(this.deps.pluginContext);

      // Add to modules array (shared reference)
      this.deps.modules.push(adapted);

      // Re-wire plugin event hooks
      this.deps.rewireHooks();

      return {
        name: adapted.name,
        version: adapted.version,
        toolCount,
      };
    } catch (err) {
      // Cleanup on failure
      if (existsSync(pluginDir)) {
        try {
          rmSync(pluginDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          log.error({ err: cleanupErr }, `Failed to cleanup ${pluginDir}`);
        }
      }
      throw err;
    } finally {
      this.installing.delete(pluginId);
    }
  }

  // ── Uninstall ───────────────────────────────────────────────────────

  async uninstallPlugin(pluginId: string): Promise<{ message: string }> {
    this.validateId(pluginId);

    if (this.installing.has(pluginId)) {
      throw new ConflictError(`Plugin "${pluginId}" has an operation in progress`);
    }

    // Resolve registry ID → actual module (handles name mismatch)
    const mod = this.findModuleByPluginId(pluginId);
    if (!mod) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }
    const moduleName = mod.name;
    const idx = this.deps.modules.indexOf(mod);

    this.installing.add(pluginId);
    try {
      // Stop plugin
      await mod.stop?.();

      // Remove tools from registry (use actual module name, not registry ID)
      this.deps.toolRegistry.removePluginTools(moduleName);

      // Remove from modules array
      if (idx >= 0) this.deps.modules.splice(idx, 1);

      // Re-wire hooks without this plugin
      this.deps.rewireHooks();

      // Delete plugin directory (keep data DB)
      const pluginDir = join(PLUGINS_DIR, pluginId);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }

      return { message: `Plugin "${pluginId}" uninstalled successfully` };
    } finally {
      this.installing.delete(pluginId);
    }
  }

  // ── Update ──────────────────────────────────────────────────────────

  async updatePlugin(
    pluginId: string
  ): Promise<{ name: string; version: string; toolCount: number }> {
    await this.uninstallPlugin(pluginId);
    return this.installPlugin(pluginId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve a registry plugin ID to the actual loaded module.
   * Handles name mismatch: registry id "fragment" → module name "Fragment Marketplace".
   */
  private findModuleByPluginId(pluginId: string) {
    // Direct match (module name === registry id)
    let mod = this.deps.modules.find((m) => m.name === pluginId);
    if (mod) return mod;

    // Via any cached registry entry
    for (const cached of this.sourceCache.values()) {
      const entry = cached.entries.find((e) => e.id === pluginId);
      if (entry) {
        mod = this.deps.modules.find((m) => m.name === entry.name);
        if (mod) return mod;
      }
    }
    return null;
  }

  /**
   * Recursively download a GitHub directory to a local path.
   * Uses the GitHub Contents API to list files, then fetches each via raw.githubusercontent.
   */
  private async downloadDir(
    remotePath: string,
    localDir: string,
    githubApiBase: string,
    depth = 0
  ): Promise<void> {
    if (depth > 5) throw new Error("Plugin directory too deeply nested");
    if (!githubApiBase) {
      throw new Error("Cannot install from this source: unable to derive GitHub Contents API URL");
    }

    const res = await fetch(`${githubApiBase}/${remotePath}`);
    if (!res.ok) throw new Error(`Failed to list directory "${remotePath}": ${res.status}`);
    const entries: Array<{
      name: string;
      type: string;
      download_url: string | null;
      path: string;
    }> = await res.json();

    for (const item of entries) {
      // Validate name — block path traversal
      if (!item.name || /[/\\]/.test(item.name) || item.name === ".." || item.name === ".") {
        throw new Error(`Invalid entry name in plugin directory: "${item.name}"`);
      }

      const target = resolve(localDir, item.name);
      if (!target.startsWith(resolve(PLUGINS_DIR))) {
        throw new Error(`Path escape detected: ${target}`);
      }

      if (item.type === "dir") {
        mkdirSync(target, { recursive: true });
        await this.downloadDir(item.path, target, githubApiBase, depth + 1);
      } else if (item.type === "file" && item.download_url) {
        // Validate download URL is from GitHub
        const url = new URL(item.download_url);
        if (
          !url.hostname.endsWith("githubusercontent.com") &&
          !url.hostname.endsWith("github.com")
        ) {
          throw new Error(`Untrusted download host: ${url.hostname}`);
        }
        const fileRes = await fetch(item.download_url);
        if (!fileRes.ok) throw new Error(`Failed to download ${item.name}: ${fileRes.status}`);
        const content = await fileRes.text();
        writeFileSync(target, content, { encoding: "utf-8", mode: 0o600 });
      }
    }
  }

  /** Clear all registry and manifest caches (e.g. after adding/removing a source). */
  invalidateCache(): void {
    this.sourceCache.clear();
    this.manifestCache.clear();
    this.fetchPromises.clear();
  }

  private validateId(id: string): void {
    if (!VALID_ID.test(id)) {
      throw new Error(`Invalid plugin ID: "${id}"`);
    }
  }
}

function normalizeAuthor(author: unknown): string {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && "name" in author) {
    return String((author as { name: unknown }).name);
  }
  return "unknown";
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
