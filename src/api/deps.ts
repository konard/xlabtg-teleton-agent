import type { AgentRuntime } from "../agent/runtime.js";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { MemorySystem } from "../memory/index.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { WebUIServerDeps, LoadedPlugin, McpServerInfo } from "../webui/types.js";
import type { WebUIConfig } from "../config/schema.js";
import type { Database } from "better-sqlite3";
import type { AgentLifecycle } from "../agent/lifecycle.js";
import type { UserHookEvaluator } from "../agent/hooks/user-hook-evaluator.js";
import type { MarketplaceDeps } from "../webui/types.js";
import type { AutonomousTaskManager } from "../autonomous/manager.js";
import type { WorkflowScheduler } from "../services/workflow-scheduler.js";
import { HTTPException } from "hono/http-exception";

export interface ApiServerDeps {
  agent?: AgentRuntime | null;
  bridge?: TelegramBridge | null;
  memory?: {
    db: Database;
    embedder: MemorySystem["embedder"];
    knowledge: MemorySystem["knowledge"];
    vectorStore?: MemorySystem["vectorStore"];
    scorer?: MemorySystem["scorer"];
    retention?: MemorySystem["retention"];
  } | null;
  toolRegistry?: ToolRegistry | null;
  plugins?: LoadedPlugin[] | null;
  mcpServers?: McpServerInfo[] | (() => McpServerInfo[]) | null;
  config: WebUIConfig;
  configPath: string;
  lifecycle?: AgentLifecycle | null;
  marketplace?: MarketplaceDeps | null;
  userHookEvaluator?: UserHookEvaluator | null;
  autonomousManager?: AutonomousTaskManager | null;
  workflowScheduler?: (() => WorkflowScheduler | null) | WorkflowScheduler | null;
}

/**
 * Adapt partial ApiServerDeps to the full WebUIServerDeps interface.
 * Accessing a null dep throws HTTPException(503) so route handlers
 * get a meaningful error when the agent isn't running.
 */
export function createDepsAdapter(apiDeps: ApiServerDeps): WebUIServerDeps {
  const handler: ProxyHandler<ApiServerDeps> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // These are always available
      if (
        prop === "config" ||
        prop === "configPath" ||
        prop === "lifecycle" ||
        prop === "userHookEvaluator" ||
        prop === "marketplace" ||
        prop === "autonomousManager" ||
        prop === "workflowScheduler"
      ) {
        return value;
      }

      // For deps that might be null/undefined, throw 503
      if (value === null || value === undefined) {
        throw new HTTPException(503, {
          message: `Service unavailable: ${String(prop)} is not initialized (agent not running)`,
        });
      }

      return value;
    },
  };

  return new Proxy(apiDeps, handler) as unknown as WebUIServerDeps;
}
