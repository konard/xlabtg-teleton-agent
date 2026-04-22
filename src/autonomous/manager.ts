import type { AutonomousTask, TaskConstraints } from "../memory/agent/autonomous-tasks.js";
import type { AutonomousTaskStore } from "../memory/agent/autonomous-tasks.js";
import type { TaskStrategy, TaskPriority } from "../memory/agent/autonomous-tasks.js";
import { getAutonomousTaskStore } from "../memory/agent/autonomous-tasks.js";
import { AutonomousLoop } from "./loop.js";
import type {
  LoopDependencies,
  LoopResult,
  PlannedAction,
  ToolExecutionResult,
  Reflection,
} from "./loop.js";
import type { PolicyConfig } from "./policy-engine.js";
import { DEFAULT_POLICY_CONFIG } from "./policy-engine.js";
import { createLogger } from "../utils/logger.js";
import type Database from "better-sqlite3";

const log = createLogger("AutonomousManager");

const MAX_PARALLEL_TASKS = 10;

export interface AutonomousManagerConfig {
  policyConfig?: PolicyConfig;
  maxParallelTasks?: number;
}

export interface CreateTaskInput {
  goal: string;
  successCriteria?: string[];
  failureConditions?: string[];
  constraints?: TaskConstraints;
  strategy?: TaskStrategy;
  retryPolicy?: { maxRetries: number; backoff: "linear" | "exponential" };
  context?: Record<string, unknown>;
  priority?: TaskPriority;
}

export class AutonomousTaskManager {
  private store: AutonomousTaskStore;
  private runningLoops = new Map<string, AutonomousLoop>();
  private loopCompletions = new Map<string, Promise<void>>();
  private config: Required<AutonomousManagerConfig>;
  private loopDeps: LoopDependencies;

  constructor(
    db: Database.Database,
    loopDeps: LoopDependencies,
    config: AutonomousManagerConfig = {}
  ) {
    this.store = getAutonomousTaskStore(db);
    this.loopDeps = loopDeps;
    this.config = {
      policyConfig: config.policyConfig ?? DEFAULT_POLICY_CONFIG,
      maxParallelTasks: config.maxParallelTasks ?? MAX_PARALLEL_TASKS,
    };
  }

  /** Create a new autonomous task and start it immediately. */
  async startTask(input: CreateTaskInput): Promise<AutonomousTask> {
    const running = this.runningLoops.size;
    if (running >= this.config.maxParallelTasks) {
      throw new Error(
        `Maximum parallel tasks (${this.config.maxParallelTasks}) reached. Pause or stop existing tasks first.`
      );
    }

    const task = this.store.createTask({
      goal: input.goal,
      successCriteria: input.successCriteria,
      failureConditions: input.failureConditions,
      constraints: input.constraints,
      strategy: input.strategy,
      retryPolicy: input.retryPolicy,
      context: input.context,
      priority: input.priority,
    });

    log.info({ taskId: task.id }, "Starting autonomous task");

    this.runLoop(task);

    return task;
  }

  private runLoop(task: AutonomousTask): void {
    const loop = new AutonomousLoop(this.store, this.loopDeps, this.config.policyConfig);
    this.runningLoops.set(task.id, loop);

    // Use a composite key so pause/resume (which replaces the runningLoops
    // entry) still tracks each loop individually for stopAllAndWait().
    const completionKey = `${task.id}:${Date.now()}:${Math.random()}`;
    const completion = loop
      .run(task)
      .then((result: LoopResult) => {
        log.info({ taskId: task.id, result }, "Autonomous loop finished");
      })
      .catch((err: unknown) => {
        log.error({ taskId: task.id, err }, "Autonomous loop error");
      })
      .finally(() => {
        // Only remove ourselves; if pause/resume replaced the entry with a
        // fresh loop, leave the newer registration alone.
        if (this.runningLoops.get(task.id) === loop) {
          this.runningLoops.delete(task.id);
        }
        this.loopCompletions.delete(completionKey);
      });

    this.loopCompletions.set(completionKey, completion);
  }

