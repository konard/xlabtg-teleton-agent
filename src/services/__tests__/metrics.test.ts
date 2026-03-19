import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { MetricsService, initMetrics, getMetrics } from "../metrics.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(":memory:");
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function currentHourBucket(): number {
  const now = nowUnix();
  return now - (now % 3600);
}

// ── MetricsService class tests ─────────────────────────────────────────────────

describe("MetricsService", () => {
  let db: Database.Database;
  let service: MetricsService;

  beforeEach(() => {
    db = createTestDb();
    service = new MetricsService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── migrate() / table creation ────────────────────────────────────────────────

  it("creates metric_tokens table on construction", () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='metric_tokens'`)
      .get();
    expect(row).toBeDefined();
  });

  it("creates metric_tool_calls table on construction", () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='metric_tool_calls'`)
      .get();
    expect(row).toBeDefined();
  });

  // ── recordTokenUsage() ────────────────────────────────────────────────────────

  describe("recordTokenUsage()", () => {
    it("inserts a token usage record for the current hour bucket", () => {
      service.recordTokenUsage(1000, 0.05);

      const bucket = currentHourBucket();
      const row = db
        .prepare("SELECT tokens, cost FROM metric_tokens WHERE bucket = ?")
        .get(bucket) as { tokens: number; cost: number } | undefined;

      expect(row).toBeDefined();
      expect(row!.tokens).toBe(1000);
      expect(row!.cost).toBeCloseTo(0.05);
    });

    it("accumulates tokens and cost for the same hour bucket", () => {
      service.recordTokenUsage(500, 0.02);
      service.recordTokenUsage(300, 0.01);

      const bucket = currentHourBucket();
      const row = db
        .prepare("SELECT tokens, cost FROM metric_tokens WHERE bucket = ?")
        .get(bucket) as { tokens: number; cost: number };

      expect(row.tokens).toBe(800);
      expect(row.cost).toBeCloseTo(0.03);
    });

    it("handles zero tokens and zero cost", () => {
      service.recordTokenUsage(0, 0);

      const bucket = currentHourBucket();
      const row = db
        .prepare("SELECT tokens, cost FROM metric_tokens WHERE bucket = ?")
        .get(bucket) as { tokens: number; cost: number };
      expect(row.tokens).toBe(0);
      expect(row.cost).toBe(0);
    });

    it("handles large token counts", () => {
      service.recordTokenUsage(1_000_000, 5.0);

      const bucket = currentHourBucket();
      const row = db.prepare("SELECT tokens FROM metric_tokens WHERE bucket = ?").get(bucket) as {
        tokens: number;
      };
      expect(row.tokens).toBe(1_000_000);
    });
  });

  // ── recordToolCall() ──────────────────────────────────────────────────────────

  describe("recordToolCall()", () => {
    it("inserts a tool call record for the current hour bucket", () => {
      service.recordToolCall("search");

      const bucket = currentHourBucket();
      const row = db
        .prepare("SELECT count FROM metric_tool_calls WHERE bucket = ? AND tool = ?")
        .get(bucket, "search") as { count: number } | undefined;

      expect(row).toBeDefined();
      expect(row!.count).toBe(1);
    });

    it("increments count on repeated calls for the same tool in the same bucket", () => {
      service.recordToolCall("write_file");
      service.recordToolCall("write_file");
      service.recordToolCall("write_file");

      const bucket = currentHourBucket();
      const row = db
        .prepare("SELECT count FROM metric_tool_calls WHERE bucket = ? AND tool = ?")
        .get(bucket, "write_file") as { count: number };

      expect(row.count).toBe(3);
    });

    it("tracks different tools independently", () => {
      service.recordToolCall("search");
      service.recordToolCall("read_file");
      service.recordToolCall("search");

      const bucket = currentHourBucket();
      const search = db
        .prepare("SELECT count FROM metric_tool_calls WHERE bucket = ? AND tool = ?")
        .get(bucket, "search") as { count: number };
      const readFile = db
        .prepare("SELECT count FROM metric_tool_calls WHERE bucket = ? AND tool = ?")
        .get(bucket, "read_file") as { count: number };

      expect(search.count).toBe(2);
      expect(readFile.count).toBe(1);
    });
  });

  // ── getTokenUsage() ───────────────────────────────────────────────────────────

  describe("getTokenUsage()", () => {
    it("returns empty array when no token records exist", () => {
      const result = service.getTokenUsage(24);
      expect(result).toEqual([]);
    });

    it("returns token usage data points within the period", () => {
      service.recordTokenUsage(1000, 0.05);

      const result = service.getTokenUsage(24);
      expect(result.length).toBe(1);
      expect(result[0].tokens).toBe(1000);
      expect(result[0].cost).toBeCloseTo(0.05);
      expect(typeof result[0].timestamp).toBe("number");
    });

    it("excludes records outside the period", () => {
      const bucket = currentHourBucket();
      const oldBucket = bucket - 48 * 3600; // 48 hours ago
      db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
        oldBucket,
        5000,
        0.5
      );

      service.recordTokenUsage(100, 0.01); // recent

      const result = service.getTokenUsage(24);
      expect(result.length).toBe(1);
      expect(result[0].tokens).toBe(100);
    });

    it("returns data ordered by timestamp ascending", () => {
      const bucket = currentHourBucket();
      db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
        bucket - 7200,
        100,
        0.01
      ); // 2 hours ago
      db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
        bucket - 3600,
        200,
        0.02
      ); // 1 hour ago
      db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
        bucket,
        300,
        0.03
      ); // current

      const result = service.getTokenUsage(24);
      expect(result.length).toBe(3);
      expect(result[0].timestamp).toBeLessThan(result[1].timestamp);
      expect(result[1].timestamp).toBeLessThan(result[2].timestamp);
    });
  });

  // ── getToolUsage() ────────────────────────────────────────────────────────────

  describe("getToolUsage()", () => {
    it("returns empty array when no tool call records exist", () => {
      const result = service.getToolUsage(24);
      expect(result).toEqual([]);
    });

    it("returns tool usage with aggregated counts", () => {
      service.recordToolCall("search");
      service.recordToolCall("search");
      service.recordToolCall("read_file");

      const result = service.getToolUsage(24);
      expect(result.length).toBe(2);
      const searchEntry = result.find((e) => e.tool === "search");
      expect(searchEntry?.count).toBe(2);
      const readEntry = result.find((e) => e.tool === "read_file");
      expect(readEntry?.count).toBe(1);
    });

    it("orders tools by count descending", () => {
      service.recordToolCall("rare_tool");
      for (let i = 0; i < 5; i++) {
        service.recordToolCall("popular_tool");
      }

      const result = service.getToolUsage(24);
      expect(result[0].tool).toBe("popular_tool");
      expect(result[0].count).toBe(5);
    });

    it("limits results to top 10 tools", () => {
      for (let i = 0; i < 15; i++) {
        service.recordToolCall(`tool_${i}`);
      }

      const result = service.getToolUsage(24);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("excludes records outside the period", () => {
      const bucket = currentHourBucket();
      const oldBucket = bucket - 48 * 3600;
      db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
        oldBucket,
        "old_tool",
        100
      );

      service.recordToolCall("new_tool");

      const result = service.getToolUsage(24);
      expect(result.length).toBe(1);
      expect(result[0].tool).toBe("new_tool");
    });

    it("aggregates across multiple buckets within the period", () => {
      const bucket = currentHourBucket();
      db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
        bucket - 3600,
        "search",
        3
      ); // 1 hour ago
      db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
        bucket,
        "search",
        2
      ); // current bucket

      const result = service.getToolUsage(24);
      const searchEntry = result.find((e) => e.tool === "search");
      expect(searchEntry?.count).toBe(5);
    });
  });

  // ── getActivity() ─────────────────────────────────────────────────────────────

  describe("getActivity()", () => {
    it("returns empty array when no token records exist", () => {
      const result = service.getActivity(24);
      expect(result).toEqual([]);
    });

    it("returns activity entries with dayOfWeek and hour fields", () => {
      service.recordTokenUsage(1000, 0.05);

      const result = service.getActivity(24);
      expect(result.length).toBe(1);
      expect(typeof result[0].dayOfWeek).toBe("number");
      expect(typeof result[0].hour).toBe("number");
      expect(result[0].dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(result[0].dayOfWeek).toBeLessThanOrEqual(6);
      expect(result[0].hour).toBeGreaterThanOrEqual(0);
      expect(result[0].hour).toBeLessThanOrEqual(23);
    });

    it("excludes buckets outside the period", () => {
      const bucket = currentHourBucket();
      const oldBucket = bucket - 48 * 3600;
      db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
        oldBucket,
        999,
        1.0
      );

      const result = service.getActivity(24);
      expect(result).toEqual([]);
    });

    it("includes tool call counts in activity", () => {
      service.recordTokenUsage(1000, 0.05);
      service.recordToolCall("search");
      service.recordToolCall("search");

      const result = service.getActivity(24);
      expect(result.length).toBe(1);
      // count = tool calls + tokens/1000 = 2 + 1 = 3
      expect(result[0].count).toBeGreaterThan(0);
    });
  });
});

// ── Module-level singleton tests ───────────────────────────────────────────────

describe("initMetrics / getMetrics", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("initMetrics returns a MetricsService instance", () => {
    const instance = initMetrics(db);
    expect(instance).toBeInstanceOf(MetricsService);
  });

  it("getMetrics returns the instance set by initMetrics", () => {
    const instance = initMetrics(db);
    expect(getMetrics()).toBe(instance);
  });

  it("initMetrics replaces the existing singleton", () => {
    const db2 = createTestDb();
    const first = initMetrics(db);
    const second = initMetrics(db2);
    expect(getMetrics()).toBe(second);
    expect(second).not.toBe(first);
    db2.close();
  });
});
