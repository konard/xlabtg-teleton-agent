import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { TaskStore, getTaskStore } from "../agent/tasks.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

// ── TaskStore Tests ──────────────────────────────────────────────────────────

describe("TaskStore", () => {
  let db: InstanceType<typeof Database>;
  let store: TaskStore;

  beforeEach(() => {
    db = createDb();
    store = getTaskStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── createTask ─────────────────────────────────────────────────────────────

  describe("createTask()", () => {
    it("creates task with default status 'pending'", () => {
      const task = store.createTask({ description: "test task" });
      expect(task.status).toBe("pending");
      expect(task.description).toBe("test task");
      expect(task.id).toBeTruthy();
    });

    it("creates task with specified priority", () => {
      const task = store.createTask({ description: "high priority", priority: 8 });
      expect(task.priority).toBe(8);
    });

    it("creates task with scheduledFor date", () => {
      const futureDate = new Date(Date.now() + 3600_000);
      const task = store.createTask({ description: "scheduled", scheduledFor: futureDate });
      expect(task.scheduledFor?.getTime()).toBeCloseTo(futureDate.getTime(), -3);
    });

    it("creates task with payload", () => {
      const payload = JSON.stringify({ type: "agent_task", instructions: "do something" });
      const task = store.createTask({ description: "with payload", payload });
      expect(task.payload).toBe(payload);
    });

    it("creates task with dependencies", () => {
      const parent = store.createTask({ description: "parent task" });
      const child = store.createTask({ description: "child task", dependsOn: [parent.id] });

      const deps = store.getDependencies(child.id);
      expect(deps).toContain(parent.id);
    });

    it("throws when adding dependency would create a cycle", () => {
      const a = store.createTask({ description: "A" });
      const b = store.createTask({ description: "B", dependsOn: [a.id] });

      // Trying to make A depend on B would create A→B→A cycle
      expect(() => store.addDependency(a.id, b.id)).toThrow(/circular dependency/);
    });

    it("throws when task depends on itself", () => {
      const a = store.createTask({ description: "A" });
      expect(() => store.addDependency(a.id, a.id)).toThrow(/circular dependency/);
    });
  });

  // ── getTask / listTasks ───────────────────────────────────────────────────

  describe("getTask()", () => {
    it("returns undefined for nonexistent task", () => {
      expect(store.getTask("nonexistent-id")).toBeUndefined();
    });

    it("returns task by id", () => {
      const created = store.createTask({ description: "findme" });
      const found = store.getTask(created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.description).toBe("findme");
    });
  });

  describe("listTasks()", () => {
    it("returns all tasks when no filter", () => {
      store.createTask({ description: "task 1" });
      store.createTask({ description: "task 2" });
      const tasks = store.listTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by status", () => {
      const pending = store.createTask({ description: "pending task" });
      store.startTask(pending.id);
      const inProgress = store.createTask({ description: "another" });
      store.startTask(inProgress.id);
      store.createTask({ description: "still pending" });

      const inProgressTasks = store.listTasks({ status: "in_progress" });
      expect(inProgressTasks.every((t) => t.status === "in_progress")).toBe(true);
    });

    it("orders by priority DESC, created_at ASC", () => {
      store.createTask({ description: "low", priority: 1 });
      store.createTask({ description: "high", priority: 10 });
      store.createTask({ description: "medium", priority: 5 });

      const tasks = store.listTasks();
      // First task should be the highest priority
      expect(tasks[0].priority).toBeGreaterThanOrEqual(tasks[1]?.priority ?? 0);
    });
  });

  // ── Status transitions ────────────────────────────────────────────────────

  describe("startTask()", () => {
    it("transitions from pending to in_progress", () => {
      const task = store.createTask({ description: "start me" });
      const updated = store.startTask(task.id);
      expect(updated?.status).toBe("in_progress");
      expect(updated?.startedAt).toBeInstanceOf(Date);
    });

    it("sets started_at timestamp only once", () => {
      const task = store.createTask({ description: "start me" });
      const first = store.startTask(task.id);
      const firstStartedAt = first?.startedAt?.getTime();

      // Calling startTask again shouldn't change startedAt
      const second = store.startTask(task.id);
      expect(second?.startedAt?.getTime()).toBe(firstStartedAt);
    });
  });

  describe("completeTask()", () => {
    it("transitions to done with result", () => {
      const task = store.createTask({ description: "complete me" });
      store.startTask(task.id);
      const updated = store.completeTask(task.id, "task result");
      expect(updated?.status).toBe("done");
      expect(updated?.result).toBe("task result");
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("failTask()", () => {
    it("transitions to failed with error", () => {
      const task = store.createTask({ description: "fail me" });
      store.startTask(task.id);
      const updated = store.failTask(task.id, "something went wrong");
      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe("something went wrong");
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("cancelTask()", () => {
    it("transitions from pending to cancelled", () => {
      const task = store.createTask({ description: "cancel me" });
      const updated = store.cancelTask(task.id);
      expect(updated?.status).toBe("cancelled");
    });

    it("transitions from in_progress to cancelled", () => {
      const task = store.createTask({ description: "cancel in progress" });
      store.startTask(task.id);
      const updated = store.cancelTask(task.id);
      expect(updated?.status).toBe("cancelled");
    });

    it("cannot cancel an already-done task", () => {
      const task = store.createTask({ description: "done task" });
      store.startTask(task.id);
      store.completeTask(task.id, "result");

      // cancelTask should return the task unchanged (still done)
      const updated = store.cancelTask(task.id);
      expect(updated?.status).toBe("done");
    });

    it("cannot cancel an already-failed task", () => {
      const task = store.createTask({ description: "failed task" });
      store.failTask(task.id, "error");

      // cancelTask should return the task unchanged (still failed)
      const updated = store.cancelTask(task.id);
      expect(updated?.status).toBe("failed");
    });

    it("cannot cancel an already-cancelled task (idempotent)", () => {
      const task = store.createTask({ description: "cancel twice" });
      store.cancelTask(task.id);

      // Second cancel should return unchanged cancelled task
      const updated = store.cancelTask(task.id);
      expect(updated?.status).toBe("cancelled");
    });

    it("returns undefined for nonexistent task", () => {
      expect(store.cancelTask("nonexistent")).toBeUndefined();
    });
  });

  // ── updateTask with scheduledMessageId ───────────────────────────────────

  describe("updateTask() with scheduledMessageId", () => {
    it("persists scheduledMessageId", () => {
      const task = store.createTask({ description: "scheduled task" });
      expect(task.scheduledMessageId).toBeUndefined();

      const updated = store.updateTask(task.id, { scheduledMessageId: 42 });
      expect(updated?.scheduledMessageId).toBe(42);

      // Verify persistence in DB
      const fetched = store.getTask(task.id);
      expect(fetched?.scheduledMessageId).toBe(42);
    });
  });

  // ── canExecute ────────────────────────────────────────────────────────────

  describe("canExecute()", () => {
    it("returns true for task with no dependencies", () => {
      const task = store.createTask({ description: "no deps" });
      expect(store.canExecute(task.id)).toBe(true);
    });

    it("returns false when parent is still pending", () => {
      const parent = store.createTask({ description: "parent" });
      const child = store.createTask({ description: "child", dependsOn: [parent.id] });
      expect(store.canExecute(child.id)).toBe(false);
    });

    it("returns true when all parents are done", () => {
      const parent = store.createTask({ description: "parent" });
      const child = store.createTask({ description: "child", dependsOn: [parent.id] });

      store.completeTask(parent.id, "result");
      expect(store.canExecute(child.id)).toBe(true);
    });

    it("returns false when one parent is done but another is pending", () => {
      const p1 = store.createTask({ description: "parent 1" });
      const p2 = store.createTask({ description: "parent 2" });
      const child = store.createTask({ description: "child", dependsOn: [p1.id, p2.id] });

      store.completeTask(p1.id, "result1");
      expect(store.canExecute(child.id)).toBe(false);
    });

    it("returns true when all multiple parents are done", () => {
      const p1 = store.createTask({ description: "parent 1" });
      const p2 = store.createTask({ description: "parent 2" });
      const child = store.createTask({ description: "child", dependsOn: [p1.id, p2.id] });

      store.completeTask(p1.id, "result1");
      store.completeTask(p2.id, "result2");
      expect(store.canExecute(child.id)).toBe(true);
    });
  });

  // ── getParentResults ──────────────────────────────────────────────────────

  describe("getParentResults()", () => {
    it("returns empty array when no dependencies", () => {
      const task = store.createTask({ description: "no deps" });
      expect(store.getParentResults(task.id)).toEqual([]);
    });

    it("returns results from completed parents", () => {
      const parent = store.createTask({ description: "parent task" });
      store.completeTask(parent.id, JSON.stringify({ value: 42 }));

      const child = store.createTask({ description: "child", dependsOn: [parent.id] });
      const results = store.getParentResults(child.id);

      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe(parent.id);
      expect(results[0].description).toBe("parent task");
      expect(results[0].result).toEqual({ value: 42 });
    });

    it("parses JSON results automatically", () => {
      const parent = store.createTask({ description: "parent" });
      store.completeTask(parent.id, '{"key":"value","num":123}');

      const child = store.createTask({ description: "child", dependsOn: [parent.id] });
      const results = store.getParentResults(child.id);

      expect(results[0].result).toEqual({ key: "value", num: 123 });
    });

    it("returns raw string when result is not valid JSON", () => {
      const parent = store.createTask({ description: "parent" });
      store.completeTask(parent.id, "plain text result");

      const child = store.createTask({ description: "child", dependsOn: [parent.id] });
      const results = store.getParentResults(child.id);

      expect(results[0].result).toBe("plain text result");
    });

    it("only returns results from done parents (not pending/in_progress)", () => {
      const p1 = store.createTask({ description: "done parent" });
      const p2 = store.createTask({ description: "pending parent" });
      store.completeTask(p1.id, "result1");

      const child = store.createTask({ description: "child", dependsOn: [p1.id, p2.id] });
      const results = store.getParentResults(child.id);

      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe(p1.id);
    });
  });

  // ── getDependencies / getDependents ───────────────────────────────────────

  describe("getDependencies() / getDependents()", () => {
    it("returns empty arrays for tasks with no deps", () => {
      const task = store.createTask({ description: "lone task" });
      expect(store.getDependencies(task.id)).toEqual([]);
      expect(store.getDependents(task.id)).toEqual([]);
    });

    it("getDependencies returns parent IDs", () => {
      const parent = store.createTask({ description: "parent" });
      const child = store.createTask({ description: "child", dependsOn: [parent.id] });

      expect(store.getDependencies(child.id)).toContain(parent.id);
      expect(store.getDependencies(parent.id)).toEqual([]);
    });

    it("getDependents returns child IDs", () => {
      const parent = store.createTask({ description: "parent" });
      const child = store.createTask({ description: "child", dependsOn: [parent.id] });

      expect(store.getDependents(parent.id)).toContain(child.id);
      expect(store.getDependents(child.id)).toEqual([]);
    });
  });

  // ── deleteTask ───────────────────────────────────────────────────────────

  describe("deleteTask()", () => {
    it("returns false for nonexistent task", () => {
      expect(store.deleteTask("nonexistent")).toBe(false);
    });

    it("deletes existing task", () => {
      const task = store.createTask({ description: "to delete" });
      expect(store.deleteTask(task.id)).toBe(true);
      expect(store.getTask(task.id)).toBeUndefined();
    });

    it("cascade-deletes task dependencies on delete", () => {
      const parent = store.createTask({ description: "parent" });
      const child = store.createTask({ description: "child", dependsOn: [parent.id] });

      // Deleting parent should cascade-delete the dependency row
      store.deleteTask(parent.id);

      // Child still exists but has no deps now
      const deps = store.getDependencies(child.id);
      expect(deps).not.toContain(parent.id);
    });
  });

  // ── getActiveTasks ───────────────────────────────────────────────────────

  describe("getActiveTasks()", () => {
    it("returns only pending and in_progress tasks", () => {
      const pending = store.createTask({ description: "pending" });
      const inProg = store.createTask({ description: "in progress" });
      store.startTask(inProg.id);
      const done = store.createTask({ description: "done" });
      store.completeTask(done.id, "result");
      const cancelled = store.createTask({ description: "cancelled" });
      store.cancelTask(cancelled.id);

      const active = store.getActiveTasks();
      const activeIds = active.map((t) => t.id);

      expect(activeIds).toContain(pending.id);
      expect(activeIds).toContain(inProg.id);
      expect(activeIds).not.toContain(done.id);
      expect(activeIds).not.toContain(cancelled.id);
    });
  });

  // ── getTaskStore singleton ───────────────────────────────────────────────

  describe("getTaskStore()", () => {
    it("returns same instance for same DB", () => {
      const store1 = getTaskStore(db);
      const store2 = getTaskStore(db);
      expect(store1).toBe(store2);
    });

    it("returns different instance for different DB", () => {
      const db2 = createDb();
      try {
        const store1 = getTaskStore(db);
        const store2 = getTaskStore(db2);
        expect(store1).not.toBe(store2);
      } finally {
        db2.close();
      }
    });
  });
});
