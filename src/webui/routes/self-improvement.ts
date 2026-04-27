import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");
const PLUGIN_DB_PATH = join(PLUGIN_DATA_DIR, "self-improve-orchestrator.db");
const NATIVE_ANALYSIS_TABLE = "self_improvement_analysis_log";
const NATIVE_TASKS_TABLE = "self_improvement_tasks";
const DEFAULT_ANALYSIS_BRANCH = "main";
const MAX_SUMMARY_LENGTH = 10_000;

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
  source?: "plugin" | "native";
  status?: "running" | "completed" | "failed";
  error?: string | null;
  completed_at?: number | null;
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
  source?: "plugin" | "native";
}

/** Open (read-only) the plugin SQLite DB if it exists. Returns null otherwise. */
function openPluginDb(): Database.Database | null {
  if (!existsSync(PLUGIN_DB_PATH)) return null;
  return new Database(PLUGIN_DB_PATH, { readonly: true });
}

function ensureNativeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${NATIVE_ANALYSIS_TABLE} (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       INTEGER NOT NULL,
      repo            TEXT    NOT NULL,
      branch          TEXT    NOT NULL DEFAULT '${DEFAULT_ANALYSIS_BRANCH}',
      executor_plugin TEXT    NOT NULL,
      files_analyzed  INTEGER NOT NULL DEFAULT 0,
      issues_found    INTEGER NOT NULL DEFAULT 0,
      issues_created  INTEGER NOT NULL DEFAULT 0,
      summary         TEXT,
      status          TEXT    NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'completed', 'failed')),
      error           TEXT,
      completed_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_self_improvement_analysis_timestamp
      ON ${NATIVE_ANALYSIS_TABLE}(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_self_improvement_analysis_status
      ON ${NATIVE_ANALYSIS_TABLE}(status);

    CREATE TABLE IF NOT EXISTS ${NATIVE_TASKS_TABLE} (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER REFERENCES ${NATIVE_ANALYSIS_TABLE}(id) ON DELETE CASCADE,
      task_type        TEXT    NOT NULL DEFAULT 'code_improvement',
      priority         TEXT    NOT NULL DEFAULT 'medium',
      file_path        TEXT,
      description      TEXT    NOT NULL,
      suggestion       TEXT,
      code_snippet     TEXT,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_at       INTEGER NOT NULL,
      github_issue_url TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_self_improvement_tasks_analysis
      ON ${NATIVE_TASKS_TABLE}(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_self_improvement_tasks_status
      ON ${NATIVE_TASKS_TABLE}(status, created_at DESC);
  `);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName)
  );
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function truncateSummary(value: string): string {
  return value.length > MAX_SUMMARY_LENGTH ? `${value.slice(0, MAX_SUMMARY_LENGTH)}...` : value;
}

function firstNumber(text: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function summarizeAgentResponse(response: {
  content?: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
}): {
  summary: string;
  filesAnalyzed: number;
  issuesFound: number;
  issuesCreated: number;
} {
  const content = (response.content ?? "").trim();
  const issueCreationToolCalls =
    response.toolCalls?.filter((toolCall) =>
      /github_create_(issue|pr)|create_issue_from_finding/i.test(toolCall.name)
    ).length ?? 0;

  return {
    summary: truncateSummary(content || "Analysis completed."),
    filesAnalyzed: firstNumber(content, [
      /(\d+)\s+(?:source\s+)?files?\s+(?:selected|analyzed|reviewed)/i,
      /analyz(?:ed|ing)\s+(\d+)\s+(?:source\s+)?files?/i,
    ]),
    issuesFound: firstNumber(content, [
      /found\s+(\d+)\s+(?:issues?|findings?|problems?|opportunities)/i,
      /(\d+)\s+(?:issues?|findings?|problems?|opportunities)\s+(?:found|identified|detected)/i,
    ]),
    issuesCreated: Math.max(
      firstNumber(content, [
        /created\s+(\d+)\s+(?:issues?|pull requests?|prs?)/i,
        /(\d+)\s+(?:issues?|pull requests?|prs?)\s+created/i,
      ]),
      issueCreationToolCalls
    ),
  };
}

function createNativeAnalysisRun(db: Database.Database, config: MetaOrchestratorConfig): number {
  ensureNativeTables(db);
  const now = Date.now();
  const repo = config.target_repo || "teleton-agent";
  const result = db
    .prepare(
      `INSERT INTO ${NATIVE_ANALYSIS_TABLE}
         (timestamp, repo, branch, executor_plugin, files_analyzed, issues_found, issues_created, summary, status)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'running')`
    )
    .run(
      now,
      repo,
      DEFAULT_ANALYSIS_BRANCH,
      config.selected_plugin,
      `Analysis dispatched via ${config.selected_plugin}.`
    );
  return Number(result.lastInsertRowid);
}

function completeNativeAnalysisRun(
  db: Database.Database,
  runId: number,
  response: {
    content?: string;
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  }
): void {
  ensureNativeTables(db);
  const summary = summarizeAgentResponse(response);
  db.prepare(
    `UPDATE ${NATIVE_ANALYSIS_TABLE}
     SET files_analyzed = ?,
         issues_found = ?,
         issues_created = ?,
         summary = ?,
         status = 'completed',
         error = NULL,
         completed_at = ?
     WHERE id = ?`
  ).run(
    summary.filesAnalyzed,
    summary.issuesFound,
    summary.issuesCreated,
    summary.summary,
    Date.now(),
    runId
  );
}

function failNativeAnalysisRun(db: Database.Database, runId: number, error: unknown): void {
  ensureNativeTables(db);
  const message = getErrorMessage(error);
  db.prepare(
    `UPDATE ${NATIVE_ANALYSIS_TABLE}
     SET summary = ?,
         status = 'failed',
         error = ?,
         completed_at = ?
     WHERE id = ?`
  ).run(truncateSummary(`Analysis failed: ${message}`), message, Date.now(), runId);
}

function readNativeStatus(db?: Database.Database): {
  analysis_count: number;
  pending_tasks: number;
  last_analysis: number | null;
} {
  if (!db) return { analysis_count: 0, pending_tasks: 0, last_analysis: null };
  ensureNativeTables(db);

  const analysisCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM ${NATIVE_ANALYSIS_TABLE}`).get() as { cnt: number }
  ).cnt;
  const pendingCount = (
    db
      .prepare(`SELECT COUNT(*) as cnt FROM ${NATIVE_TASKS_TABLE} WHERE status = 'pending'`)
      .get() as { cnt: number }
  ).cnt;
  const lastAnalysis =
    (
      db
        .prepare(`SELECT timestamp FROM ${NATIVE_ANALYSIS_TABLE} ORDER BY timestamp DESC LIMIT 1`)
        .get() as { timestamp: number } | undefined
    )?.timestamp ?? null;

  return {
    analysis_count: analysisCount,
    pending_tasks: pendingCount,
    last_analysis: lastAnalysis,
  };
}

