// ── Analytics Service ────────────────────────────────────────────────
// Provides aggregated analytics data for the Analytics dashboard page.

import type { Database } from "better-sqlite3";

export interface PerformanceSummary {
  avgResponseMs: number | null;
  successRate: number | null;
  totalRequests: number;
  errorCount: number;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface ErrorFrequencyEntry {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface DailyCostEntry {
  date: string; // YYYY-MM-DD
  cost_usd: number;
  tokens_input: number;
  tokens_output: number;
  request_count: number;
}

export interface CostPerToolEntry {
  tool: string;
  count: number;
  avg_duration_ms: number | null;
}

export interface BudgetConfig {
  monthly_limit_usd: number | null;
}

export interface BudgetStatus {
  monthly_limit_usd: number | null;
  current_month_cost_usd: number;
  percent_used: number | null;
  projection_usd: number | null;
}

export class AnalyticsService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_metrics (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name    TEXT,
        tokens_used  INTEGER,
        duration_ms  INTEGER,
        success      INTEGER NOT NULL DEFAULT 1,  -- 1=true, 0=false
        error_message TEXT,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS cost_records (
        date           TEXT NOT NULL PRIMARY KEY,  -- YYYY-MM-DD
        tokens_input   INTEGER NOT NULL DEFAULT 0,
        tokens_output  INTEGER NOT NULL DEFAULT 0,
        cost_usd       REAL    NOT NULL DEFAULT 0,
        request_count  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS budget_config (
        key        TEXT NOT NULL PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  }

  // ── Performance ──────────────────────────────────────────────────

  getPerformanceSummary(periodHours: number): PerformanceSummary {
    const since = this.sinceUnix(periodHours);

    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_requests,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_count,
           AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS avg_duration_ms
         FROM request_metrics
         WHERE created_at >= ?`
      )
      .get(since) as {
      total_requests: number;
      error_count: number;
      avg_duration_ms: number | null;
    };

    const successRate =
      row.total_requests > 0
        ? ((row.total_requests - row.error_count) / row.total_requests) * 100
        : null;

    // Percentile calculation using SQLite window functions (available since 3.25)
    const p95Row = this.db
      .prepare(
        `SELECT duration_ms FROM request_metrics
         WHERE created_at >= ? AND duration_ms IS NOT NULL
         ORDER BY duration_ms
         LIMIT 1
         OFFSET CAST(0.95 * (SELECT COUNT(*) FROM request_metrics WHERE created_at >= ? AND duration_ms IS NOT NULL) AS INTEGER)`
      )
      .get(since, since) as { duration_ms: number } | undefined;

    const p99Row = this.db
      .prepare(
        `SELECT duration_ms FROM request_metrics
         WHERE created_at >= ? AND duration_ms IS NOT NULL
         ORDER BY duration_ms
         LIMIT 1
         OFFSET CAST(0.99 * (SELECT COUNT(*) FROM request_metrics WHERE created_at >= ? AND duration_ms IS NOT NULL) AS INTEGER)`
      )
      .get(since, since) as { duration_ms: number } | undefined;

    return {
      avgResponseMs: row.avg_duration_ms ?? null,
      successRate,
      totalRequests: row.total_requests,
      errorCount: row.error_count,
      p95Ms: p95Row?.duration_ms ?? null,
      p99Ms: p99Row?.duration_ms ?? null,
    };
  }

  getErrorFrequency(periodHours: number): ErrorFrequencyEntry[] {
    const since = this.sinceUnix(periodHours);
    return this.db
      .prepare(
        `SELECT
           date(created_at, 'unixepoch', 'localtime') AS date,
           COUNT(*) AS count
         FROM request_metrics
         WHERE created_at >= ? AND success = 0
         GROUP BY date
         ORDER BY date ASC`
      )
      .all(since) as ErrorFrequencyEntry[];
  }

  // ── Cost ──────────────────────────────────────────────────────────

  getDailyCost(periodDays: number): DailyCostEntry[] {
    const sinceDate = this.sinceDateStr(periodDays);
    return this.db
      .prepare(
        `SELECT date, cost_usd, tokens_input, tokens_output, request_count
         FROM cost_records
         WHERE date >= ?
         ORDER BY date ASC`
      )
      .all(sinceDate) as DailyCostEntry[];
  }

  getCostPerTool(periodHours: number): CostPerToolEntry[] {
    const since = this.sinceUnix(periodHours);
    return this.db
      .prepare(
        `SELECT
           tool_name AS tool,
           COUNT(*) AS count,
           AVG(duration_ms) AS avg_duration_ms
         FROM request_metrics
         WHERE created_at >= ? AND tool_name IS NOT NULL
         GROUP BY tool_name
         ORDER BY count DESC
         LIMIT 20`
      )
      .all(since) as CostPerToolEntry[];
  }

  // ── Budget ────────────────────────────────────────────────────────

  getBudgetConfig(): BudgetConfig {
    const row = this.db
      .prepare(`SELECT value FROM budget_config WHERE key = 'monthly_limit_usd'`)
      .get() as { value: string } | undefined;

    return {
      monthly_limit_usd: row ? parseFloat(row.value) : null,
    };
  }

  setBudgetConfig(config: BudgetConfig): void {
    if (config.monthly_limit_usd === null || config.monthly_limit_usd === undefined) {
      this.db.prepare(`DELETE FROM budget_config WHERE key = 'monthly_limit_usd'`).run();
    } else {
      this.db
        .prepare(
          `INSERT INTO budget_config (key, value, updated_at) VALUES ('monthly_limit_usd', ?, unixepoch())
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run(String(config.monthly_limit_usd));
    }
  }

  getBudgetStatus(): BudgetStatus {
    const config = this.getBudgetConfig();
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost, COALESCE(SUM(request_count), 0) AS total_requests
         FROM cost_records
         WHERE date LIKE ?`
      )
      .get(`${currentMonth}%`) as { total_cost: number; total_requests: number };

    const currentCost = row.total_cost;

    // Projection: extrapolate current month cost based on days elapsed
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projection = dayOfMonth > 0 ? (currentCost / dayOfMonth) * daysInMonth : null;

    const percentUsed =
      config.monthly_limit_usd && config.monthly_limit_usd > 0
        ? (currentCost / config.monthly_limit_usd) * 100
        : null;

    return {
      monthly_limit_usd: config.monthly_limit_usd,
      current_month_cost_usd: currentCost,
      percent_used: percentUsed,
      projection_usd: projection,
    };
  }

  // ── Request metrics recording (called from agent runtime) ─────────

  recordRequestMetric(opts: {
    toolName?: string;
    tokensUsed?: number;
    durationMs?: number;
    success: boolean;
    errorMessage?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO request_metrics (tool_name, tokens_used, duration_ms, success, error_message)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        opts.toolName ?? null,
        opts.tokensUsed ?? null,
        opts.durationMs ?? null,
        opts.success ? 1 : 0,
        opts.errorMessage ?? null
      );
  }

  // ── Cost record upsert (called from metrics service hook) ─────────

  upsertDailyCost(date: string, tokensInput: number, tokensOutput: number, costUsd: number): void {
    this.db
      .prepare(
        `INSERT INTO cost_records (date, tokens_input, tokens_output, cost_usd, request_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(date) DO UPDATE SET
           tokens_input = tokens_input + excluded.tokens_input,
           tokens_output = tokens_output + excluded.tokens_output,
           cost_usd = cost_usd + excluded.cost_usd,
           request_count = request_count + 1`
      )
      .run(date, tokensInput, tokensOutput, costUsd);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private sinceUnix(periodHours: number): number {
    return Math.floor(Date.now() / 1000) - periodHours * 3600;
  }

  private sinceDateStr(periodDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _instance: AnalyticsService | null = null;

export function initAnalytics(db: Database): AnalyticsService {
  _instance = new AnalyticsService(db);
  return _instance;
}

export function getAnalytics(): AnalyticsService | null {
  return _instance;
}
