import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { AnalyticsService, initAnalytics, getAnalytics } from "../analytics.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Schema helpers ─────────────────────────────────────────────────────────────

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
  `);

  return db;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function insertMetric(
  db: Database.Database,
  opts: {
    toolName?: string | null;
    success?: number;
    durationMs?: number | null;
    createdAt?: number;
  } = {}
): void {
  db.prepare(
    `INSERT INTO request_metrics (tool_name, success, duration_ms, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    opts.toolName ?? null,
    opts.success ?? 1,
    opts.durationMs ?? null,
    opts.createdAt ?? nowUnix()
  );
}

function insertCostRecord(
  db: Database.Database,
  date: string,
  tokensInput: number,
  tokensOutput: number,
  costUsd: number,
  requestCount: number
): void {
  db.prepare(
    `INSERT INTO cost_records (date, tokens_input, tokens_output, cost_usd, request_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(date, tokensInput, tokensOutput, costUsd, requestCount);
}

// ── AnalyticsService class tests ───────────────────────────────────────────────

describe("AnalyticsService", () => {
  let db: Database.Database;
  let service: AnalyticsService;

  beforeEach(() => {
    db = createTestDb();
    service = new AnalyticsService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── getPerformanceSummary ────────────────────────────────────────────────────

  describe("getPerformanceSummary", () => {
    it("returns zeroed summary when no requests exist", () => {
      const result = service.getPerformanceSummary(24);
      // SQLite SUM of an empty set returns null; the service passes it through as-is for counts.
      // totalRequests: COUNT(*) → 0 (COUNT always returns an integer)
      // errorCount: SUM(CASE ... END) over empty set → null
      expect(result.totalRequests).toBe(0);
      expect(result.errorCount).toBeNull();
      expect(result.avgResponseMs).toBeNull();
      expect(result.successRate).toBeNull();
      expect(result.p95Ms).toBeNull();
      expect(result.p99Ms).toBeNull();
    });

    it("calculates correct success rate with only successes", () => {
      insertMetric(db, { success: 1, durationMs: 100 });
      insertMetric(db, { success: 1, durationMs: 200 });
      insertMetric(db, { success: 1, durationMs: 300 });

      const result = service.getPerformanceSummary(24);
      expect(result.totalRequests).toBe(3);
      expect(result.errorCount).toBe(0);
      expect(result.successRate).toBe(100);
    });

    it("calculates success rate with mixed success and error", () => {
      insertMetric(db, { success: 1, durationMs: 100 });
      insertMetric(db, { success: 1, durationMs: 200 });
      insertMetric(db, { success: 0, durationMs: 50 });
      insertMetric(db, { success: 0, durationMs: 75 });

      const result = service.getPerformanceSummary(24);
      expect(result.totalRequests).toBe(4);
      expect(result.errorCount).toBe(2);
      expect(result.successRate).toBe(50);
    });

    it("calculates average response time", () => {
      insertMetric(db, { success: 1, durationMs: 100 });
      insertMetric(db, { success: 1, durationMs: 300 });

      const result = service.getPerformanceSummary(24);
      expect(result.avgResponseMs).toBe(200);
    });

    it("handles null duration_ms in average calculation", () => {
      insertMetric(db, { success: 1, durationMs: 200 });
      insertMetric(db, { success: 1, durationMs: null });

      const result = service.getPerformanceSummary(24);
      expect(result.avgResponseMs).toBe(200);
    });

    it("excludes records outside the time window", () => {
      const veryOldTs = nowUnix() - 48 * 3600; // 48 hours ago
      insertMetric(db, { success: 0, durationMs: 999, createdAt: veryOldTs });
      insertMetric(db, { success: 1, durationMs: 100 }); // recent

      const result = service.getPerformanceSummary(24);
      expect(result.totalRequests).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it("calculates p95 percentile with enough data", () => {
      // 20 data points so p95 offset is CAST(0.95 * 20) = 19 → last element
      for (let i = 1; i <= 20; i++) {
        insertMetric(db, { success: 1, durationMs: i * 10 });
      }

      const result = service.getPerformanceSummary(24);
      expect(result.p95Ms).not.toBeNull();
      expect(typeof result.p95Ms).toBe("number");
    });

    it("returns null p95/p99 when no duration data", () => {
      insertMetric(db, { success: 1, durationMs: null });

      const result = service.getPerformanceSummary(24);
      expect(result.p95Ms).toBeNull();
      expect(result.p99Ms).toBeNull();
    });
  });

  // ── getErrorFrequency ────────────────────────────────────────────────────────

  describe("getErrorFrequency", () => {
    it("returns empty array when no errors", () => {
      insertMetric(db, { success: 1 });
      const result = service.getErrorFrequency(24);
      expect(result).toEqual([]);
    });

    it("returns empty array when no records at all", () => {
      const result = service.getErrorFrequency(24);
      expect(result).toEqual([]);
    });

    it("groups errors by date and counts them", () => {
      // Insert 2 errors at current time
      insertMetric(db, { success: 0 });
      insertMetric(db, { success: 0 });
      insertMetric(db, { success: 1 }); // success, should not appear

      const result = service.getErrorFrequency(24);
      expect(result.length).toBe(1);
      expect(result[0].count).toBe(2);
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("excludes errors outside the time window", () => {
      const oldTs = nowUnix() - 72 * 3600;
      insertMetric(db, { success: 0, createdAt: oldTs });
      insertMetric(db, { success: 1 }); // recent success

      const result = service.getErrorFrequency(24);
      expect(result).toEqual([]);
    });
  });

  // ── getDailyCost ─────────────────────────────────────────────────────────────

  describe("getDailyCost", () => {
    it("returns empty array when no cost records", () => {
      const result = service.getDailyCost(30);
      expect(result).toEqual([]);
    });

    it("returns cost records within period", () => {
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, today, 1000, 500, 0.05, 3);

      const result = service.getDailyCost(7);
      expect(result.length).toBe(1);
      expect(result[0].date).toBe(today);
      expect(result[0].cost_usd).toBe(0.05);
      expect(result[0].tokens_input).toBe(1000);
      expect(result[0].tokens_output).toBe(500);
      expect(result[0].request_count).toBe(3);
    });

    it("excludes records older than the period", () => {
      const oldDate = "2020-01-01";
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, oldDate, 1000, 500, 1.0, 5);
      insertCostRecord(db, today, 200, 100, 0.01, 1);

      const result = service.getDailyCost(7);
      expect(result.length).toBe(1);
      expect(result[0].date).toBe(today);
    });

    it("returns records ordered by date ascending", () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      insertCostRecord(db, today, 100, 50, 0.01, 1);
      insertCostRecord(db, yesterday, 200, 100, 0.02, 2);

      const result = service.getDailyCost(7);
      expect(result.length).toBe(2);
      expect(result[0].date).toBe(yesterday);
      expect(result[1].date).toBe(today);
    });
  });

  // ── getCostPerTool ────────────────────────────────────────────────────────────

  describe("getCostPerTool", () => {
    it("returns empty array when no tool metrics", () => {
      const result = service.getCostPerTool(24);
      expect(result).toEqual([]);
    });

    it("ignores records with null tool_name", () => {
      insertMetric(db, { toolName: null, success: 1, durationMs: 100 });
      const result = service.getCostPerTool(24);
      expect(result).toEqual([]);
    });

    it("groups by tool name and calculates count and avg duration", () => {
      insertMetric(db, { toolName: "search", success: 1, durationMs: 100 });
      insertMetric(db, { toolName: "search", success: 1, durationMs: 200 });
      insertMetric(db, { toolName: "write_file", success: 1, durationMs: 300 });

      const result = service.getCostPerTool(24);
      expect(result.length).toBe(2);
      // Ordered by count DESC
      const searchEntry = result.find((e) => e.tool === "search");
      expect(searchEntry).toBeDefined();
      expect(searchEntry!.count).toBe(2);
      expect(searchEntry!.avg_duration_ms).toBe(150);
    });

    it("orders by count descending", () => {
      insertMetric(db, { toolName: "rare_tool", success: 1, durationMs: 50 });
      for (let i = 0; i < 5; i++) {
        insertMetric(db, { toolName: "common_tool", success: 1, durationMs: 100 });
      }

      const result = service.getCostPerTool(24);
      expect(result[0].tool).toBe("common_tool");
      expect(result[0].count).toBe(5);
    });

    it("excludes records outside the time window", () => {
      const oldTs = nowUnix() - 48 * 3600;
      insertMetric(db, { toolName: "old_tool", success: 1, durationMs: 100, createdAt: oldTs });
      insertMetric(db, { toolName: "new_tool", success: 1, durationMs: 200 });

      const result = service.getCostPerTool(24);
      expect(result.length).toBe(1);
      expect(result[0].tool).toBe("new_tool");
    });
  });

  // ── getBudgetConfig ───────────────────────────────────────────────────────────

  describe("getBudgetConfig", () => {
    it("returns null monthly_limit_usd when not configured", () => {
      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBeNull();
    });

    it("returns configured monthly limit", () => {
      db.prepare(
        `INSERT INTO budget_config (key, value) VALUES ('monthly_limit_usd', '100.50')`
      ).run();

      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBe(100.5);
    });
  });

  // ── setBudgetConfig ───────────────────────────────────────────────────────────

  describe("setBudgetConfig", () => {
    it("inserts a new budget limit", () => {
      service.setBudgetConfig({ monthly_limit_usd: 200 });
      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBe(200);
    });

    it("updates an existing budget limit", () => {
      service.setBudgetConfig({ monthly_limit_usd: 100 });
      service.setBudgetConfig({ monthly_limit_usd: 500 });
      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBe(500);
    });

    it("deletes the limit when null is provided", () => {
      service.setBudgetConfig({ monthly_limit_usd: 100 });
      service.setBudgetConfig({ monthly_limit_usd: null });
      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBeNull();
    });

    it("deletes the limit when undefined is provided", () => {
      service.setBudgetConfig({ monthly_limit_usd: 100 });
      service.setBudgetConfig({ monthly_limit_usd: undefined as unknown as null });
      const result = service.getBudgetConfig();
      expect(result.monthly_limit_usd).toBeNull();
    });
  });

  // ── getBudgetStatus ───────────────────────────────────────────────────────────

  describe("getBudgetStatus", () => {
    it("returns zeros and nulls when no cost records and no limit", () => {
      const result = service.getBudgetStatus();
      expect(result.current_month_cost_usd).toBe(0);
      expect(result.monthly_limit_usd).toBeNull();
      expect(result.percent_used).toBeNull();
    });

    it("returns current month costs from cost_records", () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, today, 1000, 500, 5.0, 10);

      const result = service.getBudgetStatus();
      expect(result.current_month_cost_usd).toBe(5.0);
    });

    it("excludes previous month cost records", () => {
      // Insert a record from a past month
      insertCostRecord(db, "2020-01-15", 10000, 5000, 99.0, 100);

      const result = service.getBudgetStatus();
      expect(result.current_month_cost_usd).toBe(0);
    });

    it("calculates percent_used when limit is set", () => {
      service.setBudgetConfig({ monthly_limit_usd: 100 });
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, today, 1000, 500, 25.0, 5);

      const result = service.getBudgetStatus();
      expect(result.monthly_limit_usd).toBe(100);
      expect(result.percent_used).toBe(25);
    });

    it("returns null percent_used when no limit is set", () => {
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, today, 1000, 500, 10.0, 2);

      const result = service.getBudgetStatus();
      expect(result.percent_used).toBeNull();
    });

    it("includes a projection_usd value", () => {
      const today = new Date().toISOString().slice(0, 10);
      insertCostRecord(db, today, 1000, 500, 10.0, 2);

      const result = service.getBudgetStatus();
      expect(typeof result.projection_usd).toBe("number");
      expect(result.projection_usd).toBeGreaterThan(0);
    });
  });

  // ── upsertDailyCost ───────────────────────────────────────────────────────────

  describe("upsertDailyCost", () => {
    it("inserts a new cost record for a new date", () => {
      service.upsertDailyCost("2024-06-01", 500, 250, 0.05);

      const row = db
        .prepare(`SELECT * FROM cost_records WHERE date = '2024-06-01'`)
        .get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.tokens_input).toBe(500);
      expect(row.tokens_output).toBe(250);
      expect(row.cost_usd).toBe(0.05);
      expect(row.request_count).toBe(1);
    });

    it("accumulates values on conflict (same date)", () => {
      service.upsertDailyCost("2024-06-02", 500, 250, 0.05);
      service.upsertDailyCost("2024-06-02", 300, 150, 0.03);

      const row = db
        .prepare(`SELECT * FROM cost_records WHERE date = '2024-06-02'`)
        .get() as Record<string, unknown>;
      expect(row.tokens_input).toBe(800);
      expect(row.tokens_output).toBe(400);
      expect(Number(row.cost_usd)).toBeCloseTo(0.08);
      expect(row.request_count).toBe(2);
    });

    it("handles zero values without error", () => {
      service.upsertDailyCost("2024-06-03", 0, 0, 0);

      const row = db
        .prepare(`SELECT * FROM cost_records WHERE date = '2024-06-03'`)
        .get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.cost_usd).toBe(0);
    });
  });
});

// ── Module-level singleton tests ───────────────────────────────────────────────

describe("initAnalytics / getAnalytics", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("initAnalytics returns an AnalyticsService instance", () => {
    const instance = initAnalytics(db);
    expect(instance).toBeInstanceOf(AnalyticsService);
  });

  it("getAnalytics returns the instance set by initAnalytics", () => {
    const instance = initAnalytics(db);
    expect(getAnalytics()).toBe(instance);
  });

  it("initAnalytics replaces the existing singleton", () => {
    const db2 = createTestDb();
    const first = initAnalytics(db);
    const second = initAnalytics(db2);
    expect(getAnalytics()).toBe(second);
    expect(second).not.toBe(first);
    db2.close();
  });
});
