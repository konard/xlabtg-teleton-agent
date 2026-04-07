import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");
const PLUGIN_DB_PATH = join(PLUGIN_DATA_DIR, "self-improvement-assistant.db");

export interface AnalysisLogEntry {
  id: number;
  timestamp: number;
  repo: string;
  branch: string;
  files_analyzed: number;
  issues_found: number;
  issues_created: number;
  summary: string | null;
}

export interface ImprovementTask {
  id: number;
  analysis_id: number | null;
  task_type: string;
  priority: string;
  file_path: string | null;
  description: string;
  suggestion: string | null;
  code_snippet: string | null;
  status: string;
  created_at: number;
  github_issue_url: string | null;
}

/** Open (read-only) the plugin SQLite DB if it exists. Returns null otherwise. */
function openPluginDb(): Database.Database | null {
  if (!existsSync(PLUGIN_DB_PATH)) return null;
  return new Database(PLUGIN_DB_PATH, { readonly: true });
}

export function createSelfImprovementRoutes() {
  const app = new Hono();

  // GET /api/self-improvement/status
  // Returns whether the plugin DB exists and basic stats.
  app.get("/status", (c) => {
    const installed = existsSync(PLUGIN_DB_PATH);
    if (!installed) {
      return c.json<APIResponse<{ installed: boolean }>>({
        success: true,
        data: { installed: false },
      });
    }

    let db: Database.Database | null = null;
    try {
      db = openPluginDb();
      if (!db) {
        return c.json<APIResponse<{ installed: boolean }>>({
          success: true,
          data: { installed: false },
        });
      }

      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      const analysisCount = tableNames.includes("analysis_log")
        ? (db.prepare(`SELECT COUNT(*) as cnt FROM analysis_log`).get() as { cnt: number }).cnt
        : 0;

      const pendingCount = tableNames.includes("improvement_tasks")
        ? (
            db
              .prepare(`SELECT COUNT(*) as cnt FROM improvement_tasks WHERE status = 'pending'`)
              .get() as { cnt: number }
          ).cnt
        : 0;

      const lastAnalysis = tableNames.includes("analysis_log")
        ? ((
            db
              .prepare(`SELECT timestamp FROM analysis_log ORDER BY timestamp DESC LIMIT 1`)
              .get() as { timestamp: number } | undefined
          )?.timestamp ?? null)
        : null;

      return c.json<
        APIResponse<{
          installed: boolean;
          analysis_count: number;
          pending_tasks: number;
          last_analysis: number | null;
        }>
      >({
        success: true,
        data: {
          installed: true,
          analysis_count: analysisCount,
          pending_tasks: pendingCount,
          last_analysis: lastAnalysis,
        },
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    } finally {
      db?.close();
    }
  });

  // GET /api/self-improvement/analysis?limit=10
  // Returns recent analysis log entries.
  app.get("/analysis", (c) => {
    let db: Database.Database | null = null;
    try {
      db = openPluginDb();
      if (!db) {
        return c.json<APIResponse<AnalysisLogEntry[]>>({ success: true, data: [] });
      }

      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_log'`)
        .all();
      if (tables.length === 0) {
        return c.json<APIResponse<AnalysisLogEntry[]>>({ success: true, data: [] });
      }

      const limitParam = c.req.query("limit");
      const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);

      const rows = db
        .prepare(`SELECT * FROM analysis_log ORDER BY timestamp DESC LIMIT ?`)
        .all(limit) as AnalysisLogEntry[];

      return c.json<APIResponse<AnalysisLogEntry[]>>({ success: true, data: rows });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    } finally {
      db?.close();
    }
  });

  // GET /api/self-improvement/tasks?status=pending&limit=20
  // Returns improvement tasks, optionally filtered by status.
  app.get("/tasks", (c) => {
    let db: Database.Database | null = null;
    try {
      db = openPluginDb();
      if (!db) {
        return c.json<APIResponse<ImprovementTask[]>>({ success: true, data: [] });
      }

      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='improvement_tasks'`)
        .all();
      if (tables.length === 0) {
        return c.json<APIResponse<ImprovementTask[]>>({ success: true, data: [] });
      }

      const status = c.req.query("status") ?? "all";
      const limitParam = c.req.query("limit");
      const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 200);

      const rows =
        status === "all"
          ? (db
              .prepare(`SELECT * FROM improvement_tasks ORDER BY created_at DESC LIMIT ?`)
              .all(limit) as ImprovementTask[])
          : (db
              .prepare(
                `SELECT * FROM improvement_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`
              )
              .all(status, limit) as ImprovementTask[]);

      return c.json<APIResponse<ImprovementTask[]>>({ success: true, data: rows });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    } finally {
      db?.close();
    }
  });

  return app;
}
