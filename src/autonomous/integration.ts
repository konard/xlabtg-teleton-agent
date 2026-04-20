import { complete, type Context, type ToolCall } from "@mariozechner/pi-ai";
import type { AgentRuntime } from "../agent/runtime.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { TelegramBridge } from "../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { SupportedProvider } from "../config/providers.js";
import { getProviderModel, getEffectiveApiKey } from "../agent/client.js";
import { buildDefaultLoopDeps, AutonomousTaskManager } from "./manager.js";
import type { LoopDependencies } from "./loop.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AutonomousIntegration");

const AUTONOMOUS_LLM_MAX_TOKENS = 1024;

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

      const result = await deps.toolRegistry.execute(toolCall, {
        bridge: deps.bridge,
        db: deps.db,
        chatId: "autonomous",
        senderId: 0,
        isGroup: false,
        config: deps.agent.getConfig(),
      });

      if (!result.success) {
        throw new Error(result.error ?? "Tool execution failed");
      }
      return result.data;
    },

    notify: async (message: string, taskId: string): Promise<void> => {
      // Escalations surface through the task's execution log (see loop.ts)
      // and the standard logger. A richer push-notification channel can be
      // added later without changing the loop contract.
      log.warn({ taskId, message }, "Autonomous task escalation");
    },
  });
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
