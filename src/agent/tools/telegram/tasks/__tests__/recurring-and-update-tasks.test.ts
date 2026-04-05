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

// ── TaskStore: repeatIntervalSeconds persistence ───────────────────────────────

describe("TaskStore: repeatIntervalSeconds", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("persists repeatIntervalSeconds when creating task", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "recurring task",
      repeatIntervalSeconds: 2700,
    });

    expect(task.repeatIntervalSeconds).toBe(2700);

    const fetched = store.getTask(task.id);
    expect(fetched?.repeatIntervalSeconds).toBe(2700);
  });

  it("returns undefined repeatIntervalSeconds for one-time tasks", () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "one-time task" });
    expect(task.repeatIntervalSeconds).toBeUndefined();

    const fetched = store.getTask(task.id);
    expect(fetched?.repeatIntervalSeconds).toBeUndefined();
  });

  it("includes repeatIntervalSeconds in listTasks output", () => {
    const store = getTaskStore(db);
    store.createTask({ description: "recurring", repeatIntervalSeconds: 3600 });
    store.createTask({ description: "one-time" });

    const tasks = store.listTasks();
    const recurring = tasks.find((t) => t.description === "recurring");
    const oneTime = tasks.find((t) => t.description === "one-time");

    expect(recurring?.repeatIntervalSeconds).toBe(3600);
    expect(oneTime?.repeatIntervalSeconds).toBeUndefined();
  });

  it("allows null repeatIntervalSeconds (no recurrence)", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "task with no interval",
      repeatIntervalSeconds: undefined,
    });
    expect(task.repeatIntervalSeconds).toBeUndefined();
  });
});

// ── telegram_create_scheduled_task: repeatIntervalSeconds ─────────────────────

describe("telegram_create_scheduled_task with repeatIntervalSeconds", () => {
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

  it("creates recurring task with repeatIntervalSeconds", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Trading simulation every 45 minutes",
        scheduleDate: futureDate(300),
        repeatIntervalSeconds: 2700,
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
    expect(data.repeatIntervalSeconds).toBe(2700);
    expect(data.message).toContain("Recurring task");
    expect(data.message).toContain("2700s");

    // Verify stored in DB
    const store = getTaskStore(db);
    const task = store.getTask(data.taskId);
    expect(task?.repeatIntervalSeconds).toBe(2700);
  });

  it("returns null repeatIntervalSeconds for non-recurring tasks", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "One-time task",
        scheduleDate: futureDate(300),
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect((result.data as any).repeatIntervalSeconds).toBeNull();
  });

  it("rejects repeatIntervalSeconds below 60", async () => {
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Too frequent task",
        scheduleDate: futureDate(300),
        repeatIntervalSeconds: 30,
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("repeatIntervalSeconds must be an integer >= 60");
  });

  it("rejects repeatIntervalSeconds without scheduleDate", async () => {
    const store = getTaskStore(db);
    const parent = store.createTask({ description: "parent" });

    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Recurring dependent task",
        dependsOn: [parent.id],
        repeatIntervalSeconds: 3600,
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("repeatIntervalSeconds requires scheduleDate");
  });

  it("accepts repeatIntervalSeconds of exactly 60 (minimum)", async () => {
    const ctx = makeContext(db);
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Minimum interval task",
        scheduleDate: futureDate(300),
        repeatIntervalSeconds: 60,
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect((result.data as any).repeatIntervalSeconds).toBe(60);
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

  it("updates repeatIntervalSeconds", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, repeatIntervalSeconds: 1800 },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.repeatIntervalSeconds).toBe(1800);
  });

  it("removes repeatIntervalSeconds when set to null", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task", repeatIntervalSeconds: 3600 });
    expect(task.repeatIntervalSeconds).toBe(3600);

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, repeatIntervalSeconds: null },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.repeatIntervalSeconds).toBeUndefined();
  });

  it("rejects repeatIntervalSeconds below 60", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "task" });

    const result = await telegramUpdateTaskExecutor(
      { taskId: task.id, repeatIntervalSeconds: 30 },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("repeatIntervalSeconds must be an integer >= 60");
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

// ── get-task: repeatIntervalSeconds ──────────────────────────────────────────

describe("telegram_get_task: repeatIntervalSeconds", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("includes repeatIntervalSeconds in task details", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "recurring check",
      repeatIntervalSeconds: 86400,
    });

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).repeatIntervalSeconds).toBe(86400);
  });

  it("returns null repeatIntervalSeconds for non-recurring tasks", async () => {
    const store = getTaskStore(db);
    const task = store.createTask({ description: "one-time" });

    const result = await telegramGetTaskExecutor({ taskId: task.id }, makeContext(db));
    expect(result.success).toBe(true);
    expect((result.data as any).repeatIntervalSeconds).toBeNull();
  });
});

// ── list-tasks: repeatIntervalSeconds ────────────────────────────────────────

describe("telegram_list_tasks: repeatIntervalSeconds", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("includes repeatIntervalSeconds in listed tasks", async () => {
    const store = getTaskStore(db);
    store.createTask({ description: "recurring", repeatIntervalSeconds: 2700 });
    store.createTask({ description: "one-time" });

    const result = await telegramListTasksExecutor({}, makeContext(db));
    expect(result.success).toBe(true);

    const tasks = (result.data as any).tasks;
    const recurring = tasks.find((t: any) => t.description === "recurring");
    const oneTime = tasks.find((t: any) => t.description === "one-time");

    expect(recurring.repeatIntervalSeconds).toBe(2700);
    expect(oneTime.repeatIntervalSeconds).toBeNull();
  });
});