  /** Pause a running task. */
  pauseTask(taskId: string): AutonomousTask | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;

    const loop = this.runningLoops.get(taskId);
    if (loop) {
      loop.stop();
      // Drop the loop from the map immediately so resumeTask() can start a new
      // one. The old loop's .finally() will no-op once the hung await settles.
      this.runningLoops.delete(taskId);
    }

    return this.store.updateTaskStatus(taskId, "paused");
  }

  /** Resume a paused task. */
  resumeTask(taskId: string): AutonomousTask | undefined {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== "paused") return task;

    this.runLoop(task);
    return this.store.getTask(taskId);
  }

  /** Stop and cancel a task. */
  stopTask(taskId: string): AutonomousTask | undefined {
    const loop = this.runningLoops.get(taskId);
    if (loop) {
      loop.stop();
      this.runningLoops.delete(taskId);
    }
    return this.store.updateTaskStatus(taskId, "cancelled");
  }

  /** Force-stop all running tasks. */
  stopAll(): void {
    for (const [id, loop] of this.runningLoops) {
      log.info({ taskId: id }, "Force-stopping autonomous task");
      loop.stop();
    }
    this.runningLoops.clear();
  }

  /**
   * Request stop on all running loops and wait for their in-flight steps to
   * finish. Resolves once every loop's `.finally` handler has run so the
   * caller can safely close the database without racing a pending write.
   */
  async stopAllAndWait(): Promise<void> {
    const pending = Array.from(this.loopCompletions.values());
    this.stopAll();
    if (pending.length === 0) return;
    // Completions are built from `.then().catch().finally()` chains and never
    // reject, but guard against that anyway so shutdown always resolves.
    await Promise.allSettled(pending);
  }

  /**
   * Restore active tasks on agent startup:
   *   - "running" tasks survived a crash → resume from last checkpoint.
   *   - "pending" tasks were queued (e.g. from the CLI) while no agent was
   *     around to execute them → start them now. This is what unblocks the
   *     bug from issue #222 where CLI-created tasks would sit forever.
   */
  async restoreInterruptedTasks(): Promise<number> {
    const active = this.store.getActiveTasks();
    let restored = 0;

    for (const task of active) {
      if (task.status === "running") {
        log.info({ taskId: task.id }, "Restoring interrupted task from checkpoint");
        this.store.appendLog({
          taskId: task.id,
          step: task.currentStep,
          eventType: "info",
          message: "Agent restarted — resuming from last checkpoint",
        });
        this.runLoop(task);
        restored++;
      } else if (task.status === "pending") {
        log.info({ taskId: task.id }, "Starting queued pending task");
        this.store.appendLog({
          taskId: task.id,
          step: task.currentStep,
          eventType: "info",
          message: "Agent started — starting queued task",
        });
        this.runLoop(task);
        restored++;
      }
    }

    return restored;
  }

  getRunningTaskIds(): string[] {
    return Array.from(this.runningLoops.keys());
  }

  isTaskRunning(taskId: string): boolean {
    return this.runningLoops.has(taskId);
  }

  getStore(): AutonomousTaskStore {
    return this.store;
  }
}

/**
 * Brief description of a tool surfaced to the planner LLM so it can pick a
 * real tool name instead of hallucinating one.
 */
export interface AvailableToolInfo {
  name: string;
  description: string;
}

