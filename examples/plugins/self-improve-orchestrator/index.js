/**
 * self-improve-orchestrator plugin for Teleton Agent
 *
 * A meta-orchestrator that uses an existing plugin (e.g. github-dev-assistant)
 * to analyze the teleton-agent codebase and optionally create GitHub issues.
 * Instead of making GitHub API calls directly, it delegates all GitHub operations
 * to the configured executor plugin via sdk.tools.call().
 *
 * The orchestrator also fetches the executor plugin's GUIDE.md (from a URL you
 * configure in the WebUI Settings tab) and injects it as context into the LLM
 * analysis prompt so the model knows the full capabilities of the chosen plugin.
 *
 * Place this directory in ~/.teleton/plugins/ to install.
 */

// ── Manifest ─────────────────────────────────────────────────────────────────

export const manifest = {
  name: "self-improve-orchestrator",
  version: "1.0.0",
  description:
    "Meta-orchestrator: performs autonomous self-improvement by delegating GitHub tasks to a selected executor plugin (e.g. github-dev-assistant)",
  sdkVersion: ">=1.0.0",
  // No secrets — delegates to the executor plugin which already holds credentials
  secrets: {},
  dependencies: ["github-dev-assistant"],
  defaultConfig: {
    executor_plugin: "github-dev-assistant",
    guide_url:
      "https://github.com/xlabtg/teleton-plugins/blob/main/plugins/github-dev-assistant/GUIDE.md",
    repo: "xlabtg/teleton-agent",
    branch: "main",
    focus_areas: ["security", "performance", "readability", "tests", "docs"],
    analysis_interval_hours: 24,
    require_approval: true,
    max_files_per_analysis: 50,
    exclude_paths: ["node_modules/", "dist/", ".test.", ".spec."],
  },
};

// ── Database schema ──────────────────────────────────────────────────────────

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp      INTEGER NOT NULL,
      repo           TEXT    NOT NULL,
      branch         TEXT    NOT NULL DEFAULT 'main',
      executor_plugin TEXT   NOT NULL DEFAULT 'github-dev-assistant',
      files_analyzed INTEGER NOT NULL DEFAULT 0,
      issues_found   INTEGER NOT NULL DEFAULT 0,
      issues_created INTEGER NOT NULL DEFAULT 0,
      summary        TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS improvement_tasks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER REFERENCES analysis_log(id),
      task_type        TEXT    NOT NULL DEFAULT 'code_improvement',
      priority         TEXT    NOT NULL DEFAULT 'medium',
      file_path        TEXT,
      description      TEXT    NOT NULL,
      suggestion       TEXT,
      code_snippet     TEXT,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_at       INTEGER NOT NULL,
      github_issue_url TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestrator_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a GitHub blob URL to its raw equivalent for fetching. */
function toRawUrl(url) {
  if (!url) return null;
  // Already raw
  if (url.includes("raw.githubusercontent.com")) return url;
  // github.com/user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
  return url
    .replace("https://github.com/", "https://raw.githubusercontent.com/")
    .replace("/blob/", "/");
}

/** Fetch the guide content from a URL (supports GitHub blob URLs). */
async function fetchGuide(url) {
  const rawUrl = toRawUrl(url);
  if (!rawUrl) return "";
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    return ""; // Guide unavailable; proceed without it
  }
}

