import type {
  AutonomousTask,
  AutonomousTaskStatus,
  TaskCheckpoint,
} from "../memory/agent/autonomous-tasks.js";
import type { AutonomousTaskStore } from "../memory/agent/autonomous-tasks.js";
import { PolicyEngine, DEFAULT_POLICY_CONFIG } from "./policy-engine.js";
import type { PolicyConfig } from "./policy-engine.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AutonomousLoop");

export interface LoopDependencies {
  /** Call the LLM to plan the next action given the current goal/state */
  planNextAction: (
    task: AutonomousTask,
    history: unknown[],
    checkpoint?: TaskCheckpoint
  ) => Promise<PlannedAction>;

  /** Execute a single tool call */
  executeTool: (toolName: string, params: Record<string, unknown>) => Promise<ToolExecutionResult>;

  /** Evaluate whether task success criteria are met */
  evaluateSuccess: (task: AutonomousTask, lastResult: ToolExecutionResult) => Promise<boolean>;

  /** Perform LLM self-reflection on progress */
  selfReflect: (
    task: AutonomousTask,
    action: PlannedAction,
    result: ToolExecutionResult
  ) => Promise<Reflection>;

  /** Send escalation notification to the user */
  escalate: (task: AutonomousTask, reason: string, details?: unknown) => Promise<void>;
}

export interface PlannedAction {
  toolName: string;
  params: Record<string, unknown>;
  reasoning?: string;
  tonAmount?: number;
  confidence?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface Reflection {
  progressSummary: string;
  isStuck: boolean;
  adjustments?: {
    contextAdditions?: Record<string, unknown>;
    nextActionHint?: string;
  };
  shouldEscalate?: boolean;
  escalationReason?: string;
}

export interface LoopResult {
  status: "completed" | "failed" | "paused" | "cancelled";
  output?: unknown;
  error?: string;
  totalSteps: number;
  durationMs: number;
}

/**
 * Signals the loop should exit because `stop()` was called. Thrown by
 * `throwIfAborted()` and swallowed at the top of `run()` so an abort during
 * any `await` unwinds cleanly without tripping the generic catch block that
 * marks the task `failed`.
 */
class LoopAbortedError extends Error {
  constructor() {
    super("Loop aborted");
    this.name = "LoopAbortedError";
  }
}

/**
 * Terminal statuses set by external callers (pause / cancel / restore) — the
 * loop must not overwrite them. See AUDIT-H4 (issue #266).
 */
const EXTERNAL_TERMINAL_STATUSES = new Set<AutonomousTaskStatus>([
  "paused",
  "cancelled",
  "completed",
  "failed",
]);

export class AutonomousLoop {
  private policyEngine: PolicyEngine;
  private abortController: AbortController;
  private recentActions: string[] = [];

  constructor(
    private store: AutonomousTaskStore,
    private deps: LoopDependencies,
    policyConfig?: PolicyConfig
  ) {
    this.policyEngine = new PolicyEngine(policyConfig ?? DEFAULT_POLICY_CONFIG);
    this.abortController = new AbortController();
  }

  /** Request graceful stop of the loop */
  stop(): void {
    this.abortController.abort();
  }

  /**
   * Throws {@link LoopAbortedError} if `stop()` has been called. Call this
   * immediately after every `await` so an in-flight step cannot race past a
   * pause/cancel and overwrite the status the external caller just wrote.
   */
  private throwIfAborted(): void {
    if (this.abortController.signal.aborted) {
      throw new LoopAbortedError();
    }
  }

  /**
   * Write a status transition only if the DB doesn't already hold an
   * external terminal status. Prevents the loop's delayed `.finally`/catch
   * from clobbering `paused` / `cancelled` / `completed` / `failed` that a
   * concurrent `pauseTask()` / `stopTask()` just wrote.
   */
  private safeUpdateStatus(
    taskId: string,
    status: AutonomousTaskStatus,
    opts?: { result?: string; error?: string }
  ): boolean {
    const existing = this.store.getTask(taskId);
    if (existing && EXTERNAL_TERMINAL_STATUSES.has(existing.status) && existing.status !== status) {
      log.debug(
        { taskId, attempted: status, existing: existing.status },
        "Skipping status overwrite of externally-set terminal status"
      );
      return false;
    }
    this.store.updateTaskStatus(taskId, status, opts);
    return true;
  }

