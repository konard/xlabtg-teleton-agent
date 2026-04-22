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
      const adminSenderId = config.telegram.admin_ids[0];
      if (adminSenderId === undefined) {
        throw new Error(
          "Cannot execute autonomous tool: config.telegram.admin_ids is empty. " +
            "Autonomous tasks require at least one admin user for escalation and admin-only tool access."
        );
      }

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
      // Escalations surface through the task's execution log (see loop.ts)
      // and the standard logger. A richer push-notification channel can be
      // added later without changing the loop contract.
      log.warn({ taskId, message }, "Autonomous task escalation");
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
 *
 * Throws if `config.telegram.admin_ids` is empty — autonomous tasks must
 * attribute actions to a real admin user, both for the admin-only tool
 * check and for escalation routing. Starting silently with `senderId=0`
 * would make admin-only tools fail with a generic "Tool execution failed"
 * and attribute audit-trail entries to Telegram user id 0 (AUDIT-H6).
 */
export function createAutonomousManager(deps: IntegrationDeps): AutonomousTaskManager {
  const config = deps.agent.getConfig();
  if (config.telegram.admin_ids.length === 0) {
    throw new Error(
      "Cannot start autonomous manager: config.telegram.admin_ids is empty. " +
        "Autonomous tasks require at least one admin user for escalation."
    );
  }
  const loopDeps = buildIntegratedLoopDeps(deps);
  return new AutonomousTaskManager(deps.db, loopDeps);
}
