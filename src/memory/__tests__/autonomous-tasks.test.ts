import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { AutonomousTaskStore, getAutonomousTaskStore } from "../agent/autonomous-tasks.js";
import { logger } from "../../utils/logger.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

/**
 * Insert an autonomous_tasks row directly, bypassing the store. Used to
 * simulate corrupt JSON payloads that could exist in real databases (manual
 * edits, backfills, write crashes).
 */
function insertRawTask(
  db: InstanceType<typeof Database>,
  row: {
    id: string;
    goal?: string;
    success_criteria?: string;
    failure_conditions?: string;
    constraints?: string;
    retry_policy?: string;
    context?: string;
    priority?: string;
    status?: string;
    created_at?: number;
  }
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO autonomous_tasks (
      id, goal, success_criteria, failure_conditions, constraints,
      strategy, retry_policy, context, priority, status, current_step, created_at
    ) VALUES (?, ?, ?, ?, ?, 'balanced', ?, ?, ?, ?, 0, ?)`
  ).run(
    row.id,
    row.goal ?? "test goal",
    row.success_criteria ?? "[]",
    row.failure_conditions ?? "[]",
    row.constraints ?? "{}",
    row.retry_policy ?? '{"maxRetries":3,"backoff":"exponential"}',
    row.context ?? "{}",
    row.priority ?? "medium",
    row.status ?? "pending",
    row.created_at ?? now
  );
}

function insertRawCheckpoint(
  db: InstanceType<typeof Database>,
  row: { id: string; taskId: string; step?: number; state?: string; tool_calls?: string }
): void {
  db.prepare(
    `INSERT INTO task_checkpoints (id, task_id, step, state, tool_calls, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.taskId,
    row.step ?? 0,
    row.state ?? "{}",
    row.tool_calls ?? "[]",
    Math.floor(Date.now() / 1000)
  );
}

