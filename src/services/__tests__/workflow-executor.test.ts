import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { WorkflowStore } from "../workflows.js";
import { WorkflowExecutor } from "../workflow-executor.js";
import type { Workflow } from "../workflows.js";

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

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "test-id",
    name: "Test",
    description: null,
    enabled: true,
    config: {
      trigger: { type: "cron", cron: "0 9 * * 1" },
      actions: [],
    },
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    runCount: 0,
    lastError: null,
    ...overrides,
  };
}

describe("WorkflowExecutor", () => {
  let db: Database.Database;
  let store: WorkflowStore;

  beforeEach(() => {
    db = createTestDb();
    store = new WorkflowStore(db);
  });

  it("calls recordRun with no error on success", async () => {
    const wf = store.create({
      name: "Test",
      config: { trigger: { type: "cron", cron: "0 9 * * 1" }, actions: [] },
    });
    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toBeNull();
  });

  it("executes set_variable action and interpolates variables", async () => {
    const wf = store.create({
      name: "Var test",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [{ type: "set_variable", name: "greeting", value: "hello" }],
      },
    });
    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toBeNull();
  });

  it("records error when send_message bridge is unavailable", async () => {
    const wf = store.create({
      name: "Msg test",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [{ type: "send_message", chatId: "123", text: "hi" }],
      },
    });
    const executor = new WorkflowExecutor({ store }); // no bridge
    await executor.execute(wf);
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("send_message");
  });

  it("sends message via bridge when available", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const bridge = { isAvailable: () => true, sendMessage } as unknown as Parameters<
      typeof WorkflowExecutor
    >[0]["bridge"];
    const wf = store.create({
      name: "Send test",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [{ type: "send_message", chatId: "456", text: "hello" }],
      },
    });
    const executor = new WorkflowExecutor({ store, bridge });
    await executor.execute(wf);
    expect(sendMessage).toHaveBeenCalledWith({ chatId: "456", text: "hello" });
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toBeNull();
  });

  it("interpolates variables in send_message", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const bridge = { isAvailable: () => true, sendMessage } as unknown as Parameters<
      typeof WorkflowExecutor
    >[0]["bridge"];
    const wf = store.create({
      name: "Interp test",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [
          { type: "set_variable", name: "name", value: "World" },
          { type: "send_message", chatId: "123", text: "Hello {{name}}" },
        ],
      },
    });
    const executor = new WorkflowExecutor({ store, bridge });
    await executor.execute(wf);
    expect(sendMessage).toHaveBeenCalledWith({ chatId: "123", text: "Hello World" });
  });
});
