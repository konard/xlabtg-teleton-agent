import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../../memory/schema.js";
import { getTaskStore } from "../../../../../memory/agent/tasks.js";
import { telegramCreateScheduledTaskExecutor } from "../create-scheduled-task.js";
import { telegramUpdateTaskExecutor } from "../update-task.js";
import { telegramGetTaskExecutor } from "../get-task.js";
import { telegramListTasksExecutor } from "../list-tasks.js";
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

const mockInvoke = vi.fn();
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
          invoke: mockInvoke,
          getMe: mockGetMe,
        }),
      }),
    },
    chatId: "123",
    senderId: 456,
    isGroup: false,
  } as unknown as ToolContext;
}

function futureDate(offsetSeconds = 3600): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

// ── TaskStore: recurrenceInterval persistence ─────────────────────────────────

describe("TaskStore: recurrenceInterval", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("persists recurrenceInterval when creating task", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "recurring task",
      recurrenceInterval: 2700,
    });

    expect(task.recurrenceInterval).toBe(2700);

    const fetched = store.getTask(task.id);
    expect(fetched?.recurrenceInterval).toBe(2700);
  });

  it("returns undefined recurrenceInterval for one-time tasks", () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "one-time task" });
    expect(task.recurrenceInterval).toBeUndefined();

    const fetched = store.getTask(task.id);
    expect(fetched?.recurrenceInterval).toBeUndefined();
  });

  it("includes recurrenceInterval in listTasks output", () => {
    const store = getTaskStore(db);
    store.createTask({ description: "recurring", recurrenceInterval: 3600 });
    store.createTask({ description: "one-time" });

    const tasks = store.listTasks();
    const recurring = tasks.find((t) => t.description === "recurring");
    const oneTime = tasks.find((t) => t.description === "one-time");

    expect(recurring?.recurrenceInterval).toBe(3600);
    expect(oneTime?.recurrenceInterval).toBeUndefined();
  });

  it("allows undefined recurrenceInterval (no recurrence)", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "task with no interval",
      recurrenceInterval: undefined,
    });
    expect(task.recurrenceInterval).toBeUndefined();
  });
});

// ── telegram_create_scheduled_task: recurrence ────────────────────────────────

describe("telegram_create_scheduled_task with recurrence", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
    // Mock successful Telegram scheduled message creation
    mockInvoke.mockResolvedValue({
      updates: [{ className: "UpdateMessageID", id: 42 }],
      className: "Updates",
    });
    mockGetMe.mockResolvedValue({ id: 1n });
  });

  afterEach(() => {
    db.close();
  });

  it("creates recurring task with recurrence string", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Trading simulation every 45 minutes",
        scheduleDate: futureDate(300),
        recurrence: "every 45 minutes",
        payload: JSON.stringify({
          type: "tool_call",
          tool: "ton_trading_simulate_trade",
          params: { amount: 10 },
        }),
      },
      ctx
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.recurrenceInterval).toBe(2700);
    expect(data.message).toContain("repeating");

    // Verify stored in DB
    const store = getTaskStore(db);
    const task = store.getTask(data.taskId);
    expect(task?.recurrenceInterval).toBe(2700);
  });

  it("returns undefined recurrenceInterval for non-recurring tasks", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "One-time task",
        scheduleDate: futureDate(300),
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBeUndefined();
  });

  it("rejects invalid recurrence format", async () => {
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Too frequent task",
        scheduleDate: futureDate(300),
        recurrence: "not-valid-format",
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid recurrence format");
  });

  it("accepts recurrence of exactly 60 (minimum via plain seconds)", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Minimum interval task",
        scheduleDate: futureDate(300),
        recurrence: "60",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBe(60);
  });

  it("creates recurring task with recurrenceUntil", async () => {
    const ctx = makeContext(db);
    const until = futureDate(7 * 86400);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Limited recurring task",
        scheduleDate: futureDate(300),
        recurrence: "hourly",
        recurrenceUntil: until,
      },
      ctx
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.recurrenceInterval).toBe(3600);
    expect(data.recurrenceUntil).toBeDefined();
  });
});

// ── telegram_update_task ──────────────────────────────────────────────────────

