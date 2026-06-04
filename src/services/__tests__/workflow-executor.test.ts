import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { WorkflowStore } from "../workflows.js";
import { WorkflowExecutor } from "../workflow-executor.js";
import type { Workflow } from "../workflows.js";
import { DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS } from "../../constants/timeouts.js";

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => dnsMocks);

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
    dnsMocks.lookup.mockReset();
    dnsMocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("executes call_api action and records success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const wf = store.create({
      name: "API success",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [
          { type: "set_variable", name: "name", value: "World" },
          {
            type: "call_api",
            method: "POST",
            url: "https://example.com/hook",
            headers: { "content-type": "application/json" },
            body: '{"name":"{{name}}"}',
          },
        ],
      },
    });

    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"name":"World"}',
        signal: expect.any(AbortSignal),
      })
    );
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toBeNull();
  });

  it("blocks call_api action to metadata IP before fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const wf = store.create({
      name: "API SSRF",
      config: {
        trigger: { type: "webhook", secret: "secret" },
        actions: [
          {
            type: "call_api",
            method: "GET",
            url: "http://169.254.169.254/latest/meta-data/",
          },
        ],
      },
    });

    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);

    expect(fetchMock).not.toHaveBeenCalled();
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("call_api");
    expect(updated.lastError).toMatch(/private|loopback|metadata|not allowed/i);
  });

  it("blocks call_api action when hostname resolves to metadata IP", async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const wf = store.create({
      name: "API DNS SSRF",
      config: {
        trigger: { type: "webhook", secret: "secret" },
        actions: [
          {
            type: "call_api",
            method: "GET",
            url: "https://rebind.example.com/latest/meta-data/",
          },
        ],
      },
    });

    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);

    expect(fetchMock).not.toHaveBeenCalled();
    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("call_api");
    expect(updated.lastError).toMatch(/private|loopback|metadata|not allowed/i);
  });

  it("records an error when a call_api action returns an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const wf = store.create({
      name: "API failure",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [{ type: "call_api", method: "GET", url: "https://example.com/down" }],
      },
    });

    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("call_api");
    expect(updated.lastError).toContain("HTTP 503 from https://example.com/down");
  });

  it("records an error when a call_api action exceeds its timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );

    const wf = store.create({
      name: "Slow API",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [
          {
            type: "call_api",
            method: "GET",
            url: "https://example.com/slow",
            timeoutMs: 50,
          },
        ],
      },
    });

    const executor = new WorkflowExecutor({ store });
    await executor.execute(wf);

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("call_api");
    expect(updated.lastError).toContain("timed out after 50ms");
  }, 1_000);

  it("records an error when a call_api action exceeds the default timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );

    const wf = store.create({
      name: "Slow API with default timeout",
      config: {
        trigger: { type: "cron", cron: "0 9 * * 1" },
        actions: [{ type: "call_api", method: "GET", url: "https://example.com/slow" }],
      },
    });

    const executor = new WorkflowExecutor({ store });
    const run = executor.execute(wf);

    await vi.advanceTimersByTimeAsync(DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS);
    await run;

    const updated = store.get(wf.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastError).toContain("call_api");
    expect(updated.lastError).toContain(`timed out after ${DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS}ms`);
  });
});