function readNativeAnalysis(db: Database.Database | undefined, limit: number): AnalysisLogEntry[] {
  if (!db) return [];
  ensureNativeTables(db);
  const rows = db
    .prepare(`SELECT * FROM ${NATIVE_ANALYSIS_TABLE} ORDER BY timestamp DESC LIMIT ?`)
    .all(limit) as AnalysisLogEntry[];
  return rows.map((row) => ({ ...row, source: "native" }));
}

function readNativeTasks(
  db: Database.Database | undefined,
  status: string,
  limit: number
): ImprovementTask[] {
  if (!db) return [];
  ensureNativeTables(db);
  const rows =
    status === "all"
      ? (db
          .prepare(`SELECT * FROM ${NATIVE_TASKS_TABLE} ORDER BY created_at DESC LIMIT ?`)
          .all(limit) as ImprovementTask[])
      : (db
          .prepare(
            `SELECT * FROM ${NATIVE_TASKS_TABLE} WHERE status = ? ORDER BY created_at DESC LIMIT ?`
          )
          .all(status, limit) as ImprovementTask[]);
  return rows.map((row) => ({ ...row, source: "native" }));
}

function readPluginStatus(): {
  installed: boolean;
  analysis_count: number;
  pending_tasks: number;
  last_analysis: number | null;
} {
  const installed = existsSync(PLUGIN_DB_PATH);
  if (!installed) {
    return { installed: false, analysis_count: 0, pending_tasks: 0, last_analysis: null };
  }

  let db: Database.Database | null = null;
  try {
    db = openPluginDb();
    if (!db) return { installed: false, analysis_count: 0, pending_tasks: 0, last_analysis: null };

    const analysisCount = tableExists(db, "analysis_log")
      ? (db.prepare(`SELECT COUNT(*) as cnt FROM analysis_log`).get() as { cnt: number }).cnt
      : 0;

    const pendingCount = tableExists(db, "improvement_tasks")
      ? (
          db
            .prepare(`SELECT COUNT(*) as cnt FROM improvement_tasks WHERE status = 'pending'`)
            .get() as { cnt: number }
        ).cnt
      : 0;

    const lastAnalysis = tableExists(db, "analysis_log")
      ? ((
          db.prepare(`SELECT timestamp FROM analysis_log ORDER BY timestamp DESC LIMIT 1`).get() as
            | { timestamp: number }
            | undefined
        )?.timestamp ?? null)
      : null;

    return {
      installed: true,
      analysis_count: analysisCount,
      pending_tasks: pendingCount,
      last_analysis: lastAnalysis,
    };
  } finally {
    db?.close();
  }
}