  async run(task: AutonomousTask): Promise<LoopResult> {
    const startTime = Date.now();
    let current = task;

    log.info({ taskId: task.id, goal: task.goal }, "Starting autonomous loop");

    if (this.abortController.signal.aborted) {
      log.info({ taskId: task.id }, "Loop aborted before start");
      return {
        status: "cancelled",
        totalSteps: current.currentStep,
        durationMs: Date.now() - startTime,
      };
    }

    // Mark task as running. We intentionally bypass safeUpdateStatus here:
    // resumeTask() calls run() with the task still in 'paused', and the loop
    // must be allowed to flip it back to 'running'. Once it's 'running' the
    // safeUpdateStatus guard kicks in for every subsequent transition.
    this.store.updateTaskStatus(task.id, "running");
    current = this.store.getTask(task.id) ?? current;

    // Load last checkpoint if resuming
    let checkpoint: TaskCheckpoint | undefined;
    if (task.lastCheckpointId) {
      checkpoint = this.store.getLastCheckpoint(task.id);
      if (checkpoint) {
        log.info({ taskId: task.id, step: checkpoint.step }, "Resuming from checkpoint");
        this.store.appendLog({
          taskId: task.id,
          step: checkpoint.step,
          eventType: "info",
          message: `Resuming from checkpoint at step ${checkpoint.step}`,
        });
      }
    }

    const history: unknown[] = [];

    try {
      while (!this.abortController.signal.aborted) {
        current = this.store.getTask(task.id) ?? current;

        if (current.status === "cancelled") {
          return {
            status: "cancelled",
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        if (current.status === "paused") {
          log.info({ taskId: task.id }, "Task is paused, stopping loop");
          return {
            status: "paused",
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        // 1. Plan next action
        log.debug({ taskId: task.id, step: current.currentStep }, "Planning next action");
        let action: PlannedAction;
        try {
          this.policyEngine.recordApiCall();
          action = await deps_planWithTimeout(this.deps, current, history, checkpoint);
          this.throwIfAborted();
          checkpoint = undefined; // used once
        } catch (err) {
          if (err instanceof LoopAbortedError) throw err;
          const error = err instanceof Error ? err.message : String(err);
          this.store.appendLog({
            taskId: task.id,
            step: current.currentStep,
            eventType: "error",
            message: `Planning failed: ${error}`,
          });
          this.safeUpdateStatus(task.id, "failed", { error });
          return {
            status: "failed",
            error,
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        this.store.appendLog({
          taskId: task.id,
          step: current.currentStep,
          eventType: "plan",
          message: `Planned: ${action.toolName}${action.reasoning ? ` — ${action.reasoning}` : ""}`,
          data: { toolName: action.toolName, params: action.params },
        });

        // 2. Check policies / guardrails
        const policyCheck = this.policyEngine.satisfiesPolicies(current, {
          toolName: action.toolName,
          tonAmount: action.tonAmount,
          recentActions: this.recentActions,
        });

        if (!policyCheck.allowed) {
          const reasons = policyCheck.violations.map((v) => v.message).join("; ");
          log.warn({ taskId: task.id, reasons }, "Policy violation — stopping task");
          this.store.appendLog({
            taskId: task.id,
            step: current.currentStep,
            eventType: "error",
            message: `Policy violation: ${reasons}`,
          });
          this.safeUpdateStatus(task.id, "failed", { error: `Policy violation: ${reasons}` });
          return {
            status: "failed",
            error: reasons,
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        if (policyCheck.requiresEscalation) {
          const reason =
            policyCheck.violations.map((v) => v.message).join("; ") || "Requires confirmation";
          log.info({ taskId: task.id, reason }, "Escalating to user");
          this.store.appendLog({
            taskId: task.id,
            step: current.currentStep,
            eventType: "escalate",
            message: `Escalating: ${reason}`,
          });
          await this.deps.escalate(current, reason, { action });
          this.throwIfAborted();
          this.safeUpdateStatus(task.id, "paused");
          return {
            status: "paused",
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        // 3. Execute the tool
        this.policyEngine.recordToolCall();
        log.debug({ taskId: task.id, tool: action.toolName }, "Executing tool");
        this.store.appendLog({
          taskId: task.id,
          step: current.currentStep,
          eventType: "tool_call",
          message: `Calling tool: ${action.toolName}`,
          data: action.params,
        });

        let result: ToolExecutionResult;
        try {
          result = await this.deps.executeTool(action.toolName, action.params);
          this.throwIfAborted();
        } catch (err) {
          if (err instanceof LoopAbortedError) throw err;
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        this.store.appendLog({
          taskId: task.id,
          step: current.currentStep,
          eventType: "tool_result",
          message: result.success ? "Tool succeeded" : `Tool failed: ${result.error}`,
          data: { success: result.success, data: result.data, error: result.error },
        });

        history.push({ action, result });
        this.recentActions.push(action.toolName);
        if (this.recentActions.length > 20) this.recentActions.shift();

        // 4. Self-reflection
        log.debug({ taskId: task.id }, "Self-reflecting on progress");
        let reflection: Reflection;
        try {
          this.policyEngine.recordApiCall();
          reflection = await this.deps.selfReflect(current, action, result);
          this.throwIfAborted();
        } catch (err) {
          if (err instanceof LoopAbortedError) throw err;
          log.warn({ err }, "Self-reflection failed, continuing");
          reflection = { progressSummary: "Reflection unavailable", isStuck: false };
        }

        this.store.appendLog({
          taskId: task.id,
          step: current.currentStep,
          eventType: "reflect",
          message: reflection.progressSummary,
          data: { isStuck: reflection.isStuck, adjustments: reflection.adjustments },
        });

        // Handle reflection outcomes
        if (reflection.shouldEscalate) {
          const reason = reflection.escalationReason ?? "Agent flagged uncertainty";
          await this.deps.escalate(current, reason);
          this.throwIfAborted();
          this.safeUpdateStatus(task.id, "paused");
          return {
            status: "paused",
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }

        if (reflection.isStuck) {
          const maxConsecutive = 3;
          const shouldEscalate = this.policyEngine.recordUncertain();
          if (shouldEscalate) {
            await this.deps.escalate(
              current,
              `Agent appears stuck after ${maxConsecutive} reflections`
            );
            this.throwIfAborted();
            this.safeUpdateStatus(task.id, "paused");
            return {
              status: "paused",
              totalSteps: current.currentStep,
              durationMs: Date.now() - startTime,
            };
          }
        } else {
          this.policyEngine.resetUncertainCount();
        }

        // Apply adjustments to context
        if (reflection.adjustments?.contextAdditions) {
          const updatedContext = { ...current.context, ...reflection.adjustments.contextAdditions };
          this.store.updateContext(task.id, updatedContext);
          current = this.store.getTask(task.id) ?? current;
        }

        // 5. Increment step counter
        this.store.incrementStep(task.id);
        current = this.store.getTask(task.id) ?? current;

        // 6. Save checkpoint
        const cp = this.store.saveCheckpoint({
          taskId: task.id,
          step: current.currentStep,
          state: { context: current.context, lastResult: result, history: history.slice(-5) },
          toolCalls: history.slice(-10).map((h) => (h as { action: unknown }).action),
          nextActionHint: reflection.adjustments?.nextActionHint,
        });

        this.store.appendLog({
          taskId: task.id,
          step: current.currentStep,
          eventType: "checkpoint",
          message: `Checkpoint saved (step ${current.currentStep})`,
          data: { checkpointId: cp.id },
        });

        // 7. Check success criteria
        const succeeded = await this.deps.evaluateSuccess(current, result);
        this.throwIfAborted();
        if (succeeded) {
          log.info({ taskId: task.id }, "Task completed successfully");
          this.safeUpdateStatus(task.id, "completed", {
            result: JSON.stringify(result.data ?? "completed"),
          });
          return {
            status: "completed",
            output: result.data,
            totalSteps: current.currentStep,
            durationMs: Date.now() - startTime,
          };
        }
      }

      // Aborted via stop() (while-loop header check)
      this.safeUpdateStatus(task.id, "cancelled");
      return {
        status: "cancelled",
        totalSteps: current.currentStep,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof LoopAbortedError) {
        log.info({ taskId: task.id }, "Loop aborted mid-step — preserving external status");
        // Whoever aborted us (pauseTask / stopTask) already wrote the right
        // status. Don't clobber it.
        const final = this.store.getTask(task.id);
        const status = (final?.status ?? "cancelled") as LoopResult["status"];
        return {
          status:
            status === "paused" ||
            status === "cancelled" ||
            status === "completed" ||
            status === "failed"
              ? status
              : "cancelled",
          totalSteps: final?.currentStep ?? current.currentStep,
          durationMs: Date.now() - startTime,
        };
      }
      const error = err instanceof Error ? err.message : String(err);
      log.error({ taskId: task.id, err }, "Autonomous loop crashed");
      this.safeUpdateStatus(task.id, "failed", { error });
      return {
        status: "failed",
        error,
        totalSteps: current.currentStep,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

async function deps_planWithTimeout(
  deps: LoopDependencies,
  task: AutonomousTask,
  history: unknown[],
  checkpoint?: TaskCheckpoint
): Promise<PlannedAction> {
  const PLAN_TIMEOUT_MS = 30000;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Planning timed out after 30s")), PLAN_TIMEOUT_MS)
  );
  return Promise.race([deps.planNextAction(task, history, checkpoint), timeout]);
}
