import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../../memory/schema.js";
import { getTaskStore } from "../../../../../memory/agent/tasks.js";
import { telegramListTasksExecutor } from "../list-tasks.js";
import { telegramGetTaskExecutor } from "../get-task.js";
import { telegramCancelTaskExecutor } from "../cancel-task.js";
import type { ToolContext } from "../../../types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockDeleteScheduledMessages = vi.fn();
const mockGetMe = vi.fn().mockResolvedValue({ id: 1n });

// ── Helpers ───────────────────────────────────────────────────────────────────

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function makeContext(db: InstanceType<typeof Database>): ToolContext {
  return {
    db,
    bridge: {
      getClient: () => ({
        getClient: () => ({
          invoke: mockDeleteScheduledMessages,
          getMe: mockGetMe,
        }),
      }),
    },
    chatId: "123",
    senderId: 456,
    isGroup: false,
  } as unknown as ToolContext;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("telegram_list_tasks", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty list when no tasks exist", async () => {
    const result = await telegramListTasksExecutor({}, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).tasks).toHaveLength(0);
    expect((result.data as any).count).toBe(0);
    expect((result.data as any).filter).toBe("all");
  });

  it("returns all tasks without filter", async () => {
    const store = getTaskStore(db);
    store.createTask({ description: "task one" });
    store.createTask({ description: "task two" });

    const result = await telegramListTasksExecutor({}, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(2);
  });

  it("filters tasks by status", async () => {
    const store = getTaskStore(db);
    const t1 = store.createTask({ description: "pending task" });
    const t2 = store.createTask({ description: "done task" });
    store.completeTask(t2.id, "done");

    const result = await telegramListTasksExecutor({ status: "pending" }, makeContext(db));
    expect(result.success).toBe(true);
    const tasks = (result.data as any).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(t1.id);
    expect((result.data as any).filter).toBe("pending");
  });

  it("returns tasks with dependency info", async () => {
    const store = getTaskStore(db);
    const parent = store.createTask({ description: "parent" });
    store.createTask({ description: "child", dependsOn: [parent.id] });

    const result = await telegramListTasksExecutor({}, makeContext(db));
    expect(result.success).toBe(true);
    const parentTask = (result.data as any).tasks.find((t: any) => t.id === parent.id);
    expect(parentTask.dependents).toHaveLength(1);
  });

  it("returns error when db is unavailable", async () => {
    const ctx = makeContext(db);
    (ctx as any).db = null;
    const result = await telegramListTasksExecutor({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Database not available");
  });
});

describe("telegram_get_task", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("returns task by id with all fields", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "test task",
      reason: "testing purposes",
      payload: JSON.stringify({ type: "agent_task", instructions: "do stuff" }),
    });

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.id).toBe(task.id);
    expect(data.description).toBe("test task");
    expect(data.reason).toBe("testing purposes");
    expect(data.status).toBe("pending");
    expect(data.dependencies).toEqual([]);
    expect(data.dependents).toEqual([]);
    expect(data.parentResults).toEqual([]);
  });

  it("returns task result and error when present", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "will complete" });
    store.completeTask(task.id, "the result");

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).result).toBe("the result");
    expect((result.data as any).status).toBe("done");
  });

  it("returns error for nonexistent task", async () => {
    const result = await telegramGetTaskExecutor({ taskId: "nonexistent-uuid" }, makeContext(db));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Task not found");
  });

  it("returns parent results for dependent tasks", async () => {
    const store = getTaskStore(db);
    const parent = store.createTask({ description: "parent task" });
    store.completeTask(parent.id, JSON.stringify({ value: 42 }));
    const child = store.createTask({ description: "child task", dependsOn: [parent.id] });

    const result = await telegramGetTaskExecutor({ taskId: child.id }, makeContext(db));
    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.dependencies).toContain(parent.id);
    expect(data.parentResults).toHaveLength(1);
    expect(data.parentResults[0].result).toEqual({ value: 42 });
  });

  it("returns error when db is unavailable", async () => {
    const ctx = makeContext(db);
    (ctx as any).db = null;
    const result = await telegramGetTaskExecutor({ taskId: "some-id" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Database not available");
  });
});

describe("telegram_cancel_task", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("cancels a pending task", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "to cancel" });

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).status).toBe("cancelled");

    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("cancelled");
  });

  it("cancels an in-progress task", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "in progress" });
    store.startTask(task.id);

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).status).toBe("cancelled");
  });

  it("returns error for nonexistent task", async () => {
    const result = await telegramCancelTaskExecutor(
      { taskId: "nonexistent-uuid" },
      makeContext(db)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Task not found");
  });

  it("returns error when task is already done", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "done task" });
    store.completeTask(task.id, "result");

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot cancel task with status "done"');
  });

  it("returns error when task is already cancelled", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "already cancelled" });
    store.cancelTask(task.id);

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot cancel task with status "cancelled"');
  });

  it("returns error when task is already failed", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "failed task" });
    store.failTask(task.id, "something broke");

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot cancel task with status "failed"');
  });

  it("deletes associated Telegram scheduled message when present", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "has telegram msg", scheduledMessageId: 999 });
    mockDeleteScheduledMessages.mockResolvedValue({});

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).scheduledMessageDeleted).toBe(true);
    expect(mockDeleteScheduledMessages).toHaveBeenCalledOnce();
  });

  it("still cancels task if Telegram message deletion fails", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "has failing msg delete",
      scheduledMessageId: 999,
    });
    mockDeleteScheduledMessages.mockRejectedValue(new Error("Telegram error"));

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).scheduledMessageDeleted).toBe(false);

    // DB should still be cancelled
    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("cancelled");
  });

  it("sets scheduledMessageDeleted: false when no scheduled message", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "no telegram msg" });

    const result = await telegramCancelTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).scheduledMessageDeleted).toBe(false);
    expect(mockDeleteScheduledMessages).not.toHaveBeenCalled();
  });

  it("includes cancellation reason in response", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "reason test" });

    const result = await telegramCancelTaskExecutor(
      { taskId: task.id, reason: "user requested" },
      makeContext(db)
    );
    expect(result.success).toBe(true);
    expect((result.data as any).reason).toBe("user requested");
  });

  it("returns error when db is unavailable", async () => {
    const ctx = makeContext(db);
    (ctx as any).db = null;
    const result = await telegramCancelTaskExecutor({ taskId: "some-id" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Database not available");
  });
});
