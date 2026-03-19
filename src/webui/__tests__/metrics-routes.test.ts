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

import { createMetricsRoutes } from "../routes/metrics.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // MetricsService.migrate() will create the tables, but we need it to work
  // with our in-memory db as well.
  return db;
}

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/metrics", createMetricsRoutes(deps));
  return app;
}

// ── Helper to insert metric data ─────────────────────────────────────

function insertTokenBucket(
  db: Database.Database,
  bucket: number,
  tokens: number,
  cost: number
): void {
  db.prepare("INSERT OR REPLACE INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
    bucket,
    tokens,
    cost
  );
}

function insertToolCall(db: Database.Database, bucket: number, tool: string, count: number): void {
  db.prepare("INSERT OR REPLACE INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
    bucket,
    tool,
    count
  );
}

function currentHourBucket(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 3600);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /metrics/tokens", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty array when no token data exists", async () => {
    const res = await app.request("/metrics/tokens");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });

  it("returns token usage data for default 24h period", async () => {
    const bucket = currentHourBucket();
    insertTokenBucket(db, bucket, 1500, 0.075);

    const res = await app.request("/metrics/tokens");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].tokens).toBe(1500);
    expect(json.data[0].cost).toBe(0.075);
    expect(json.data[0].timestamp).toBe(bucket);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/metrics/tokens?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/metrics/tokens?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("excludes data outside the requested 24h period", async () => {
    // Insert a bucket 48 hours ago (outside 24h default window)
    const oldBucket = Math.floor(Date.now() / 1000) - 48 * 3600;
    insertTokenBucket(db, oldBucket, 999, 0.05);

    const res = await app.request("/metrics/tokens");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });

  it("includes data within 7d period", async () => {
    // Insert a bucket 5 days ago (within 7d window)
    const bucket = Math.floor(Date.now() / 1000) - 5 * 24 * 3600;
    const alignedBucket = bucket - (bucket % 3600);
    insertTokenBucket(db, alignedBucket, 500, 0.025);

    const res = await app.request("/metrics/tokens?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  it("returns token data sorted by timestamp ascending", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bucket1 = now - (now % 3600) - 3600;
    const bucket2 = now - (now % 3600);
    insertTokenBucket(db, bucket1, 100, 0.01);
    insertTokenBucket(db, bucket2, 200, 0.02);

    const res = await app.request("/metrics/tokens?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.data[0].timestamp).toBeLessThan(json.data[1].timestamp);
  });
});

describe("GET /metrics/tools", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty array when no tool data exists", async () => {
    const res = await app.request("/metrics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });

  it("returns tool usage counts for default 24h period", async () => {
    const bucket = currentHourBucket();
    insertToolCall(db, bucket, "search", 10);
    insertToolCall(db, bucket, "read_file", 3);

    const res = await app.request("/metrics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
    // Sorted by count DESC
    expect(json.data[0].tool).toBe("search");
    expect(json.data[0].count).toBe(10);
    expect(json.data[1].tool).toBe("read_file");
    expect(json.data[1].count).toBe(3);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/metrics/tools?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/metrics/tools?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("excludes tool calls outside the period", async () => {
    const oldBucket = Math.floor(Date.now() / 1000) - 48 * 3600;
    insertToolCall(db, oldBucket, "old_tool", 5);

    const res = await app.request("/metrics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });

  it("returns tool and count fields in each entry", async () => {
    const bucket = currentHourBucket();
    insertToolCall(db, bucket, "my_tool", 7);

    const res = await app.request("/metrics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0]).toHaveProperty("tool");
    expect(json.data[0]).toHaveProperty("count");
    expect(json.data[0].tool).toBe("my_tool");
    expect(json.data[0].count).toBe(7);
  });

  it("limits results to top 10 tools", async () => {
    const bucket = currentHourBucket();
    for (let i = 0; i < 15; i++) {
      insertToolCall(db, bucket, `tool_${i}`, i + 1);
    }

    const res = await app.request("/metrics/tools");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeLessThanOrEqual(10);
  });
});

describe("GET /metrics/activity", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns success with empty array when no data exists", async () => {
    const res = await app.request("/metrics/activity");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("accepts period=7d query param", async () => {
    const res = await app.request("/metrics/activity?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts period=30d query param", async () => {
    const res = await app.request("/metrics/activity?period=30d");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns activity data with dayOfWeek and hour fields", async () => {
    const bucket = currentHourBucket();
    insertTokenBucket(db, bucket, 2000, 0.1);

    const res = await app.request("/metrics/activity");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    if (json.data.length > 0) {
      const entry = json.data[0];
      expect(typeof entry.dayOfWeek).toBe("number");
      expect(entry.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(entry.dayOfWeek).toBeLessThanOrEqual(6);
      expect(typeof entry.hour).toBe("number");
      expect(entry.hour).toBeGreaterThanOrEqual(0);
      expect(entry.hour).toBeLessThanOrEqual(23);
      expect(typeof entry.count).toBe("number");
    }
  });

  it("excludes data outside the period", async () => {
    const oldBucket = Math.floor(Date.now() / 1000) - 48 * 3600;
    insertTokenBucket(db, oldBucket, 500, 0.025);

    const res = await app.request("/metrics/activity");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});
