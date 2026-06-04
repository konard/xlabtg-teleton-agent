import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createWorkflowsRoutes } from "../routes/workflows.js";
import type { WebUIServerDeps } from "../types.js";
import { MAX_WORKFLOW_HTTP_TIMEOUT_MS } from "../../constants/timeouts.js";

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => dnsMocks);

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
      last_error TEXT,
      last_fired_bucket INTEGER
    );
  `);
  return db;
}

function makeDeps(): WebUIServerDeps {
  return {
    memory: {
      db: createTestDb(),
    },
  } as unknown as WebUIServerDeps;
}

describe("workflows routes", () => {
  beforeEach(() => {
    dnsMocks.lookup.mockReset();
    dnsMocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("accepts a valid call_api timeoutMs override", async () => {
    const app = createWorkflowsRoutes(makeDeps());

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "API workflow",
        config: {
          trigger: { type: "cron", cron: "0 9 * * 1" },
          actions: [
            {
              type: "call_api",
              method: "GET",
              url: "https://example.com/hook",
              timeoutMs: 2_500,
            },
          ],
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.config.actions[0].timeoutMs).toBe(2_500);
  });

  it("rejects invalid call_api timeoutMs overrides", async () => {
    const app = createWorkflowsRoutes(makeDeps());

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid API workflow",
        config: {
          trigger: { type: "cron", cron: "0 9 * * 1" },
          actions: [
            {
              type: "call_api",
              method: "GET",
              url: "https://example.com/hook",
              timeoutMs: MAX_WORKFLOW_HTTP_TIMEOUT_MS + 1,
            },
          ],
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("call_api timeoutMs");
  });

  it("rejects call_api actions targeting metadata IPs", async () => {
    const app = createWorkflowsRoutes(makeDeps());

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid API workflow",
        config: {
          trigger: { type: "webhook" },
          actions: [
            {
              type: "call_api",
              method: "GET",
              url: "http://169.254.169.254/latest/meta-data/",
            },
          ],
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/private|loopback|metadata|not allowed/i);
  });

  it("rejects call_api actions when hostnames resolve to metadata IPs", async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const app = createWorkflowsRoutes(makeDeps());

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid API workflow",
        config: {
          trigger: { type: "webhook" },
          actions: [
            {
              type: "call_api",
              method: "GET",
              url: "https://rebind.example.com/latest/meta-data/",
            },
          ],
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/private|loopback|metadata|not allowed/i);
  });
});
