import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");
const PLUGIN_DB_PATH = join(PLUGIN_DATA_DIR, "self-improve-orchestrator.db");

/** Key used to persist the meta-orchestrator config in the agent's main DB. */
const CONFIG_KEY = "self_improvement_orchestrator_config";

export interface TargetRepo {
  id: string;
  name: string;
  lastScan: number | null;
  issueCount: number;
  enabled: boolean;
}

export interface ScanScope {
  source_code: boolean;
  config_files: boolean;
  dependencies: boolean;
  documentation: boolean;
  exclude_paths: string;
}

export interface AutomationSettings {
  auto_create_prs: boolean;
  fix_severity: "critical" | "critical_high" | "all";
  branch_prefix: string;
  draft_pr: boolean;
  run_tests: boolean;
  auto_merge: boolean;
}

export interface MetaOrchestratorConfig {
  selected_plugin: string;
  guide_url: string;
  target_repo: string;
  focus_areas: string[];
  auto_create_issues: boolean;
  schedule_enabled: boolean;
  schedule_interval_hours: number;
  require_approval: boolean;
  // Automation tab settings
  automation: AutomationSettings;
  // Targets tab settings
  targets: TargetRepo[];
  scan_scope: ScanScope;
}

const DEFAULT_CONFIG: MetaOrchestratorConfig = {
  selected_plugin: "",
  guide_url: "",
  target_repo: "",
  focus_areas: ["security", "performance", "readability"],
  auto_create_issues: false,
  schedule_enabled: false,
  schedule_interval_hours: 24,
  require_approval: true,
  automation: {
    auto_create_prs: false,
    fix_severity: "critical_high",
    branch_prefix: "fix/auto-",
    draft_pr: true,
    run_tests: true,
    auto_merge: false,
  },
  targets: [],
  scan_scope: {
    source_code: true,
    config_files: true,
    dependencies: true,
    documentation: false,
    exclude_paths: "/node_modules, /dist, /vendor",
  },
};

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