/** Build default LoopDependencies using the agent runtime for LLM calls */
export function buildDefaultLoopDeps(opts: {
  callLLM: (prompt: string) => Promise<string>;
  callTool: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  notify: (message: string, taskId: string) => Promise<void>;
  /**
   * Return the tools the planner may consider for this task. When omitted,
   * the planner receives no tool list and must rely on the LLM's prior
   * knowledge — which is what issue #224 reports as "does not see all
   * available tools". Integration code should always supply this.
   */
  listTools?: (task: AutonomousTask) => Promise<AvailableToolInfo[]> | AvailableToolInfo[];
}): LoopDependencies {
  return {
    async planNextAction(task, history, checkpoint): Promise<PlannedAction> {
      const historyStr = JSON.stringify((history as unknown[]).slice(-5));
      const hint = checkpoint?.nextActionHint ? `\nHint: ${checkpoint.nextActionHint}` : "";

      const tools = opts.listTools ? await opts.listTools(task) : [];
      const toolsBlock =
        tools.length > 0
          ? [
              `Available tools (pick exactly one by name):`,
              ...tools.map((t) => `- ${t.name}: ${t.description}`),
            ].join("\n")
          : `Available tools: (none were provided — respond with {"toolName":"noop"} if you cannot act)`;

      const prompt = [
        `You are an autonomous agent working on this goal: "${task.goal}"`,
        `Success criteria: ${JSON.stringify(task.successCriteria)}`,
        `Current step: ${task.currentStep}`,
        `Recent history: ${historyStr}${hint}`,
        `Context: ${JSON.stringify(task.context)}`,
        `Strategy: ${task.strategy}`,
        ``,
        toolsBlock,
        ``,
        `Respond with a JSON object: {"toolName":"<tool>","params":{...},"reasoning":"<why>","confidence":0.9}`,
        `toolName MUST be one of the names listed above (or "noop" if none apply).`,
      ].join("\n");

      const raw = await opts.callLLM(prompt);
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in LLM response");
        const parsed = JSON.parse(jsonMatch[0]) as PlannedAction;
        if (!parsed.toolName) throw new Error("Missing toolName in planned action");
        return parsed;
      } catch {
        return { toolName: "noop", params: {}, reasoning: raw, confidence: 0.5 };
      }
    },

    async executeTool(toolName, params): Promise<ToolExecutionResult> {
      const start = Date.now();
      try {
        const data = await opts.callTool(toolName, params);
        return { success: true, data, durationMs: Date.now() - start };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    },

    async evaluateSuccess(task, lastResult): Promise<boolean> {
      if (task.successCriteria.length === 0) return lastResult.success;
      // Simple heuristic: if last tool succeeded and we have criteria, let LLM decide
      if (!lastResult.success) return false;
      return false; // LLM evaluation happens in selfReflect — loop continues
    },

    async selfReflect(task, action, result): Promise<Reflection> {
      const prompt = [
        `You are evaluating progress on this autonomous task:`,
        `Goal: "${task.goal}"`,
        `Success criteria: ${JSON.stringify(task.successCriteria)}`,
        `Last action: ${action.toolName} — ${JSON.stringify(action.params)}`,
        `Result: ${JSON.stringify({ success: result.success, data: result.data, error: result.error })}`,
        `Current step: ${task.currentStep}`,
        ``,
        `Answer with JSON: {"progressSummary":"...","isStuck":false,"goalAchieved":false,"nextActionHint":"..."}`,
        `- goalAchieved: true if all success criteria are met`,
        `- isStuck: true if no progress is being made`,
      ].join("\n");

      try {
        const raw = await opts.callLLM(prompt);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON");
        const parsed = JSON.parse(jsonMatch[0]) as {
          progressSummary?: string;
          isStuck?: boolean;
          goalAchieved?: boolean;
          nextActionHint?: string;
        };
        return {
          progressSummary: parsed.progressSummary ?? "Progress evaluated",
          isStuck: parsed.isStuck ?? false,
          adjustments: parsed.nextActionHint
            ? { nextActionHint: parsed.nextActionHint }
            : undefined,
          shouldEscalate: false,
        };
      } catch {
        return { progressSummary: "Reflection failed", isStuck: false };
      }
    },

    async escalate(task, reason): Promise<void> {
      const msg = `⚠️ Autonomous task "${task.goal}" requires your attention:\n${reason}`;
      await opts.notify(msg, task.id);
    },
  };
}
