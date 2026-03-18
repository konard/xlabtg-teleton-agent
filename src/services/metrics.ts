// ── Metrics Service ─────────────────────────────────────────────────
// Persists token usage and tool invocation data to SQLite for charting.

import type { Database } from "better-sqlite3";

export interface TokenDataPoint {
  timestamp: number; // unix seconds, truncated to hour
  tokens: number;
  cost: number;
}

export interface ToolUsageEntry {
  tool: string;
  count: number;
}

export interface ActivityEntry {
  dayOfWeek: number; // 0=Sun … 6=Sat
  hour: number; // 0–23
  count: number;
}

export class MetricsService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metric_tokens (
        bucket    INTEGER NOT NULL PRIMARY KEY, -- unix seconds truncated to hour
        tokens    INTEGER NOT NULL DEFAULT 0,
        cost      REAL    NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS metric_tool_calls (
        bucket    INTEGER NOT NULL, -- unix seconds truncated to hour
        tool      TEXT    NOT NULL,
        count     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket, tool)
      );
    `);
  }

  /** Record a token usage event (called from accumulateTokenUsage hook). */
  recordTokenUsage(tokens: number, cost: number): void {
    const bucket = this.currentHourBucket();
    this.db
      .prepare(
        `INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)
         ON CONFLICT(bucket) DO UPDATE SET tokens = tokens + excluded.tokens, cost = cost + excluded.cost`
      )
      .run(bucket, tokens, cost);
  }

  /** Record a tool invocation (called after each tool call). */
  recordToolCall(toolName: string): void {
    const bucket = this.currentHourBucket();
    this.db
      .prepare(
        `INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket, tool) DO UPDATE SET count = count + 1`
      )
      .run(bucket, toolName);
  }

  /** Token usage bucketed by hour for the given period. */
  getTokenUsage(periodHours: number): TokenDataPoint[] {
    const since = Math.floor(Date.now() / 1000) - periodHours * 3600;
    return this.db
      .prepare(
        `SELECT bucket AS timestamp, tokens, cost
         FROM metric_tokens
         WHERE bucket >= ?
         ORDER BY bucket ASC`
      )
      .all(since) as TokenDataPoint[];
  }

  /** Tool usage counts for the given period, top 10. */
  getToolUsage(periodHours: number): ToolUsageEntry[] {
    const since = Math.floor(Date.now() / 1000) - periodHours * 3600;
    return this.db
      .prepare(
        `SELECT tool, SUM(count) AS count
         FROM metric_tool_calls
         WHERE bucket >= ?
         GROUP BY tool
         ORDER BY count DESC
         LIMIT 10`
      )
      .all(since) as ToolUsageEntry[];
  }

  /** Activity matrix: requests per day-of-week and hour, for the given period. */
  getActivity(periodHours: number): ActivityEntry[] {
    const since = Math.floor(Date.now() / 1000) - periodHours * 3600;
    // SQLite strftime uses '%w' for day-of-week (0=Sun) and '%H' for hour
    return this.db
      .prepare(
        `SELECT
           CAST(strftime('%w', bucket, 'unixepoch', 'localtime') AS INTEGER) AS dayOfWeek,
           CAST(strftime('%H', bucket, 'unixepoch', 'localtime') AS INTEGER) AS hour,
           SUM(
             (SELECT COALESCE(SUM(count), 0) FROM metric_tool_calls mc WHERE mc.bucket = mt.bucket)
             + mt.tokens / 1000
           ) AS count
         FROM metric_tokens mt
         WHERE bucket >= ?
         GROUP BY dayOfWeek, hour
         ORDER BY dayOfWeek, hour`
      )
      .all(since) as ActivityEntry[];
  }

  private currentHourBucket(): number {
    const now = Math.floor(Date.now() / 1000);
    return now - (now % 3600);
  }
}

// ── Module-level singleton ───────────────────────────────────────────
// Allows agent runtime to record metrics without holding a direct DB ref.

let _instance: MetricsService | null = null;

export function initMetrics(db: Database): MetricsService {
  _instance = new MetricsService(db);
  return _instance;
}

export function getMetrics(): MetricsService | null {
  return _instance;
}
