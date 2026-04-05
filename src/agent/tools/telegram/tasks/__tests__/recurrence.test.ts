import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../../memory/schema.js";
import { getTaskStore } from "../../../../../memory/agent/tasks.js";
import { parseRecurrenceInterval } from "../create-scheduled-task.js";
import { telegramCreateScheduledTaskExecutor } from "../create-scheduled-task.js";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

const mockInvoke = vi.fn().mockResolvedValue({ updates: [] });
const mockGetMe = vi.fn().mockResolvedValue({ id: 1n });

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

// ── parseRecurrenceInterval Tests ─────────────────────────────────────────────

describe("parseRecurrenceInterval()", () => {
  it("parses plain integer seconds", () => {
    expect(parseRecurrenceInterval("2700")).toBe(2700);
    expect(parseRecurrenceInterval("60")).toBe(60);
    expect(parseRecurrenceInterval("86400")).toBe(86400);
  });

  it("returns null for zero or negative plain integer", () => {
    expect(parseRecurrenceInterval("0")).toBeNull();
  });

  it("parses 'minutely' shorthand", () => {
    expect(parseRecurrenceInterval("minutely")).toBe(60);
  });

  it("parses 'hourly' shorthand", () => {
    expect(parseRecurrenceInterval("hourly")).toBe(3600);
  });

  it("parses 'daily' shorthand", () => {
    expect(parseRecurrenceInterval("daily")).toBe(86400);
  });

  it("parses 'weekly' shorthand", () => {
    expect(parseRecurrenceInterval("weekly")).toBe(604800);
  });

  it("parses 'every N minutes'", () => {
    expect(parseRecurrenceInterval("every 45 minutes")).toBe(2700);
    expect(parseRecurrenceInterval("every 1 minute")).toBe(60);
    expect(parseRecurrenceInterval("every 10 minutes")).toBe(600);
  });

  it("parses 'every N hours'", () => {
    expect(parseRecurrenceInterval("every 6 hours")).toBe(21600);
    expect(parseRecurrenceInterval("every 1 hour")).toBe(3600);
  });

  it("parses 'every N days'", () => {
    expect(parseRecurrenceInterval("every 2 days")).toBe(172800);
    expect(parseRecurrenceInterval("every 1 day")).toBe(86400);
  });

  it("parses 'every N weeks'", () => {
    expect(parseRecurrenceInterval("every 2 weeks")).toBe(1209600);
    expect(parseRecurrenceInterval("every 1 week")).toBe(604800);
  });

  it("parses 'every N seconds'", () => {
    expect(parseRecurrenceInterval("every 30 seconds")).toBe(30);
    expect(parseRecurrenceInterval("every 1 second")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(parseRecurrenceInterval("HOURLY")).toBe(3600);
    expect(parseRecurrenceInterval("Every 5 Minutes")).toBe(300);
  });

  it("trims whitespace", () => {
    expect(parseRecurrenceInterval("  hourly  ")).toBe(3600);
  });

  it("returns null for invalid format", () => {
    expect(parseRecurrenceInterval("every day")).toBeNull();
    expect(parseRecurrenceInterval("each hour")).toBeNull();
    expect(parseRecurrenceInterval("abc")).toBeNull();
    expect(parseRecurrenceInterval("")).toBeNull();
  });
});

// ── TaskStore recurrence persistence ─────────────────────────────────────────

describe("TaskStore recurrence fields", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("persists recurrenceInterval when creating a task", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "Recurring trade check",
      scheduledFor: new Date(Date.now() + 60000),
      recurrenceInterval: 2700,
    });

    const loaded = store.getTask(task.id);
    expect(loaded?.recurrenceInterval).toBe(2700);
    expect(loaded?.recurrenceUntil).toBeUndefined();
  });

  it("persists recurrenceUntil when creating a task", () => {
    const store = getTaskStore(db);
    const until = new Date(Date.now() + 7 * 86400 * 1000);
    const task = store.createTask({
      description: "Recurring trade check",
      scheduledFor: new Date(Date.now() + 60000),
      recurrenceInterval: 3600,
      recurrenceUntil: until,
    });

    const loaded = store.getTask(task.id);
    expect(loaded?.recurrenceInterval).toBe(3600);
    // Allow 2s tolerance for timestamp rounding (stored as Unix seconds, so precision is 1s)
    expect(Math.abs((loaded?.recurrenceUntil?.getTime() ?? 0) - until.getTime())).toBeLessThan(
      2000
    );
  });

  it("returns undefined recurrenceInterval when not set", () => {
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "One-time task",
      scheduledFor: new Date(Date.now() + 60000),
    });

    const loaded = store.getTask(task.id);
    expect(loaded?.recurrenceInterval).toBeUndefined();
    expect(loaded?.recurrenceUntil).toBeUndefined();
  });

  it("listTasks includes recurrenceInterval in returned tasks", () => {
    const store = getTaskStore(db);
    store.createTask({
      description: "Recurring task",
      scheduledFor: new Date(Date.now() + 60000),
      recurrenceInterval: 86400,
    });

    const tasks = store.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrenceInterval).toBe(86400);
  });
});

// ── telegramCreateScheduledTaskExecutor recurrence validation ─────────────────

describe("telegram_create_scheduled_task with recurrence", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("rejects invalid recurrence format", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Trade simulation",
        scheduleDate: futureDate,
        recurrence: "each hour",
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid recurrence format");
  });

  it("rejects invalid recurrenceUntil format", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Trade simulation",
        scheduleDate: futureDate,
        recurrence: "hourly",
        recurrenceUntil: "not-a-date",
      },
      makeContext(db)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid recurrenceUntil format");
  });

  it("creates recurring task with valid recurrence", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Trade simulation every 45 minutes",
        scheduleDate: futureDate,
        recurrence: "every 45 minutes",
      },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBe(2700);
    expect((result.data as any).recurrenceUntil).toBeUndefined();
    expect((result.data as any).message).toContain("every 45 minutes");

    // Verify stored in DB
    const store = getTaskStore(db);
    const tasks = store.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrenceInterval).toBe(2700);
  });

  it("creates recurring task with recurrenceUntil", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "Daily trade check",
        scheduleDate: futureDate,
        recurrence: "daily",
        recurrenceUntil: until,
      },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBe(86400);
    expect((result.data as any).recurrenceUntil).toBe(until);

    const store = getTaskStore(db);
    const tasks = store.listTasks();
    expect(tasks[0].recurrenceInterval).toBe(86400);
    expect(tasks[0].recurrenceUntil).toBeDefined();
  });

  it("creates non-recurring task when no recurrence specified", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "One-time trade",
        scheduleDate: futureDate,
      },
      makeContext(db)
    );

    expect(result.success).toBe(true);
    expect((result.data as any).recurrenceInterval).toBeUndefined();

    const store = getTaskStore(db);
    const tasks = store.listTasks();
    expect(tasks[0].recurrenceInterval).toBeUndefined();
  });
});
