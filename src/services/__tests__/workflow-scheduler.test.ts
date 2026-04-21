import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { WorkflowStore } from "../workflows.js";
import { WorkflowScheduler } from "../workflow-scheduler.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
  `);
  return db;
}

describe("WorkflowScheduler", () => {
  let db: Database.Database;
  let store: WorkflowStore;

  beforeEach(() => {
    db = createTestDb();
    store = new WorkflowStore(db);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fireEvent triggers matching event workflows", async () => {
    const wf = store.create({
      name: "On start",
      config: {
        trigger: { type: "event", event: "agent.start" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    await scheduler.fireEvent("agent.start");

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
  });

  it("fireEvent does not trigger disabled workflows", async () => {
    const wf = store.create({
      name: "Disabled",
      enabled: false,
      config: {
        trigger: { type: "event", event: "agent.start" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    await scheduler.fireEvent("agent.start");

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(0);
  });

  it("fireEvent does not trigger workflows with different event", async () => {
    const wf = store.create({
      name: "Stop only",
      config: {
        trigger: { type: "event", event: "agent.stop" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    await scheduler.fireEvent("agent.start");

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(0);
  });

  it("handleWebhook triggers matching webhook workflows", async () => {
    const wf = store.create({
      name: "Webhook",
      config: {
        trigger: { type: "webhook", secret: "my-secret-token" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    const triggered = await scheduler.handleWebhook("my-secret-token");

    expect(triggered).toBe(true);
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
  });

  it("handleWebhook returns false for unknown secret", async () => {
    const scheduler = new WorkflowScheduler(db);
    const triggered = await scheduler.handleWebhook("nonexistent");
    expect(triggered).toBe(false);
  });

  it("handleWebhook does not trigger disabled webhook workflows", async () => {
    const wf = store.create({
      name: "Disabled webhook",
      enabled: false,
      config: {
        trigger: { type: "webhook", secret: "secret123" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    const triggered = await scheduler.handleWebhook("secret123");

    expect(triggered).toBe(false);
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(0);
  });

  it("start and stop do not throw", () => {
    const scheduler = new WorkflowScheduler(db);
    scheduler.start();
    scheduler.stop();
  });

  it("start is idempotent", () => {
    const scheduler = new WorkflowScheduler(db);
    scheduler.start();
    scheduler.start(); // should not throw or create duplicate timers
    scheduler.stop();
  });
});

describe("Cron matching (via tick)", () => {
  let db: Database.Database;
  let store: WorkflowStore;

  beforeEach(() => {
    db = createTestDb();
    store = new WorkflowStore(db);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires cron workflow when time matches", async () => {
    // Start 1 second before 09:00 UTC on a Monday so the interval fires AT 09:00
    vi.setSystemTime(new Date("2024-01-01T08:59:00.000Z")); // Monday, 1 min before target

    const wf = store.create({
      name: "Monday 9am",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" }, // Monday at 9am UTC
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    scheduler.start();

    // Advance to exactly 09:00 UTC (60 seconds forward)
    await vi.advanceTimersByTimeAsync(60_000);

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);

    scheduler.stop();
  });

  it("does not fire cron workflow when time does not match", async () => {
    // Set time to 2024-01-01 10:00 UTC (9am cron won't match)
    vi.setSystemTime(new Date("2024-01-01T10:00:00.000Z"));

    const wf = store.create({
      name: "Monday 9am",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [],
      },
    });

    const scheduler = new WorkflowScheduler(db);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(0);

    scheduler.stop();
  });
});