function insertRawLog(
  db: InstanceType<typeof Database>,
  row: { taskId: string; step?: number; eventType?: string; message?: string; data: string | null }
): void {
  db.prepare(
    `INSERT INTO execution_logs (task_id, step, event_type, message, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.taskId,
    row.step ?? 0,
    row.eventType ?? "info",
    row.message ?? "test",
    row.data,
    Math.floor(Date.now() / 1000)
  );
}

// ── AutonomousTaskStore Tests ────────────────────────────────────────────────

describe("AutonomousTaskStore — corrupt JSON resilience (AUDIT-H1)", () => {
  let db: InstanceType<typeof Database>;
  let store: AutonomousTaskStore;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createDb();
    store = getAutonomousTaskStore(db);
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    db.close();
  });

  // ── listTasks ─────────────────────────────────────────────────────────────

  describe("listTasks()", () => {
    it("does not throw when a row has corrupt JSON and returns all other rows", () => {
      const good1 = store.createTask({ goal: "good task 1" });
      insertRawTask(db, { id: "corrupt-row", context: "{not valid json" });
      const good2 = store.createTask({ goal: "good task 2" });

      let tasks: ReturnType<typeof store.listTasks>;
      expect(() => {
        tasks = store.listTasks();
      }).not.toThrow();

      const ids = tasks!.map((t) => t.id).sort();
      expect(ids).toContain(good1.id);
      expect(ids).toContain(good2.id);
      expect(ids).toContain("corrupt-row");
      expect(tasks!).toHaveLength(3);
    });

    it("logs a warning containing taskId when JSON parsing fails", () => {
      insertRawTask(db, { id: "corrupt-row", context: "{not valid json" });

      store.listTasks();

      expect(warnSpy).toHaveBeenCalled();
      const calledWithTaskId = warnSpy.mock.calls.some((call) => {
        const ctx = call[0] as Record<string, unknown> | undefined;
        return ctx && ctx.taskId === "corrupt-row";
      });
      expect(calledWithTaskId).toBe(true);
    });
  });

  // ── rowToTask ─────────────────────────────────────────────────────────────

  describe("rowToTask via getTask()", () => {
    it("returns fallback {} for corrupt context column", () => {
      insertRawTask(db, { id: "t1", context: "{broken" });

      const task = store.getTask("t1");

      expect(task).toBeDefined();
      expect(task!.context).toEqual({});
    });

    it("returns fallback [] for corrupt success_criteria", () => {
      insertRawTask(db, { id: "t2", success_criteria: "not[json" });

      const task = store.getTask("t2");

      expect(task).toBeDefined();
      expect(task!.successCriteria).toEqual([]);
    });

    it("returns fallback [] for corrupt failure_conditions", () => {
      insertRawTask(db, { id: "t3", failure_conditions: "garbage" });

      const task = store.getTask("t3");

      expect(task!.failureConditions).toEqual([]);
    });

    it("returns fallback {} for corrupt constraints", () => {
      insertRawTask(db, { id: "t4", constraints: "oops" });

      const task = store.getTask("t4");

      expect(task!.constraints).toEqual({});
    });

    it("returns sensible default retry policy when retry_policy is corrupt", () => {
      insertRawTask(db, { id: "t5", retry_policy: "}}}" });

      const task = store.getTask("t5");

      expect(task!.retryPolicy.maxRetries).toBeGreaterThanOrEqual(0);
      expect(["linear", "exponential"]).toContain(task!.retryPolicy.backoff);
    });

    it("parses valid JSON columns normally", () => {
      const task = store.createTask({
        goal: "valid task",
        successCriteria: ["criterion-a"],
        context: { key: "value" },
      });

      const fetched = store.getTask(task.id);
      expect(fetched!.successCriteria).toEqual(["criterion-a"]);
      expect(fetched!.context).toEqual({ key: "value" });
    });
  });

  // ── rowToCheckpoint ───────────────────────────────────────────────────────

  describe("rowToCheckpoint via getCheckpoint()", () => {
    it("returns fallback {} for corrupt state column", () => {
      const task = store.createTask({ goal: "t" });
      insertRawCheckpoint(db, { id: "cp1", taskId: task.id, state: "{corrupt" });

      const cp = store.getCheckpoint("cp1");

      expect(cp).toBeDefined();
      expect(cp!.state).toEqual({});
    });

    it("returns fallback [] for corrupt tool_calls column", () => {
      const task = store.createTask({ goal: "t" });
      insertRawCheckpoint(db, { id: "cp2", taskId: task.id, tool_calls: "not-json" });

      const cp = store.getCheckpoint("cp2");

      expect(cp).toBeDefined();
      expect(cp!.toolCalls).toEqual([]);
    });

    it("logs a warning containing checkpointId when state fails to parse", () => {
      const task = store.createTask({ goal: "t" });
      insertRawCheckpoint(db, { id: "cp3", taskId: task.id, state: "{corrupt" });

      store.getCheckpoint("cp3");

      const calledWithCheckpointId = warnSpy.mock.calls.some((call) => {
        const ctx = call[0] as Record<string, unknown> | undefined;
        return ctx && ctx.checkpointId === "cp3";
      });
      expect(calledWithCheckpointId).toBe(true);
    });
  });

  // ── rowToLogEntry ─────────────────────────────────────────────────────────

  describe("rowToLogEntry via getExecutionLogs()", () => {
    it("does not throw and returns undefined data for a corrupt log row", () => {
      const task = store.createTask({ goal: "t" });
      insertRawLog(db, { taskId: task.id, data: "{not-valid" });
      store.appendLog({ taskId: task.id, step: 1, eventType: "info", message: "ok" });

      let logs: ReturnType<typeof store.getExecutionLogs>;
      expect(() => {
        logs = store.getExecutionLogs(task.id);
      }).not.toThrow();

      expect(logs!).toHaveLength(2);
      const corrupt = logs!.find((l) => l.message === "test");
      expect(corrupt).toBeDefined();
      expect(corrupt!.data).toBeUndefined();
    });

    it("leaves data undefined for NULL-data rows without logging a warning", () => {
      const task = store.createTask({ goal: "t" });
      insertRawLog(db, { taskId: task.id, data: null });

      const logs = store.getExecutionLogs(task.id);

      expect(logs).toHaveLength(1);
      expect(logs[0].data).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
