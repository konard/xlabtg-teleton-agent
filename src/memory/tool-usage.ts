import type Database from "better-sqlite3";

export interface ToolUsageStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: number | null;
  avgDurationMs: number | null;
}

/**
 * Record a tool execution result for usage tracking.
 */
export function recordToolUsage(
  db: Database.Database,
  toolName: string,
  success: boolean,
  durationMs?: number
): void {
  db.prepare(
    `INSERT INTO tool_usage (tool_name, success, duration_ms, created_at)
     VALUES (?, ?, ?, unixepoch())`
  ).run(toolName, success ? 1 : 0, durationMs ?? null);
}

/**
 * Get usage statistics for all tools in a single query.
 * Returns a map of tool name → stats.
 */
export function getAllToolUsageStats(db: Database.Database): Record<string, ToolUsageStats> {
  const rows = db
    .prepare(
      `SELECT
         tool_name,
         COUNT(*) AS total_calls,
         SUM(success) AS success_count,
         SUM(1 - success) AS failure_count,
         MAX(created_at) AS last_used_at,
         AVG(duration_ms) AS avg_duration_ms
       FROM tool_usage
       GROUP BY tool_name`
    )
    .all() as {
    tool_name: string;
    total_calls: number;
    success_count: number;
    failure_count: number;
    last_used_at: number | null;
    avg_duration_ms: number | null;
  }[];

  const result: Record<string, ToolUsageStats> = {};
  for (const row of rows) {
    result[row.tool_name] = {
      totalCalls: row.total_calls,
      successCount: row.success_count ?? 0,
      failureCount: row.failure_count ?? 0,
      lastUsedAt: row.last_used_at,
      avgDurationMs: row.avg_duration_ms,
    };
  }
  return result;
}

/**
 * Get usage statistics for a single tool.
 */
export function getToolUsageStats(db: Database.Database, toolName: string): ToolUsageStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total_calls,
         SUM(success) AS success_count,
         SUM(1 - success) AS failure_count,
         MAX(created_at) AS last_used_at,
         AVG(duration_ms) AS avg_duration_ms
       FROM tool_usage
       WHERE tool_name = ?`
    )
    .get(toolName) as {
    total_calls: number;
    success_count: number;
    failure_count: number;
    last_used_at: number | null;
    avg_duration_ms: number | null;
  };

  return {
    totalCalls: row.total_calls,
    successCount: row.success_count ?? 0,
    failureCount: row.failure_count ?? 0,
    lastUsedAt: row.last_used_at,
    avgDurationMs: row.avg_duration_ms,
  };
}
