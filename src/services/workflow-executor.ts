import type { TelegramBridge } from "../telegram/bridge.js";
import type { WorkflowStore } from "./workflows.js";
import type { Workflow, WorkflowAction } from "./workflows.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("WorkflowExecutor");

export interface WorkflowExecutorDeps {
  bridge?: TelegramBridge;
  store: WorkflowStore;
}

export class WorkflowExecutor {
  private variables = new Map<string, string>();

  constructor(private deps: WorkflowExecutorDeps) {}

  async execute(workflow: Workflow): Promise<void> {
    const errors: string[] = [];

    for (const action of workflow.config.actions) {
      try {
        await this.runAction(action);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ workflowId: workflow.id, action: action.type, err }, "Action failed");
        errors.push(`${action.type}: ${msg}`);
      }
    }

    this.deps.store.recordRun(workflow.id, errors.length > 0 ? errors.join("; ") : undefined);
  }

  private interpolate(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => this.variables.get(name) ?? "");
  }

  private async runAction(action: WorkflowAction): Promise<void> {
    if (action.type === "send_message") {
      const bridge = this.deps.bridge;
      if (!bridge || !bridge.isAvailable()) {
        throw new Error("Telegram bridge unavailable");
      }
      await bridge.sendMessage({
        chatId: this.interpolate(action.chatId),
        text: this.interpolate(action.text),
      });
      return;
    }

    if (action.type === "call_api") {
      const init: RequestInit = { method: action.method };
      if (action.headers) {
        init.headers = action.headers;
      }
      if (action.body && action.method !== "GET" && action.method !== "DELETE") {
        init.body = this.interpolate(action.body);
      }
      const res = await fetch(action.url, init);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${action.url}`);
      }
      return;
    }

    if (action.type === "set_variable") {
      this.variables.set(action.name, this.interpolate(action.value));
      return;
    }
  }
}
