import type { TelegramBridge } from "../telegram/bridge.js";
import type { WorkflowStore } from "./workflows.js";
import type { CallApiAction, Workflow, WorkflowAction } from "./workflows.js";
import { createLogger } from "../utils/logger.js";
import {
  DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS,
  MAX_WORKFLOW_HTTP_TIMEOUT_MS,
  MIN_WORKFLOW_HTTP_TIMEOUT_MS,
} from "../constants/timeouts.js";

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
      const res = await this.fetchWithTimeout(action, init);
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

  private async fetchWithTimeout(action: CallApiAction, init: RequestInit): Promise<Response> {
    const timeoutMs = workflowHttpTimeoutMs(action);
    const controller = new AbortController();
    let timeoutError: Error | null = null;
    const fetchPromise = fetch(action.url, { ...init, signal: controller.signal });

    const timer = setTimeout(() => {
      timeoutError = new Error(`HTTP request to ${action.url} timed out after ${timeoutMs}ms`);
      controller.abort(timeoutError);
    }, timeoutMs);
    timer.unref?.();

    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          if (timeoutError) {
            reject(timeoutError);
          }
        },
        { once: true }
      );
    });

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
      if (timeoutError && controller.signal.aborted) {
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function workflowHttpTimeoutMs(action: CallApiAction): number {
  if (action.timeoutMs === undefined) {
    return DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS;
  }

  if (
    !Number.isInteger(action.timeoutMs) ||
    action.timeoutMs < MIN_WORKFLOW_HTTP_TIMEOUT_MS ||
    action.timeoutMs > MAX_WORKFLOW_HTTP_TIMEOUT_MS
  ) {
    throw new Error(
      `Invalid timeoutMs for call_api action: expected an integer between ${MIN_WORKFLOW_HTTP_TIMEOUT_MS} and ${MAX_WORKFLOW_HTTP_TIMEOUT_MS}`
    );
  }

  return action.timeoutMs;
}