describe("telegram_update_task", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      updates: [{ className: "UpdateMessageID", id: 99 }],
      className: "Updates",
    });
    mockGetMe.mockResolvedValue({ id: 1n });
  });

  afterEach(() => {
    db.close();
  });

  it("updates task description", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "old description" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, description: "new description" },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    expect((result.data as any).description).toBe("new description");

    const updated = store.getTask(task.id);
    expect(updated?.description).toBe("new description");
  });

  it("updates task priority", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task", priority: 0 });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, priority: 8 },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.priority).toBe(8);
  });

  it("updates task payload", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const newPayload = JSON.stringify({
      type: "agent_task",
      instructions: "Do something new",
    });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, payload: newPayload },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.payload).toBe(newPayload);
  });

  it("clears payload when empty string provided", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "task",
      payload: JSON.stringify({ type: "tool_call", tool: "some_tool", params: {} }),
    });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, payload: "" },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.payload).toBeUndefined();
  });

  it("updates recurrenceInterval", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, recurrenceInterval: 1800 },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.recurrenceInterval).toBe(1800);
  });

  it("removes recurrenceInterval when set to null", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task", recurrenceInterval: 3600 });
    expect(task.recurrenceInterval).toBe(3600);

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, recurrenceInterval: null },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.recurrenceInterval).toBeUndefined();
  });

  it("rejects recurrenceInterval below 60", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, recurrenceInterval: 30 },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("recurrenceInterval must be an integer >= 60");
  });

  it("reschedules telegram message when rescheduleDate provided", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "scheduled task",
      scheduledMessageId: 55,
    });

    const result = await telegramUpdateTaskExecutor(
      {
        taskId: task.id,
        rescheduleDate: futureDate(7200),
      },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    // Old message should be deleted and new one created
    expect(mockInvoke).toHaveBeenCalledTimes(2); // delete + send
    expect((result.data as any).oldScheduledMessageDeleted).toBe(true);
  });

  it("returns error for nonexistent task", async () => {
    const result = await telegramUpdateTaskExecutor(
      { taskId: "nonexistent-uuid" },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task not found");
  });

  it("returns error when updating non-pending task", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "done task" });
    store.completeTask(task.id, "result");

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, description: "new desc" },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot update task with status "done"');
  });

  it("returns error when updating cancelled task", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });
    store.cancelTask(task.id);

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, description: "new desc" },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot update task with status "cancelled"');
  });

  it("returns error for invalid payload JSON", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, payload: "not-json" },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON payload");
  });

  it("returns error for invalid payload type", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, payload: JSON.stringify({ type: "unknown" }) },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Payload must have type");
  });

  it("returns error for past rescheduleDate", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      {
        taskId: task.id,
        rescheduleDate: new Date(Date.now() - 3600_000).toISOString(),
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("rescheduleDate must be in the future");
  });

  it("returns error when db is unavailable", async () => {
    const ctx = makeContext(db);
    (ctx as any).db = null;

    const result = await telegramUpdateTaskExecutor({ taskId: "some-id" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Database not available");
  });

  it("updates reason field", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task", reason: "old reason" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, reason: "new reason" },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.reason).toBe("new reason");
  });
});

// ── get-task: recurrenceInterval ─────────────────────────────────────────────

describe("telegram_get_task: recurrenceInterval", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("includes recurrenceInterval in task details", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "recurring check",
      recurrenceInterval: 86400,
    });

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBe(86400);
  });

  it("returns null recurrenceInterval for non-recurring tasks", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "one-time" });

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBeNull();
  });
});

// ── list-tasks: recurrenceInterval ───────────────────────────────────────────

describe("telegram_list_tasks: recurrenceInterval", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("includes recurrenceInterval in listed tasks", async () => {
    const store = getTaskStore(db);
    store.createTask({ description: "recurring", recurrenceInterval: 2700 });
    store.createTask({ description: "one-time" });

    const result = await telegramListTasksExecutor({}, makeContext(db));
    expect(result.success).toBe(true);

    const tasks = (result.data as any).tasks;
    const recurring = tasks.find((t: any) => t.description === "recurring");
    const oneTime = tasks.find((t: any) => t.description === "one-time");

    expect(recurring.recurrenceInterval).toBe(2700);
    expect(oneTime.recurrenceInterval).toBeNull();
  });
});