/** Load config from the main agent DB's user_hook_config table. */
function loadConfig(db: Database.Database): MetaOrchestratorConfig {
  try {
    const row = db.prepare(`SELECT value FROM user_hook_config WHERE key = ?`).get(CONFIG_KEY) as
      | { value: string }
      | undefined;
    if (!row) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(row.value) as Partial<MetaOrchestratorConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist config into the main agent DB's user_hook_config table. */
function saveConfig(db: Database.Database, config: MetaOrchestratorConfig): void {
  db.prepare(
    `INSERT OR REPLACE INTO user_hook_config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).run(CONFIG_KEY, JSON.stringify(config));
}

export function createSelfImprovementRoutes(deps?: WebUIServerDeps) {
  const app = new Hono();

  // ── Config endpoints ────────────────────────────────────────────────────────

  // GET /api/self-improvement/config
  app.get("/config", (c) => {
    if (!deps?.memory?.db) {
      return c.json<APIResponse<MetaOrchestratorConfig>>({
        success: true,
        data: { ...DEFAULT_CONFIG },
      });
    }
    try {
      const config = loadConfig(deps.memory.db);
      return c.json<APIResponse<MetaOrchestratorConfig>>({ success: true, data: config });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // POST /api/self-improvement/config
  app.post("/config", async (c) => {
    if (!deps?.memory?.db) {
      return c.json<APIResponse>({ success: false, error: "Memory DB not available" }, 503);
    }
    try {
      const body = await c.req.json<Partial<MetaOrchestratorConfig>>();
      const current = loadConfig(deps.memory.db);
      const updated: MetaOrchestratorConfig = { ...current, ...body };
      saveConfig(deps.memory.db, updated);
      return c.json<APIResponse<MetaOrchestratorConfig>>({ success: true, data: updated });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // ── Trigger endpoint ────────────────────────────────────────────────────────

  // POST /api/self-improvement/trigger
  // Dispatches a self-improvement analysis task via the configured plugin.
  app.post("/trigger", async (c) => {
    if (!deps) {
      return c.json<APIResponse>({ success: false, error: "Server deps not available" }, 503);
    }
    if (!deps.memory?.db) {
      return c.json<APIResponse>({ success: false, error: "Memory DB not available" }, 503);
    }

    try {
      const cfg = loadConfig(deps.memory.db);

      if (!cfg.selected_plugin) {
        return c.json<APIResponse>(
          {
            success: false,
            error: "No plugin selected. Configure a plugin in Self-Improve settings.",
          },
          422
        );
      }

      const agentConfig = deps.agent.getConfig();
      const adminChatId = agentConfig.telegram?.admin_ids?.[0];
      if (!adminChatId) {
        return c.json<APIResponse>(
          { success: false, error: "No admin_ids configured in Telegram settings" },
          422
        );
      }

      // Build the self-improvement prompt that will be processed by the agent.
      // The prompt references the selected plugin and guide URL so the agent can
      // use the plugin's tools to perform the analysis.
      const focusAreasText =
        cfg.focus_areas.length > 0 ? cfg.focus_areas.join(", ") : "general code quality";
      const repoText = cfg.target_repo || "the teleton-agent codebase";

      // Guide URL is the primary instruction — the agent must read and follow it first
      // before taking any other action.
      const guideInstruction = cfg.guide_url
        ? `IMPORTANT: Before doing anything else, read the guide at ${cfg.guide_url} and strictly follow the instructions and workflows described there for all subsequent steps. Do not use web search, browser, or any other tools until you have read this guide.`
        : "";

      // Automation / PR settings
      const auto = cfg.automation;
      let prInstruction = "";
      if (auto.auto_create_prs) {
        const severityLabel =
          auto.fix_severity === "critical"
            ? "critical"
            : auto.fix_severity === "critical_high"
              ? "critical and high"
              : "all";
        const prType = auto.draft_pr ? "draft " : "";
        const testStep = auto.run_tests
          ? " Run the tests first and only create the PR if they pass."
          : "";
        const mergeStep = auto.auto_merge ? " After tests pass, enable auto-merge on the PR." : "";
        prInstruction =
          ` For every ${severityLabel} severity finding, create a ${prType}Pull Request with a fix using branch prefix "${auto.branch_prefix}".` +
          testStep +
          mergeStep;
      }

      const issueInstruction = cfg.auto_create_issues
        ? " Automatically create GitHub issues for critical and high severity findings."
        : " List findings but do NOT create GitHub issues automatically — await user approval.";

      const prompt =
        (guideInstruction ? guideInstruction + " " : "") +
        `Perform a self-improvement analysis of ${repoText} using the ${cfg.selected_plugin} plugin. ` +
        `Focus areas: ${focusAreasText}.` +
        issueInstruction +
        prInstruction +
        " Report a summary of findings when complete.";

      const sessionChatId = `telegram:direct:${adminChatId}`;
      const { getDatabase } = await import("../../memory/index.js");
      const toolContext = {
        bridge: deps.bridge,
        db: getDatabase().getDb(),
        chatId: sessionChatId,
        isGroup: false,
        senderId: adminChatId,
        config: agentConfig,
      };

      // Fire-and-forget: start the analysis in the background so the HTTP
      // response returns immediately.
      void deps.agent
        .processMessage({
          chatId: sessionChatId,
          userMessage: prompt,
          userName: "self-improve",
          timestamp: Date.now(),
          isGroup: false,
          toolContext,
        })
        .then(async (response) => {
          const content = response.content ?? "";
          if (content && deps.bridge?.isAvailable()) {
            await deps.bridge.sendMessage({
              chatId: String(adminChatId),
              text: `🔄 Self-Improve result:\n${content}`,
            });
          }
        })
        .catch(() => {
          // Errors are logged by the agent runtime itself
        });

      return c.json<APIResponse<{ message: string }>>({
        success: true,
        data: {
          message: `Analysis dispatched via ${cfg.selected_plugin}. Results will be sent to Telegram when complete.`,
        },
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // ── Plugin DB endpoints ─────────────────────────────────────────────────────

  // GET /api/self-improvement/status
  // Returns whether the self-improve-orchestrator plugin DB exists and basic stats.
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
