import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createAnalyticsRoutes } from "../routes/analytics.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS request_metrics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name   TEXT,
      success     INTEGER NOT NULL DEFAULT 1,
      duration_ms REAL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS cost_records (
      date          TEXT PRIMARY KEY,
      tokens_input  INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL    NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS budget_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS metric_tokens (
      bucket    INTEGER NOT NULL PRIMARY KEY,
      tokens    INTEGER NOT NULL DEFAULT 0,
      cost      REAL    NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS metric_tool_calls (
      bucket    INTEGER NOT NULL,
      tool      TEXT    NOT NULL,
      count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, tool)
    );
  `);

  return db;
}

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/analytics", createAnalyticsRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /analytics/usage", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty data when no metrics exist", async () => {
    const res = await app.request("/analytics/usage");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("returns token usage data for default 24h period", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bucket = now - (now % 3600);
    db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
      bucket,
      1000,
      0.05
    );

    const res = await app.request("/analytics/usage");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].tokens).toBe(1000);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/analytics/usage?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/analytics/usage?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("excludes data outside the requested period", async () => {
    // Insert a bucket 48 hours ago (outside 24h default)
    const oldBucket = Math.floor(Date.now() / 1000) - 48 * 3600;
    db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
      oldBucket,
      500,
      0.02
    );

    const res = await app.request("/analytics/usage");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});

describe("GET /analytics/tools", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty array when no tool data exists", async () => {
    const res = await app.request("/analytics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });

  it("returns tool usage counts within period", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bucket = now - (now % 3600);
    db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
      bucket,
      "search",
      5
    );
    db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
      bucket,
      "read_file",
      3
    );

    const res = await app.request("/analytics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
    // Should be sorted by count DESC
    expect(json.data[0].tool).toBe("search");
    expect(json.data[0].count).toBe(5);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/analytics/tools?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

describe("GET /analytics/heatmap", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty array when no data exists", async () => {
    const res = await app.request("/analytics/heatmap");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/analytics/heatmap?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns activity data with dayOfWeek and hour fields", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bucket = now - (now % 3600);
    db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
      bucket,
      2000,
      0.1
    );

    const res = await app.request("/analytics/heatmap");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    if (json.data.length > 0) {
      const entry = json.data[0];
      expect(typeof entry.dayOfWeek).toBe("number");
      expect(typeof entry.hour).toBe("number");
      expect(typeof entry.count).toBe("number");
    }
  });
});

describe("GET /analytics/performance", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with summary and errorFrequency fields", async () => {
    const res = await app.request("/analytics/performance");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("summary");
    expect(json.data).toHaveProperty("errorFrequency");
  });

  it("returns zero totalRequests when no request_metrics exist", async () => {
    const res = await app.request("/analytics/performance");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary.totalRequests).toBe(0);
    // error_count is SUM which returns null in SQLite when no rows match
    expect(json.data.summary.errorCount == null || json.data.summary.errorCount === 0).toBe(true);
    expect(json.data.summary.successRate).toBeNull();
  });

  it("returns correct summary when data exists", async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO request_metrics (tool_name, success, duration_ms, created_at) VALUES (?, ?, ?, ?)"
    ).run("search", 1, 200, now);
    db.prepare(
      "INSERT INTO request_metrics (tool_name, success, duration_ms, created_at) VALUES (?, ?, ?, ?)"
    ).run("read", 0, 500, now);

    const res = await app.request("/analytics/performance");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary.totalRequests).toBe(2);
    expect(json.data.summary.errorCount).toBe(1);
    expect(json.data.summary.successRate).toBe(50);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/analytics/performance?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns errorFrequency as an array", async () => {
    const res = await app.request("/analytics/performance");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.errorFrequency)).toBe(true);
  });
});

describe("GET /analytics/cost", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with daily and perTool fields", async () => {
    const res = await app.request("/analytics/cost");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("daily");
    expect(json.data).toHaveProperty("perTool");
  });

  it("returns empty arrays when no cost data exists", async () => {
    const res = await app.request("/analytics/cost");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.daily).toEqual([]);
    expect(json.data.perTool).toEqual([]);
  });

  it("returns cost records within period", async () => {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      "INSERT INTO cost_records (date, tokens_input, tokens_output, cost_usd, request_count) VALUES (?, ?, ?, ?, ?)"
    ).run(today, 1000, 500, 0.1, 5);

    const res = await app.request("/analytics/cost");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.daily.length).toBe(1);
    expect(json.data.daily[0].date).toBe(today);
    expect(json.data.daily[0].cost_usd).toBe(0.1);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/analytics/cost?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/analytics/cost?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

describe("GET /analytics/budget", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns budget status with null limit when not configured", async () => {
    const res = await app.request("/analytics/budget");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.monthly_limit_usd).toBeNull();
    expect(typeof json.data.current_month_cost_usd).toBe("number");
  });

  it("returns percent_used as null when no limit is set", async () => {
    const res = await app.request("/analytics/budget");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.percent_used).toBeNull();
  });
});

describe("PUT /analytics/budget", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("sets monthly budget limit successfully", async () => {
    const res = await app.request("/analytics/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit_usd: 100 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.monthly_limit_usd).toBe(100);
  });

  it("clears the budget limit when null is passed", async () => {
    // First set a limit
    await app.request("/analytics/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit_usd: 50 }),
    });

    // Then clear it
    const res = await app.request("/analytics/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit_usd: null }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.monthly_limit_usd).toBeNull();
  });

  it("returns updated budget status after setting limit", async () => {
    // Seed some cost data for the current month
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      "INSERT INTO cost_records (date, tokens_input, tokens_output, cost_usd, request_count) VALUES (?, ?, ?, ?, ?)"
    ).run(today, 1000, 500, 25, 10);

    const res = await app.request("/analytics/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit_usd: 100 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.monthly_limit_usd).toBe(100);
    expect(json.data.current_month_cost_usd).toBe(25);
    expect(json.data.percent_used).toBe(25);
  });

  it("returns 500 for invalid JSON body", async () => {
    const res = await app.request("/analytics/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