/** Load orchestrator settings from DB, merged with defaults. */
function loadSettings(db, defaultConfig) {
  const defaults = {
    executor_plugin: defaultConfig?.executor_plugin ?? "github-dev-assistant",
    guide_url: defaultConfig?.guide_url ?? "",
    repo: defaultConfig?.repo ?? "xlabtg/teleton-agent",
    branch: defaultConfig?.branch ?? "main",
    focus_areas: defaultConfig?.focus_areas ?? ["security", "performance", "readability"],
    analysis_interval_hours: defaultConfig?.analysis_interval_hours ?? 24,
    require_approval: defaultConfig?.require_approval !== false,
    max_files_per_analysis: defaultConfig?.max_files_per_analysis ?? 50,
    exclude_paths: defaultConfig?.exclude_paths ?? ["node_modules/", "dist/", ".test.", ".spec."],
  };
  if (!db) return defaults;
  try {
    const rows = db.prepare("SELECT key, value FROM orchestrator_settings").all();
    const saved = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const tools = (sdk) => [
  // ── 1. run_self_improvement ────────────────────────────────────────────────
  {
    name: "run_self_improvement",
    description:
      "Run a full self-improvement cycle: fetch the repo tree via the executor plugin, analyze code with LLM (injecting the guide as context), persist findings, and optionally create GitHub issues.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "GitHub repo (owner/repo). Defaults to configured repo.",
        },
        branch: {
          type: "string",
          description: "Branch to analyze. Defaults to configured branch.",
        },
        focus_areas: {
          type: "array",
          items: {
            type: "string",
            enum: ["security", "performance", "readability", "tests", "docs"],
          },
          description: "Focus areas for the analysis.",
        },
        executor_plugin: {
          type: "string",
          description: "Plugin to delegate GitHub operations to. Defaults to configured executor.",
        },
      },
      required: [],
    },
    scope: "admin-only",
    category: "action",
    async execute(params, context) {
      try {
        const settings = loadSettings(sdk.db, sdk.pluginConfig);
        const repo = params.repo ?? settings.repo;
        const branch = params.branch ?? settings.branch;
        const focus = params.focus_areas ?? settings.focus_areas;
        const executorPlugin = params.executor_plugin ?? settings.executor_plugin;
        const [owner, repoName] = repo.split("/");

        sdk.log.info(
          `[self-improve-orchestrator] Starting analysis: ${repo}@${branch} via ${executorPlugin}`
        );

        // ── Step 1: Fetch guide content for LLM context ──────────────────
        let guideContext = "";
        if (settings.guide_url) {
          sdk.log.info(`[self-improve-orchestrator] Fetching guide from ${settings.guide_url}`);
          const raw = await fetchGuide(settings.guide_url);
          if (raw) {
            // Truncate to 4000 chars to stay within context budget
            guideContext = `\n\n## Plugin Guide (${executorPlugin})\n\n${raw.slice(0, 4000)}\n`;
          }
        }

        // ── Step 2: Get repo tree via executor plugin ────────────────────
        let treeFiles = [];
        if (sdk.tools) {
          sdk.log.info("[self-improve-orchestrator] Fetching repo tree via sdk.tools.call()");
          const treeResult = await sdk.tools.call("github_get_repo_tree", {
            owner,
            repo: repoName,
            ref: branch,
            recursive: true,
          });
          if (treeResult?.success && Array.isArray(treeResult.data?.tree)) {
            treeFiles = treeResult.data.tree;
          } else if (Array.isArray(treeResult?.data)) {
            treeFiles = treeResult.data;
          }
        } else {
          sdk.log.warn(
            "[self-improve-orchestrator] sdk.tools not available; skipping tree fetch"
          );
        }

        // ── Step 3: Filter relevant source files ─────────────────────────
        const excluded = settings.exclude_paths ?? [];
        const analyzableExts = [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"];

        const sourceFiles = treeFiles
          .filter(
            (f) =>
              f.type === "blob" &&
              analyzableExts.some((ext) => f.path.endsWith(ext)) &&
              !excluded.some((ex) => f.path.includes(ex.replace("*", "")))
          )
          .slice(0, settings.max_files_per_analysis ?? 50);

        sdk.log.info(
          `[self-improve-orchestrator] ${sourceFiles.length} files selected for analysis`
        );

        // ── Step 4: Build LLM analysis prompt with guide injected ─────────
        const focusStr = focus.join(", ");
        const fileList = sourceFiles.map((f) => `  ${f.path}`).join("\n");

        const prompt = [
          `You are a senior code reviewer analyzing the ${repo} repository on branch "${branch}".`,
          `Focus: ${focusStr}.`,
          guideContext,
          ``,
          `Source files (${sourceFiles.length}):`,
          fileList,
          ``,
          `Return a JSON object:`,
          `{`,
          `  "findings": [`,
          `    {`,
          `      "file": "path/to/file",`,
          `      "severity": "low|medium|high|critical",`,
          `      "category": "bug|security|performance|readability|test|docs",`,
          `      "description": "Brief, specific description",`,
          `      "suggestion": "Actionable fix suggestion",`,
          `      "code_snippet": "Optional example snippet"`,
          `    }`,
          `  ],`,
          `  "summary": "One-paragraph overall assessment"`,
          `}`,
          ``,
          `If no issues found, return empty findings array and a positive summary.`,
        ].join("\n");

        // ── Step 5: LLM analysis ──────────────────────────────────────────
        let analysis = {
          findings: [],
          summary: `Analyzed ${sourceFiles.length} files in ${repo}@${branch}.`,
        };
        if (typeof sdk.llm?.analyze === "function") {
          analysis = await sdk.llm.analyze(prompt, {
            model: context?.config?.agent?.utility_model,
            format: "json",
          });
        }
        // When the plugin is called by the agent LLM directly, the LLM provides
        // the analysis itself — return the file list for context.
        if (!Array.isArray(analysis?.findings)) {
          analysis = {
            findings: [],
            summary: `Tree fetched: ${sourceFiles.length} files. Ask the agent to review.`,
          };
        }

        // ── Step 6: Persist analysis ──────────────────────────────────────
        let analysisId = null;
        if (sdk.db) {
          const logStmt = sdk.db.prepare(
            `INSERT INTO analysis_log
               (timestamp, repo, branch, executor_plugin, files_analyzed, issues_found, summary)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          const logResult = logStmt.run(
            Date.now(),
            repo,
            branch,
            executorPlugin,
            sourceFiles.length,
            analysis.findings.length,
            analysis.summary
          );
          analysisId = logResult.lastInsertRowid;

          const taskStmt = sdk.db.prepare(
            `INSERT INTO improvement_tasks
               (analysis_id, priority, file_path, description, suggestion, code_snippet, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          for (const f of analysis.findings) {
            taskStmt.run(
              analysisId,
              f.severity ?? "medium",
              f.file ?? "",
              f.description ?? "",
              f.suggestion ?? "",
              f.code_snippet ?? null,
              Date.now()
            );
          }
        }

        // ── Step 7: Auto-create issues if approval not required ───────────
        let issuesCreated = 0;
        if (!settings.require_approval && sdk.tools && analysis.findings.length > 0) {
          for (const finding of analysis.findings.filter(
            (f) => f.severity === "critical" || f.severity === "high"
          )) {
            const issueResult = await sdk.tools.call("github_create_issue", {
              owner,
              repo: repoName,
              title: `[${(finding.severity ?? "medium").toUpperCase()}] ${finding.file}: ${(finding.description ?? "").slice(0, 60)}`,
              body: buildIssueBody(finding, executorPlugin),
              labels: ["ai-suggested", "code-quality"],
            });
            if (issueResult?.success) {
              issuesCreated++;
              sdk.log.info(
                `[self-improve-orchestrator] Created issue: ${issueResult.data?.html_url}`
              );
            }
          }

          if (sdk.db && issuesCreated > 0) {
            sdk.db
              .prepare(`UPDATE analysis_log SET issues_created = ? WHERE id = ?`)
              .run(issuesCreated, analysisId);
          }
        }

        return {
          success: true,
          data: {
            analysis_id: analysisId,
            repo,
            branch,
            executor_plugin: executorPlugin,
            files_analyzed: sourceFiles.length,
            findings: analysis.findings,
            summary: analysis.summary,
            issues_created: issuesCreated,
            next_steps:
              analysis.findings.length > 0
                ? settings.require_approval
                  ? "Use create_issue_from_finding to create GitHub issues for important findings."
                  : `Auto-created ${issuesCreated} issue(s) for critical/high findings.`
                : "No significant issues found. Codebase looks healthy!",
          },
        };
      } catch (error) {
        sdk.log.error(`[self-improve-orchestrator] run_self_improvement failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  },

  // ── 2. create_issue_from_finding ─────────────────────────────────────────
  {
    name: "create_issue_from_finding",
    description:
      "Create a GitHub issue from a specific analysis finding by delegating to the configured executor plugin.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/repo" },
        title: { type: "string", description: "Issue title" },
        task_id: {
          type: "number",
          description: "improvement_tasks.id to mark as created after issue is opened",
        },
        finding: {
          type: "object",
          description: "Finding from run_self_improvement",
          properties: {
            file: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            category: { type: "string" },
            description: { type: "string" },
            suggestion: { type: "string" },
            code_snippet: { type: "string" },
          },
          required: ["description", "suggestion"],
        },
        labels: {
          type: "array",
          items: { type: "string" },
          default: ["enhancement", "ai-suggested"],
        },
      },
      required: ["title", "finding"],
    },
    scope: "admin-only",
    category: "action",
    async execute(params) {
      try {
        const settings = loadSettings(sdk.db, sdk.pluginConfig);
        const repo = params.repo ?? settings.repo;
        const [owner, repoName] = repo.split("/");
        const { finding } = params;
        const executorPlugin = settings.executor_plugin;

        if (!sdk.tools) {
          return {
            success: false,
            error: "sdk.tools not available. Ensure the runtime supports cross-plugin tool calls.",
          };
        }

        const result = await sdk.tools.call("github_create_issue", {
          owner,
          repo: repoName,
          title: params.title,
          body: buildIssueBody(finding, executorPlugin),
          labels: [...new Set([...(params.labels ?? []), "ai-suggested"])],
        });

        // Update task record status
        if (result?.success && params.task_id && sdk.db) {
          sdk.db
            .prepare(
              `UPDATE improvement_tasks SET status = 'created', github_issue_url = ? WHERE id = ?`
            )
            .run(result.data?.html_url ?? "", params.task_id);
        }

        return result ?? { success: false, error: "No result from executor plugin" };
      } catch (error) {
        sdk.log.error(`[self-improve-orchestrator] create_issue_from_finding: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  },

  // ── 3. save_orchestrator_settings ────────────────────────────────────────
  {
    name: "save_orchestrator_settings",
    description: "Persist orchestrator settings (executor plugin, guide URL, repo, etc.)",
    parameters: {
      type: "object",
      properties: {
        executor_plugin: {
          type: "string",
          description: "Plugin to use for GitHub operations (e.g. 'github-dev-assistant')",
        },
        guide_url: {
          type: "string",
          description: "URL to the executor plugin's GUIDE.md for LLM context injection",
        },
        repo: { type: "string", description: "Target repo (owner/repo)" },
        branch: { type: "string", description: "Branch to analyze" },
        focus_areas: {
          type: "array",
          items: { type: "string" },
          description: "Analysis focus areas",
        },
        analysis_interval_hours: {
          type: "number",
          minimum: 1,
          maximum: 168,
          description: "Hours between autonomous analysis runs",
        },
        require_approval: {
          type: "boolean",
          description: "Require user approval before creating GitHub issues",
        },
      },
    },
    scope: "admin-only",
    execute(params) {
      try {
        if (!sdk.db) return { success: false, error: "DB not available" };
        const allowed = [
          "executor_plugin",
          "guide_url",
          "repo",
          "branch",
          "focus_areas",
          "analysis_interval_hours",
          "require_approval",
        ];
        const stmt = sdk.db.prepare(
          `INSERT OR REPLACE INTO orchestrator_settings (key, value) VALUES (?, ?)`
        );
        for (const [k, v] of Object.entries(params)) {
          if (allowed.includes(k)) {
            stmt.run(k, JSON.stringify(v));
          }
        }
        return { success: true, data: { message: "Settings saved." } };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  },

  // ── 4. get_orchestrator_settings ─────────────────────────────────────────
  {
    name: "get_orchestrator_settings",
    description: "Get current orchestrator settings.",
    parameters: { type: "object", properties: {} },
    scope: "admin-only",
    execute() {
      try {
        return {
          success: true,
          data: loadSettings(sdk.db, sdk.pluginConfig),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  },

  // ── 5. list_analysis_history ──────────────────────────────────────────────
  {
    name: "list_analysis_history",
    description: "List previous self-improvement analysis runs.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
    },
    scope: "admin-only",
    category: "read",
    execute(params) {
      try {
        if (!sdk.db) return { success: true, data: [] };
        const limit = Math.min(params?.limit ?? 10, 100);
        const rows = sdk.db
          .prepare(`SELECT * FROM analysis_log ORDER BY timestamp DESC LIMIT ?`)
          .all(limit);
        return { success: true, data: rows };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  },

  // ── 6. list_improvement_tasks ─────────────────────────────────────────────
  {
    name: "list_improvement_tasks",
    description: "List improvement tasks from analysis, optionally filtered by status.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "created", "dismissed", "all"],
          default: "pending",
        },
        limit: { type: "number", default: 20 },
      },
    },
    scope: "admin-only",
    category: "read",
    execute(params) {
      try {
        if (!sdk.db) return { success: true, data: [] };
        const status = params?.status ?? "pending";
        const limit = Math.min(params?.limit ?? 20, 200);
        const rows =
          status === "all"
            ? sdk.db
                .prepare(`SELECT * FROM improvement_tasks ORDER BY created_at DESC LIMIT ?`)
                .all(limit)
            : sdk.db
                .prepare(
                  `SELECT * FROM improvement_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`
                )
                .all(status, limit);
        return { success: true, data: rows };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  },
];

// ── Issue body builder ────────────────────────────────────────────────────────

function buildIssueBody(finding, executorPlugin) {
  return [
    `## 🤖 AI Code Analysis Finding`,
    ``,
    finding.file ? `**File**: \`${finding.file}\`` : null,
    finding.severity ? `**Severity**: ${finding.severity}` : null,
    finding.category ? `**Category**: \`${finding.category}\`` : null,
    ``,
    `### Problem`,
    finding.description,
    ``,
    `### Suggested Fix`,
    finding.suggestion,
    finding.code_snippet
      ? [
          ``,
          `### Example`,
          "```javascript",
          finding.code_snippet,
          "```",
        ].join("\n")
      : null,
    ``,
    `---`,
    `*Generated by [self-improve-orchestrator](https://github.com/xlabtg/teleton-agent) via ${executorPlugin}.*`,
    `*To disable: set \`require_approval: true\` in the orchestrator settings or run \`save_orchestrator_settings\`.*`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** Called once when the plugin is loaded. Starts autonomous analysis loop if enabled. */
export async function start(ctx) {
  const settings = loadSettings(ctx.sdk?.db, ctx.sdk?.pluginConfig);
  const autoConfig = ctx.sdk?.storage?.get("autonomous_config") ?? {};

  const intervalHours = autoConfig.interval_hours ?? settings.analysis_interval_hours ?? 24;
  const enabled = autoConfig.enabled ?? false;

  if (!enabled) return;

  ctx.sdk?.log?.info(
    `[self-improve-orchestrator] Autonomous analysis every ${intervalHours}h`
  );

  const run = async () => {
    try {
      const adminId = ctx.config?.telegram?.admin_ids?.[0];
      if (!adminId) return;

      const toolDefs = tools(ctx.sdk);
      const runTool = toolDefs.find((t) => t.name === "run_self_improvement");
      if (!runTool) return;

      const result = await runTool.execute({}, { config: ctx.config });

      if (result.success && result.data?.findings?.length > 0 && ctx.sdk?.telegram?.isAvailable?.()) {
        const top3 = result.data.findings.slice(0, 3);
        const msg =
          `🔄 *Self-Improvement Analysis* found ${result.data.findings.length} potential issue(s):\n\n` +
          top3
            .map(
              (f) =>
                `• *${(f.severity ?? "medium").toUpperCase()}* in \`${f.file}\`: ${f.description}`
            )
            .join("\n") +
          `\n\nRun \`run_self_improvement\` for the full report.`;

        await ctx.sdk.telegram.sendMessage(String(adminId), msg);
      }
    } catch (err) {
      ctx.sdk?.log?.error(`[self-improve-orchestrator] Autonomous run error: ${err.message}`);
    }
  };

  if (typeof ctx.scheduler?.every === "function") {
    ctx.scheduler.every(intervalHours, "hours", run);
  } else {
    const timerId = setInterval(run, intervalHours * 3_600_000);
    globalThis.__selfImproveOrchestratorTimer = timerId;
  }
}

/** Called when the plugin is stopped (hot-reload or shutdown). */
export async function stop() {
  if (globalThis.__selfImproveOrchestratorTimer) {
    clearInterval(globalThis.__selfImproveOrchestratorTimer);
    delete globalThis.__selfImproveOrchestratorTimer;
  }
}
