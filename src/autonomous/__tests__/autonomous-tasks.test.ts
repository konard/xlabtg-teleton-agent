import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import {
  AutonomousTaskStore,
  getAutonomousTaskStore,
} from "../../memory/agent/autonomous-tasks.js";

describe("AutonomousTaskStore", () => {
  let db: InstanceType<typeof Database>;
  let store: AutonomousTaskStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    store = getAutonomousTaskStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── Task CRUD ─────────────────────────────────────────────────────────────

  it("creates a task with default values", () => {
    const task = store.createTask({ goal: "Monitor DeDust pools" });

    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(task.goal).toBe("Monitor DeDust pools");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.strategy).toBe("balanced");
    expect(task.currentStep).toBe(0);
    expect(task.successCriteria).toEqual([]);
    expect(task.failureConditions).toEqual([]);
    expect(task.constraints).toEqual({});
  });

  it("creates a task with all optional fields", () => {
    const task = store.createTask({
      goal: "Analyze TON project",
      successCriteria: ["report generated", "data stored"],
      failureConditions: ["3 consecutive errors"],
      constraints: { maxIterations: 50, maxDurationHours: 2, budgetTON: 0.5 },
      strategy: "conservative",
      retryPolicy: { maxRetries: 5, backoff: "exponential" },
      context: { projectId: "abc123" },
      priority: "high",
    });

    expect(task.successCriteria).toEqual(["report generated", "data stored"]);
    expect(task.failureConditions).toEqual(["3 consecutive errors"]);
    expect(task.constraints.maxIterations).toBe(50);
    expect(task.constraints.budgetTON).toBe(0.5);
    expect(task.strategy).toBe("conservative");
    expect(task.priority).toBe("high");
    expect(task.context).toEqual({ projectId: "abc123" });
    expect(task.retryPolicy).toEqual({ maxRetries: 5, backoff: "exponential" });
  });

  it("retrieves a task by id", () => {
    const created = store.createTask({ goal: "Test goal" });
    const fetched = store.getTask(created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.goal).toBe("Test goal");
  });

  it("returns undefined for non-existent task id", () => {
    expect(store.getTask("non-existent-id")).toBeUndefined();
  });

  it("lists all tasks", () => {
    store.createTask({ goal: "Task 1" });
    store.createTask({ goal: "Task 2" });
    store.createTask({ goal: "Task 3" });

    const tasks = store.listTasks();
    expect(tasks).toHaveLength(3);
  });

  it("filters tasks by status", () => {
    const t1 = store.createTask({ goal: "Task 1" });
    store.createTask({ goal: "Task 2" });

    store.updateTaskStatus(t1.id, "running");

    const running = store.listTasks({ status: "running" });
    const pending = store.listTasks({ status: "pending" });

    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(t1.id);
    expect(pending).toHaveLength(1);
  });

  it("returns active tasks (pending + running + paused)", () => {
    const t1 = store.createTask({ goal: "Task 1" });
    const t2 = store.createTask({ goal: "Task 2" });
    const t3 = store.createTask({ goal: "Task 3" });

    store.updateTaskStatus(t1.id, "running");
    store.updateTaskStatus(t2.id, "paused");
    store.updateTaskStatus(t3.id, "completed");

    const active = store.getActiveTasks();
    expect(active).toHaveLength(2);
    const ids = active.map((t) => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
  });

  it("updates task status to running and sets started_at", () => {
    const task = store.createTask({ goal: "Test" });
    expect(task.startedAt).toBeUndefined();

    const updated = store.updateTaskStatus(task.id, "running");
    expect(updated!.status).toBe("running");
    expect(updated!.startedAt).toBeDefined();
  });

  it("updates task status to completed and sets completed_at", () => {
    const task = store.createTask({ goal: "Test" });
    store.updateTaskStatus(task.id, "running");
    const completed = store.updateTaskStatus(task.id, "completed", { result: "done!" });

    expect(completed!.status).toBe("completed");
    expect(completed!.completedAt).toBeDefined();
    expect(completed!.result).toBe("done!");
  });

  it("deletes a task", () => {
    const task = store.createTask({ goal: "Delete me" });
    expect(store.deleteTask(task.id)).toBe(true);
    expect(store.getTask(task.id)).toBeUndefined();
  });

  it("increments step counter", () => {
    const task = store.createTask({ goal: "Step test" });
    expect(task.currentStep).toBe(0);

    store.incrementStep(task.id);
    store.incrementStep(task.id);

    const updated = store.getTask(task.id);
    expect(updated!.currentStep).toBe(2);
  });

  it("updates context", () => {
    const task = store.createTask({ goal: "Context test", context: { a: 1 } });
    store.updateContext(task.id, { a: 2, b: "new" });

    const updated = store.getTask(task.id);
    expect(updated!.context).toEqual({ a: 2, b: "new" });
  });

  // ─── Checkpoints ──────────────────────────────────────────────────────────

  it("saves and retrieves a checkpoint", () => {
    const task = store.createTask({ goal: "Checkpoint test" });
    const cp = store.saveCheckpoint({
      taskId: task.id,
      step: 3,
      state: { key: "value" },
      toolCalls: [{ tool: "web_fetch" }],
      nextActionHint: "Try fetching URL",
    });

    expect(cp.id).toBeDefined();
    expect(cp.taskId).toBe(task.id);
    expect(cp.step).toBe(3);
    expect(cp.state).toEqual({ key: "value" });
    expect(cp.toolCalls).toHaveLength(1);
    expect(cp.nextActionHint).toBe("Try fetching URL");
  });

  it("retrieves last checkpoint for a task", () => {
    const task = store.createTask({ goal: "Multi-checkpoint" });
    store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });
    store.saveCheckpoint({ taskId: task.id, step: 2, state: {}, toolCalls: [] });
    const last = store.saveCheckpoint({
      taskId: task.id,
      step: 3,
      state: { last: true },
      toolCalls: [],
    });

    const fetched = store.getLastCheckpoint(task.id);
    expect(fetched!.id).toBe(last.id);
    expect(fetched!.step).toBe(3);
  });

  it("updates last_checkpoint_id on task after save", () => {
    const task = store.createTask({ goal: "Checkpoint link test" });
    const cp = store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });

    const updated = store.getTask(task.id);
    expect(updated!.lastCheckpointId).toBe(cp.id);
  });

  it("cleans old checkpoints for completed tasks", () => {
    const task = store.createTask({ goal: "Old task" });
    store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });
    store.updateTaskStatus(task.id, "completed");

    // Force old timestamp by updating directly
    db.prepare("UPDATE task_checkpoints SET created_at = ? WHERE task_id = ?").run(
      Math.floor(Date.now() / 1000) - 9 * 86400, // 9 days ago
      task.id
    );

    const deleted = store.cleanOldCheckpoints(7);
    expect(deleted).toBeGreaterThan(0);
  });

  it("keeps only the last N checkpoints when saving (default 20)", () => {
    const task = store.createTask({ goal: "Long-running task" });
    store.updateTaskStatus(task.id, "running");

    for (let step = 1; step <= 100; step++) {
      store.saveCheckpoint({ taskId: task.id, step, state: { step }, toolCalls: [] });
    }

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    // Default keepLastN is 20; active task should still be capped to 20.
    expect(count).toBeLessThanOrEqual(20);
    expect(count).toBe(20);
  });

  it("honors a custom keepLastN value", () => {
    const task = store.createTask({ goal: "Custom keep" });
    store.updateTaskStatus(task.id, "running");

    for (let step = 1; step <= 25; step++) {
      store.saveCheckpoint({
        taskId: task.id,
        step,
        state: { step },
        toolCalls: [],
        keepLastN: 5,
      });
    }

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(5);
  });

  it("getLastCheckpoint still returns the most recent checkpoint after trimming", () => {
    const task = store.createTask({ goal: "Trim + last" });
    store.updateTaskStatus(task.id, "running");

    for (let step = 1; step <= 100; step++) {
      store.saveCheckpoint({ taskId: task.id, step, state: { step }, toolCalls: [] });
    }

    const last = store.getLastCheckpoint(task.id);
    expect(last).toBeDefined();
    expect(last!.step).toBe(100);
  });

  it("does not trim below keepLastN when fewer checkpoints exist", () => {
    const task = store.createTask({ goal: "Short task" });
    store.updateTaskStatus(task.id, "running");

    for (let step = 1; step <= 5; step++) {
      store.saveCheckpoint({ taskId: task.id, step, state: { step }, toolCalls: [] });
    }

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(5);
  });

  it("trims checkpoints independently per task", () => {
    const t1 = store.createTask({ goal: "Task 1" });
    const t2 = store.createTask({ goal: "Task 2" });
    store.updateTaskStatus(t1.id, "running");
    store.updateTaskStatus(t2.id, "running");

    for (let step = 1; step <= 30; step++) {
      store.saveCheckpoint({ taskId: t1.id, step, state: { step }, toolCalls: [], keepLastN: 3 });
      store.saveCheckpoint({ taskId: t2.id, step, state: { step }, toolCalls: [], keepLastN: 10 });
    }

    const c1 = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(t1.id) as {
        c: number;
      }
    ).c;
    const c2 = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(t2.id) as {
        c: number;
      }
    ).c;
    expect(c1).toBe(3);
    expect(c2).toBe(10);
  });

  // ─── Execution Logs ───────────────────────────────────────────────────────

  it("appends and retrieves execution logs", () => {
    const task = store.createTask({ goal: "Log test" });

    store.appendLog({
      taskId: task.id,
      step: 1,
      eventType: "plan",
      message: "Planning step 1",
      data: { toolName: "web_fetch" },
    });

    store.appendLog({
      taskId: task.id,
      step: 1,
      eventType: "tool_call",
      message: "Calling web_fetch",
    });

    const logs = store.getExecutionLogs(task.id);
    expect(logs).toHaveLength(2);
    expect(logs[0].eventType).toBe("plan");
    expect(logs[0].data).toEqual({ toolName: "web_fetch" });
    expect(logs[1].eventType).toBe("tool_call");
  });

  it("returns empty logs for non-existent task", () => {
    const logs = store.getExecutionLogs("nonexistent");
    expect(logs).toHaveLength(0);
  });

  // ─── paused_at timestamp ──────────────────────────────────────────────────

  it("sets paused_at when status transitions to paused", () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const task = store.createTask({ goal: "Pause me" });
    store.updateTaskStatus(task.id, "running");
    const paused = store.updateTaskStatus(task.id, "paused");
    const after = Math.floor(Date.now() / 1000) + 1;

    expect(paused!.pausedAt).toBeDefined();
    const ts = Math.floor(paused!.pausedAt!.getTime() / 1000);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("clears paused_at when task is resumed (status running)", () => {
    const task = store.createTask({ goal: "Resume me" });
    store.updateTaskStatus(task.id, "running");
    store.updateTaskStatus(task.id, "paused");
    const resumed = store.updateTaskStatus(task.id, "running");

    expect(resumed!.pausedAt).toBeUndefined();
  });

  // ─── cancelStalePausedTasks (AUDIT-M5) ───────────────────────────────────

  it("auto-cancels tasks paused longer than the TTL", () => {
    const task = store.createTask({ goal: "Stale paused task" });
    store.updateTaskStatus(task.id, "running");
    store.updateTaskStatus(task.id, "paused");

    // Backdate paused_at to 25 hours ago (beyond 24h TTL)
    const stalePausedAt = Math.floor(Date.now() / 1000) - 25 * 3600;
    db.prepare(`UPDATE autonomous_tasks SET paused_at = ? WHERE id = ?`).run(
      stalePausedAt,
      task.id
    );

    const cancelled = store.cancelStalePausedTasks(24);
    expect(cancelled).toBe(1);

    const fetched = store.getTask(task.id);
    expect(fetched!.status).toBe("cancelled");
    expect(fetched!.error).toBe("timeout-paused");
    expect(fetched!.completedAt).toBeDefined();
  });

  it("does not cancel tasks paused within the TTL", () => {
    const task = store.createTask({ goal: "Fresh paused task" });
    store.updateTaskStatus(task.id, "running");
    store.updateTaskStatus(task.id, "paused");

    // paused_at is just now — well within the 24h TTL
    const cancelled = store.cancelStalePausedTasks(24);
    expect(cancelled).toBe(0);

    const fetched = store.getTask(task.id);
    expect(fetched!.status).toBe("paused");
  });

  it("does not cancel running or pending tasks regardless of paused_at", () => {
    const t1 = store.createTask({ goal: "Running task" });
    const t2 = store.createTask({ goal: "Pending task" });
    store.updateTaskStatus(t1.id, "running");

    // Force-set paused_at on non-paused rows (shouldn't matter)
    const oldTs = Math.floor(Date.now() / 1000) - 48 * 3600;
    db.prepare(`UPDATE autonomous_tasks SET paused_at = ? WHERE id = ?`).run(oldTs, t1.id);
    db.prepare(`UPDATE autonomous_tasks SET paused_at = ? WHERE id = ?`).run(oldTs, t2.id);

    const cancelled = store.cancelStalePausedTasks(24);
    expect(cancelled).toBe(0);
    expect(store.getTask(t1.id)!.status).toBe("running");
    expect(store.getTask(t2.id)!.status).toBe("pending");
  });

  it("respects a custom TTL (e.g. 1 hour)", () => {
    const task1 = store.createTask({ goal: "2-hour stale task" });
    const task2 = store.createTask({ goal: "30-min fresh task" });
    store.updateTaskStatus(task1.id, "running");
    store.updateTaskStatus(task1.id, "paused");
    store.updateTaskStatus(task2.id, "running");
    store.updateTaskStatus(task2.id, "paused");

    // Backdate task1 by 2 hours; leave task2 at now
    db.prepare(`UPDATE autonomous_tasks SET paused_at = ? WHERE id = ?`).run(
      Math.floor(Date.now() / 1000) - 2 * 3600,
      task1.id
    );

    const cancelled = store.cancelStalePausedTasks(1);
    expect(cancelled).toBe(1);
    expect(store.getTask(task1.id)!.status).toBe("cancelled");
    expect(store.getTask(task2.id)!.status).toBe("paused");
  });

  // ─── Singleton ────────────────────────────────────────────────────────────

  it("getAutonomousTaskStore returns same instance for same db", () => {
    const s1 = getAutonomousTaskStore(db);
    const s2 = getAutonomousTaskStore(db);
    expect(s1).toBe(s2);
  });
});