function readPluginAnalysis(limit: number): AnalysisLogEntry[] {
  let db: Database.Database | null = null;
  try {
    db = openPluginDb();
    if (!db || !tableExists(db, "analysis_log")) return [];
    const rows = db
      .prepare(`SELECT * FROM analysis_log ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as AnalysisLogEntry[];
    return rows.map((row) => ({ ...row, source: "plugin" }));
  } finally {
    db?.close();
  }
}

function readPluginTasks(status: string, limit: number): ImprovementTask[] {
  let db: Database.Database | null = null;
  try {
    db = openPluginDb();
    if (!db || !tableExists(db, "improvement_tasks")) return [];
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
    return rows.map((row) => ({ ...row, source: "plugin" }));
  } finally {
    db?.close();
  }
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
      const nativeRunId = createNativeAnalysisRun(deps.memory.db, cfg);
      const toolContext = {
        bridge: deps.bridge,
        db: deps.memory.db,
        chatId: sessionChatId,
        isGroup: false,
        senderId: adminChatId,
        config: agentConfig,
      };

      // Fire-and-forget: start the analysis in the background so the HTTP
      // response returns immediately.
      void Promise.resolve()
        .then(() =>
          deps.agent.processMessage({
            chatId: sessionChatId,
            userMessage: prompt,
            userName: "self-improve",
            timestamp: Date.now(),
            isGroup: false,
            toolContext,
          })
        )
        .then(async (response) => {
          completeNativeAnalysisRun(deps.memory.db, nativeRunId, response);
          const content = response.content ?? "";
          if (content && deps.bridge?.isAvailable()) {
            await deps.bridge.sendMessage({
              chatId: String(adminChatId),
              text: `🔄 Self-Improve result:\n${content}`,
            });
          }
        })
        .catch((error) => {
          failNativeAnalysisRun(deps.memory.db, nativeRunId, error);
          // Errors are logged by the agent runtime itself.
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

  // ── Self-improvement data endpoints ─────────────────────────────────────────

  // GET /api/self-improvement/status
  // Returns whether self-improvement data exists and basic stats.
  app.get("/status", (c) => {
    try {
      const pluginStatus = readPluginStatus();
      const nativeStatus = readNativeStatus(deps?.memory?.db);
      const analysisCount = pluginStatus.analysis_count + nativeStatus.analysis_count;
      const pendingCount = pluginStatus.pending_tasks + nativeStatus.pending_tasks;
      const lastAnalysis = Math.max(
        pluginStatus.last_analysis ?? 0,
        nativeStatus.last_analysis ?? 0
      );
      const source =
        pluginStatus.installed && nativeStatus.analysis_count > 0
          ? "mixed"
          : pluginStatus.installed
            ? "plugin"
            : nativeStatus.analysis_count > 0
              ? "native"
              : "none";

      return c.json<
        APIResponse<{
          installed: boolean;
          plugin_installed: boolean;
          source: "plugin" | "native" | "mixed" | "none";
          analysis_count: number;
          pending_tasks: number;
          last_analysis: number | null;
        }>
      >({
        success: true,
        data: {
          installed: pluginStatus.installed || analysisCount > 0 || pendingCount > 0,
          plugin_installed: pluginStatus.installed,
          source,
          analysis_count: analysisCount,
          pending_tasks: pendingCount,
          last_analysis: lastAnalysis || null,
        },
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/self-improvement/analysis?limit=10
  app.get("/analysis", (c) => {
    try {
      const limit = parseLimit(c.req.query("limit"), 20, 100);
      const rows = [...readPluginAnalysis(limit), ...readNativeAnalysis(deps?.memory?.db, limit)]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      return c.json<APIResponse<AnalysisLogEntry[]>>({ success: true, data: rows });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/self-improvement/tasks?status=pending&limit=20
  app.get("/tasks", (c) => {
    try {
      const status = c.req.query("status") ?? "all";
      const limit = parseLimit(c.req.query("limit"), 50, 200);
      const rows = [
        ...readPluginTasks(status, limit),
        ...readNativeTasks(deps?.memory?.db, status, limit),
      ]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);

      return c.json<APIResponse<ImprovementTask[]>>({ success: true, data: rows });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
