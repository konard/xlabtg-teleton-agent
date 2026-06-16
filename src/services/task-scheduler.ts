import type Database from "better-sqlite3";
import { getTaskStore, type Task, type TaskStore } from "../memory/agent/tasks.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("TaskScheduler");

const TICK_INTERVAL_MS = 60_000;

export interface TaskSchedulerOptions {
  db: Database.Database;
  /**
   * Executes a single due task. Implementations claim the task atomically
   * (via {@link TaskStore.claimTask}), run it, persist the result, and handle
   * recurrence/dependents. Errors are reported back to the scheduler via a
   * rejected promise but the scheduler only logs them — task-level failure
   * bookkeeping is the executor's responsibility.
   */
  executeTask: (task: Task) => Promise<void>;
  /** Override the tick interval (ms). Defaults to 60_000. Mainly for tests. */
  tickIntervalMs?: number;
}

/**
 * Decide when (or whether) a recurring task should run next.
 *
 * Pure scheduling-decision helper shared by the agent's recurrence rescheduler.
 * Keeping the math here — instead of inline next to the Telegram side effects in
 * `src/index.ts` — makes the two rules that govern recurrence directly testable:
 *
 * 1. A task only recurs while it has a positive `recurrenceInterval`.
 * 2. Recurrence stops once the next run would fall after `recurrenceUntil`.
 *
 * @returns the next `scheduledFor` Date, or `null` when the task should not
 *          recur (no/invalid interval, or `recurrenceUntil` has elapsed).
 */
export function computeNextRecurrence(
  task: Pick<Task, "recurrenceInterval" | "recurrenceUntil">,
  now: Date = new Date()
): Date | null {
  if (!task.recurrenceInterval || task.recurrenceInterval <= 0) return null;

  const nextRunAt = Math.floor(now.getTime() / 1000) + task.recurrenceInterval;
  const until = task.recurrenceUntil ? Math.floor(task.recurrenceUntil.getTime() / 1000) : null;
  if (until !== null && nextRunAt > until) return null;

  return new Date(nextRunAt * 1000);
}

/**
 * DB-backed dispatcher for scheduled and recurring tasks.
 *
 * Mirrors {@link WorkflowScheduler}: a 60-second tick loop queries the `tasks`
 * table for pending tasks whose `scheduled_for` is due and executes them. This
 * is the reliable execution path that does not depend on Telegram delivering a
 * Saved Messages `[TASK:]` reminder — tasks created via any API
 * (`telegram_create_scheduled_task`, network ingress, WebUI, predictions) are
 * picked up here.
 *
 * Double execution is prevented by {@link TaskStore.claimTask}: even if a
 * Saved Messages trigger and a scheduler tick race for the same task, only one
 * flips it from `pending` to `in_progress`. An in-memory guard additionally
 * keeps overlapping ticks from re-dispatching a task already running this tick.
 */
export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: TaskStore;
  private runningTaskIds = new Set<string>();
  private readonly tickIntervalMs: number;

  constructor(private opts: TaskSchedulerOptions) {
    this.store = getTaskStore(opts.db);
    this.tickIntervalMs = opts.tickIntervalMs ?? TICK_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.tick().catch((err) => {
      log.warn({ err }, "Task scheduler initial tick failed");
    });
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        log.warn({ err }, "Task scheduler tick failed");
      });
    }, this.tickIntervalMs);
    this.timer.unref?.();
    log.info("Task scheduler started");
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    log.info("Task scheduler stopped");
  }

  /**
   * Query and execute all due tasks. Public so tests can drive a single tick
   * deterministically without waiting on the timer.
   */
  async tick(): Promise<void> {
    const due = this.store.getDueTasks();
    for (const task of due) {
      if (this.runningTaskIds.has(task.id)) continue;
      // Skip tasks whose dependencies are not yet satisfied — those are fired
      // by the dependency resolver, not the scheduler.
      if (!this.store.canExecute(task.id)) continue;
      await this.execute(task);
    }
  }

  private async execute(task: Task): Promise<void> {
    this.runningTaskIds.add(task.id);
    try {
      await this.opts.executeTask(task);
    } catch (err) {
      log.error({ err, taskId: task.id }, "Task execution failed");
    } finally {
      this.runningTaskIds.delete(task.id);
    }
  }
}
