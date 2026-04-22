import { complete, type Context, type ToolCall } from "@mariozechner/pi-ai";
import type { AgentRuntime } from "../agent/runtime.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { TelegramBridge } from "../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { SupportedProvider } from "../config/providers.js";
import { getProviderModel, getEffectiveApiKey } from "../agent/client.js";
import { buildDefaultLoopDeps, AutonomousTaskManager, type AvailableToolInfo } from "./manager.js";
import type { LoopDependencies } from "./loop.js";
import type { AutonomousTask } from "../memory/agent/autonomous-tasks.js";
import { createLogger } from "../utils/logger.js";
import { getNotificationService, notificationBus } from "../services/notifications.js";

const log = createLogger("AutonomousIntegration");

const AUTONOMOUS_LLM_MAX_TOKENS = 1024;
const AUTONOMOUS_PLANNER_TOOL_LIMIT = 64;

export interface IntegrationDeps {
  agent: AgentRuntime;
  toolRegistry: ToolRegistry | null;
  bridge: TelegramBridge;
  db: Database.Database;
}

/**
 * Build LoopDependencies wired to the real agent runtime, tool registry,
 * and Telegram bridge for escalation notifications. This is what makes
 * autonomous tasks actually execute — without it the manager would run
 * but have nothing to call.
 */
export function buildIntegratedLoopDeps(deps: IntegrationDeps): LoopDependencies {
  return buildDefaultLoopDeps({
    callLLM: async (prompt: string): Promise<string> => {
      const agentConfig = deps.agent.getConfig().agent;
      const provider = (agentConfig.provider || "anthropic") as SupportedProvider;
      const model = getProviderModel(provider, agentConfig.model);
      const apiKey = getEffectiveApiKey(provider, agentConfig.api_key);

      if (!apiKey && provider !== "local" && provider !== "cocoon") {
        throw new Error(
          `No API key configured for provider "${provider}" — autonomous task cannot call the LLM.`
        );
      }

      const context: Context = {
        systemPrompt:
          "You are the planning brain of an autonomous agent. " +
          "Respond strictly with the JSON object the caller describes. " +
          "Do not include prose, markdown, or code fences.",
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      };

      const response = await complete(model, context, {
        apiKey,
        maxTokens: AUTONOMOUS_LLM_MAX_TOKENS,
        temperature: 0,
      });

      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "LLM call failed");
      }

      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    },

    callTool: async (name, params) => {
      if (!deps.toolRegistry) {
        throw new Error("Tool registry unavailable");
      }
      if (name === "noop") {
        // The default planner falls back to "noop" when it cannot parse the
        // LLM response. Treat it as a no-op success so the loop can observe
        // and reflect rather than failing outright.
        return { noop: true };
      }

      const toolCall: ToolCall = {
        type: "toolCall",
        id: `autonomous-${Date.now()}`,
        name,
        arguments: params,
      };

      // Autonomous tasks run on behalf of the system/owner, not a specific
      // Telegram user. Using admin_ids[0] as the effective sender (same
      // pattern as the heartbeat and /heartbeat/trigger REST endpoint) lets
      // admin-only tools pass the registry's admin check instead of always
      // failing with senderId=0.
      const config = deps.agent.getConfig();
      const adminSenderId = config.telegram.admin_ids[0] ?? 0;

      const result = await deps.toolRegistry.execute(toolCall, {
        bridge: deps.bridge,
        db: deps.db,
        chatId: "autonomous",
        senderId: adminSenderId,
        isGroup: false,
        config,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Tool execution failed");
      }
      return result.data;
    },

    listTools: (task) => listToolsForTask(deps.toolRegistry, task),

    notify: async (message: string, taskId: string): Promise<void> => {
      // Always log first so escalations are preserved even if every side
      // channel below fails. This is the last-resort fallback required by
      // the issue: a paused task must never be silently invisible.
      log.warn({ taskId, message }, "Autonomous task escalation");

      // 1. Push to Telegram admins via bridge so the human is actually
      //    paged. admin_ids is authoritative — if it's empty we skip the
      //    DM rather than guessing a recipient.
      const adminIds = deps.agent.getConfig().telegram.admin_ids ?? [];
      for (const adminId of adminIds) {
        try {
          await deps.bridge.sendMessage({
            chatId: String(adminId),
            text: message,
          });
        } catch (err) {
          log.error({ err, taskId, adminId }, "failed to deliver escalation to Telegram admin");
        }
      }

      // 2. Record the escalation in the in-app notifications table and
      //    poke the notificationBus so WebUI SSE clients raise a badge in
      //    real time.
      try {
        const svc = getNotificationService(deps.db);
        svc.add("warning", "Autonomous task escalation", message);
        notificationBus.emit("update", svc.unreadCount());
        notificationBus.emit("escalation", { taskId, message });
      } catch (err) {
        log.error({ err, taskId }, "failed to record escalation notification");
      }
    },
  });
}

/**
 * Produce the list of tools the autonomous planner may consider for this
 * task. We:
 *  - pull the DM-context set with admin privileges (autonomous tasks run as
 *    the system and should see admin-only tools),
 *  - honour `allowedTools` / `restrictedTools` from the task constraints so
 *    the planner never proposes a tool the policy engine would reject, and
 *  - cap the number of entries to keep the prompt tractable.
 */
export function listToolsForTask(
  registry: ToolRegistry | null,
  task: AutonomousTask
): AvailableToolInfo[] {
  if (!registry) return [];

  const scoped = registry.getForContext(false, null, undefined, true);

  const allowed = task.constraints?.allowedTools;
  const restricted = task.constraints?.restrictedTools ?? [];
  const restrictedSet = new Set(restricted);

  const filtered = scoped.filter((t) => {
    if (restrictedSet.has(t.name)) return false;
    if (allowed && allowed.length > 0 && !allowed.includes(t.name)) return false;
    return true;
  });

  const truncated =
    filtered.length > AUTONOMOUS_PLANNER_TOOL_LIMIT
      ? filtered.slice(0, AUTONOMOUS_PLANNER_TOOL_LIMIT)
      : filtered;

  return truncated.map((t) => ({
    name: t.name,
    description:
      typeof t.description === "string" && t.description.length > 0
        ? t.description
        : "(no description)",
  }));
}

/**
 * Create an {@link AutonomousTaskManager} wired to the agent runtime.
 * Returns `undefined` if the caller has no agent runtime available (e.g.
 * CLI utility contexts) — callers should handle that gracefully.
 */
export function createAutonomousManager(deps: IntegrationDeps): AutonomousTaskManager {
  const loopDeps = buildIntegratedLoopDeps(deps);
  return new AutonomousTaskManager(deps.db, loopDeps);
}
