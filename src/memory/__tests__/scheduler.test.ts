import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MemoryPrioritizationScheduler } from "../scheduler.js";
import { getAutonomousTaskStore } from "../agent/autonomous-tasks.js";

describe("MemoryPrioritizationScheduler.runOnce", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("cleans old checkpoints for inactive tasks on each run", async () => {
    const store = getAutonomousTaskStore(db);
    const task = store.createTask({ goal: "Completed task" });
    store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });
    store.updateTaskStatus(task.id, "completed");

    // Force old timestamp (9 days ago) for the checkpoint.
    db.prepare("UPDATE task_checkpoints SET created_at = ? WHERE task_id = ?").run(
      Math.floor(Date.now() / 1000) - 9 * 86400,
      task.id
    );

    const scheduler = new MemoryPrioritizationScheduler(db, {
      enabled: true,
      interval_minutes: 60,
    });
    await scheduler.runOnce();

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);
  });

  it("preserves checkpoints for active tasks even when older than retention window", async () => {
    const store = getAutonomousTaskStore(db);
    const task = store.createTask({ goal: "Active task" });
    store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });
    store.updateTaskStatus(task.id, "running");

    db.prepare("UPDATE task_checkpoints SET created_at = ? WHERE task_id = ?").run(
      Math.floor(Date.now() / 1000) - 30 * 86400,
      task.id
    );

    const scheduler = new MemoryPrioritizationScheduler(db, {
      enabled: true,
      interval_minutes: 60,
    });
    await scheduler.runOnce();

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });

  it("respects custom checkpoint_retention_days from config", async () => {
    const store = getAutonomousTaskStore(db);
    const task = store.createTask({ goal: "Recently completed" });
    store.saveCheckpoint({ taskId: task.id, step: 1, state: {}, toolCalls: [] });
    store.updateTaskStatus(task.id, "completed");

    // 3 days old: older than custom 2-day retention, younger than default 7-day.
    db.prepare("UPDATE task_checkpoints SET created_at = ? WHERE task_id = ?").run(
      Math.floor(Date.now() / 1000) - 3 * 86400,
      task.id
    );

    const scheduler = new MemoryPrioritizationScheduler(db, {
      enabled: true,
      interval_minutes: 60,
      retention: { checkpoint_retention_days: 2 },
    });
    await scheduler.runOnce();

    const count = (
      db.prepare(`SELECT COUNT(*) as c FROM task_checkpoints WHERE task_id = ?`).get(task.id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);
  });
});
