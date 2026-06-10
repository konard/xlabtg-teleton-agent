import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { TaskStore, getTaskStore } from "../../memory/agent/tasks.js";
import { TaskScheduler } from "../task-scheduler.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

describe("TaskStore claim + due-task queries", () => {
  let db: InstanceType<typeof Database>;
  let store: TaskStore;

  beforeEach(() => {
    db = createDb();
    store = getTaskStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("claimTask flips pending → in_progress exactly once", () => {
    const task = store.createTask({ description: "claim me" });

    expect(store.claimTask(task.id)).toBe(true);
    expect(store.getTask(task.id)?.status).toBe("in_progress");
    expect(store.getTask(task.id)?.startedAt).toBeInstanceOf(Date);

    // Second claim returns false (already in_progress).
    expect(store.claimTask(task.id)).toBe(false);
  });

  it("claimTask refuses to reclaim terminal tasks", () => {
    const task = store.createTask({ description: "done already" });
    store.completeTask(task.id, "ok");

    expect(store.claimTask(task.id)).toBe(false);
    expect(store.getTask(task.id)?.status).toBe("done");
  });

  it("claimTask returns false for unknown task id", () => {
    expect(store.claimTask("does-not-exist")).toBe(false);
  });

  it("getDueTasks returns only pending tasks whose scheduled_for has elapsed", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    const due = store.createTask({ description: "past", scheduledFor: past });
    store.createTask({ description: "future", scheduledFor: future });
    store.createTask({ description: "no schedule" });
    const inProgress = store.createTask({ description: "running", scheduledFor: past });
    store.startTask(inProgress.id);

    const result = store.getDueTasks();
    expect(result.map((t) => t.id)).toEqual([due.id]);
  });

  it("getDueTasks accepts a custom now and orders by priority desc", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    const low = store.createTask({ description: "low", scheduledFor: past, priority: 1 });
    const high = store.createTask({ description: "high", scheduledFor: past, priority: 9 });

    const result = store.getDueTasks(Math.floor(past.getTime() / 1000) + 1);
    expect(result.map((t) => t.id)).toEqual([high.id, low.id]);
  });
});

describe("TaskScheduler", () => {
  let db: InstanceType<typeof Database>;
  let store: TaskStore;

  beforeEach(() => {
    db = createDb();
    store = getTaskStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("tick() executes every due task once", async () => {
    const past = new Date(Date.now() - 1000);
    const t1 = store.createTask({ description: "one", scheduledFor: past });
    const t2 = store.createTask({ description: "two", scheduledFor: past });

    const executeTask = vi.fn().mockResolvedValue(undefined);
    const scheduler = new TaskScheduler({ db, executeTask });

    await scheduler.tick();

    expect(executeTask).toHaveBeenCalledTimes(2);
    const calledIds = executeTask.mock.calls.map(([t]) => t.id).sort();
    expect(calledIds).toEqual([t1.id, t2.id].sort());
  });

  it("tick() skips tasks scheduled for the future", async () => {
    store.createTask({ description: "later", scheduledFor: new Date(Date.now() + 60_000) });

    const executeTask = vi.fn().mockResolvedValue(undefined);
    const scheduler = new TaskScheduler({ db, executeTask });

    await scheduler.tick();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it("tick() skips tasks whose dependencies are not satisfied", async () => {
    const parent = store.createTask({ description: "parent" });
    const child = store.createTask({
      description: "child",
      scheduledFor: new Date(Date.now() - 1000),
      dependsOn: [parent.id],
    });

    const executeTask = vi.fn().mockResolvedValue(undefined);
    const scheduler = new TaskScheduler({ db, executeTask });

    await scheduler.tick();
    expect(executeTask).not.toHaveBeenCalledWith(expect.objectContaining({ id: child.id }));
  });

  it("tick() swallows executor errors without crashing the loop", async () => {
    const past = new Date(Date.now() - 1000);
    store.createTask({ description: "fails", scheduledFor: past });
    store.createTask({ description: "succeeds", scheduledFor: past });

    const executeTask = vi
      .fn<(task: { id: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const scheduler = new TaskScheduler({ db, executeTask });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(executeTask).toHaveBeenCalledTimes(2);
  });

  it("start() schedules ticks at the configured interval and stop() clears them", async () => {
    vi.useFakeTimers();
    try {
      // Realistic executor: atomic claim + complete, so the same task isn't
      // re-executed on the next tick.
      const executeTask = vi.fn(async (task: { id: string }) => {
        if (store.claimTask(task.id)) {
          store.completeTask(task.id, "ok");
        }
      });
      const scheduler = new TaskScheduler({ db, executeTask, tickIntervalMs: 1_000 });

      const past = new Date(Date.now() - 1000);
      store.createTask({ description: "first", scheduledFor: past });

      scheduler.start();
      // Initial tick is queued via a microtask — flush all pending promises.
      await Promise.resolve();
      await Promise.resolve();
      expect(executeTask).toHaveBeenCalledTimes(1);

      store.createTask({ description: "second", scheduledFor: past });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(executeTask).toHaveBeenCalledTimes(2);

      scheduler.stop();
      store.createTask({ description: "third", scheduledFor: past });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(executeTask).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
