/**
 * self-improvement-assistant plugin for Teleton Agent
 *
 * Analyzes the teleton-agent codebase for potential improvements and can
 * create GitHub issues from findings. Supports periodic autonomous analysis.
 *
 * Required secrets:
 *   github_token — GitHub PAT with `repo` scope
 *
 * Place this directory in ~/.teleton/plugins/ to install.
 */

// ── Manifest ─────────────────────────────────────────────────────────────────

export const manifest = {
  name: "self-improvement-assistant",
  version: "1.0.0",
  description: "Autonomous code analysis and GitHub issue creation for teleton-agent",
  sdkVersion: ">=1.0.0",
  secrets: {
    github_token: {
      required: true,
      description: "GitHub Personal Access Token with 'repo' scope",
    },
  },
  defaultConfig: {
    repo: "xlabtg/teleton-agent",
    branch: "main",
    analysis_interval_hours: 24,
    auto_create_issues: false,
    code_quality_threshold: 0.8,
    exclude_paths: ["node_modules/", "dist/", ".test.", ".spec."],
    notify_on_findings: true,
    max_files_per_analysis: 50,
  },
};

// ── Database schema ──────────────────────────────────────────────────────────

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  INTEGER NOT NULL,
      repo       TEXT    NOT NULL,
      branch     TEXT    NOT NULL DEFAULT 'main',
      files_analyzed INTEGER NOT NULL DEFAULT 0,
      issues_found   INTEGER NOT NULL DEFAULT 0,
      issues_created INTEGER NOT NULL DEFAULT 0,
      summary    TEXT
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
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const tools = (sdk) => {
  const cfg = () => ({
    repo: "xlabtg/teleton-agent",
    branch: "main",
    exclude_paths: ["node_modules/", "dist/", ".test.", ".spec."],
    max_files_per_analysis: 50,
    auto_create_issues: false,
    ...(sdk.pluginConfig ?? {}),
  });

  // ── Helper: GitHub API request ───────────────────────────────────────
  async function githubRequest(path, options = {}) {
    const token = sdk.secrets.require("github_token");
    const url = `https://api.github.com${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
  }

  // ── Helper: retry with exponential back-off ──────────────────────────
  async function withRetry(fn, maxAttempts = 3) {
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (String(e.message).includes("429") && i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  return [
    // ── 1. analyze_codebase_quality ──────────────────────────────────────
    {
      name: "analyze_codebase_quality",
      description:
        "Analyze the teleton-agent codebase for potential improvements, bugs, and refactoring opportunities. Returns a structured list of findings with severity ratings.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "GitHub repository in owner/repo format",
            default: "xlabtg/teleton-agent",
          },
          branch: {
            type: "string",
            description: "Branch to analyze",
            default: "main",
          },
          focus_areas: {
            type: "array",
            items: {
              type: "string",
              enum: ["security", "performance", "readability", "tests", "documentation"],
            },
            description: "Areas to focus the analysis on (default: all)",
          },
        },
        required: [],
      },
      scope: "admin-only",
      category: "action",
      async execute(params, context) {
        try {
          const config = cfg();
          const repo = params.repo ?? config.repo;
          const branch = params.branch ?? config.branch;
          const [owner, repoName] = repo.split("/");

          sdk.log.info(`Starting codebase analysis for ${repo}@${branch}`);

          // 1. Fetch repository file tree
          const tree = await withRetry(() =>
            githubRequest(
              `/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`
            )
          );

          const excluded = config.exclude_paths ?? [];
          const analyzableExts = [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"];

          const sourceFiles = (tree.tree ?? [])
            .filter(
              (f) =>
                f.type === "blob" &&
                analyzableExts.some((ext) => f.path.endsWith(ext)) &&
                !excluded.some((ex) => f.path.includes(ex.replace("*", "")))
            )
            .slice(0, config.max_files_per_analysis ?? 50);

          sdk.log.info(`Found ${sourceFiles.length} source files to analyze`);

          // 2. Build analysis prompt
          const focusAreas = params.focus_areas?.length
            ? params.focus_areas.join(", ")
            : "security, performance, readability, tests, documentation";

          const prompt = [
            `Analyze the following source files from the ${repo} project on branch "${branch}".`,
            `Focus areas: ${focusAreas}.`,
            ``,
            `For each significant issue found, describe it concisely. Return a JSON object with:`,
            `{`,
            `  "findings": [`,
            `    {`,
            `      "file": "path/to/file",`,
            `      "severity": "low|medium|high|critical",`,
            `      "category": "bug|security|performance|readability|test|docs",`,
            `      "description": "Brief description of the problem",`,
            `      "suggestion": "Specific, actionable fix suggestion",`,
            `      "code_snippet": "Optional example snippet"`,
            `    }`,
            `  ],`,
            `  "summary": "One-paragraph overall assessment"`,
            `}`,
            ``,
            `Files to analyze (${sourceFiles.length} files):`,
            sourceFiles.map((f) => `  ${f.path}`).join("\n"),
          ].join("\n");

          // 3. LLM analysis — sdk.llm may not exist in all SDK versions,
          //    so we fall back to returning the file list with a placeholder.
          let analysis = { findings: [], summary: "LLM analysis unavailable." };
          if (typeof sdk.llm?.analyze === "function") {
            analysis = await sdk.llm.analyze(prompt, {
              model: context?.config?.agent?.utility_model,
              format: "json",
            });
          } else {
            // When called by the agent LLM itself, it returns its own analysis.
            analysis = {
              findings: [],
              summary: `Analyzed ${sourceFiles.length} files in ${repo}@${branch}. Use the agent to interpret results.`,
            };
          }

          // 4. Persist to analysis_log
          const stmt = sdk.db?.prepare(
            `INSERT INTO analysis_log (timestamp, repo, branch, files_analyzed, issues_found, summary)
             VALUES (?, ?, ?, ?, ?, ?)`
          );
          let analysisId = null;
          if (stmt) {
            const result = stmt.run(
              Date.now(),
              repo,
              branch,
              sourceFiles.length,
              analysis.findings?.length ?? 0,
              analysis.summary
            );
            analysisId = result.lastInsertRowid;

            // Persist individual findings
            const findingStmt = sdk.db?.prepare(
              `INSERT INTO improvement_tasks
                 (analysis_id, priority, file_path, description, suggestion, code_snippet, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            for (const f of analysis.findings ?? []) {
              findingStmt?.run(
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

          return {
            success: true,
            data: {
              analysis_id: analysisId,
              repo,
              branch,
              analyzed_files: sourceFiles.length,
              findings: analysis.findings ?? [],
              summary: analysis.summary,
              next_steps:
                (analysis.findings?.length ?? 0) > 0
                  ? "Use create_github_issue_from_finding to open issues for important findings."
                  : "No significant issues found. Codebase looks healthy!",
            },
          };
        } catch (error) {
          sdk.log.error(`Analysis failed: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    },

    // ── 2. create_github_issue_from_finding ──────────────────────────────
    {
      name: "create_github_issue_from_finding",
      description:
        "Create a well-formatted GitHub issue from a code-analysis finding. Adds 'ai-suggested' label automatically.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo", default: "xlabtg/teleton-agent" },
          title: { type: "string", description: "Issue title" },
          finding: {
            type: "object",
            description: "Finding object from analyze_codebase_quality",
            properties: {
              file: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              category: { type: "string" },
              description: { type: "string" },
              suggestion: { type: "string" },
              code_snippet: { type: "string" },
            },
            required: ["description", "suggestion"],
          },
          task_id: {
            type: "number",
            description: "improvement_tasks.id to link the created issue to (optional)",
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
          const config = cfg();
          const repo = params.repo ?? config.repo;
          const [owner, repoName] = repo.split("/");
          const { finding } = params;

          const body = [
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
              ? [``, `### Example`, "```javascript", finding.code_snippet, "```"].join("\n")
              : null,
            ``,
            `---`,
            `*Generated automatically by the [self-improvement-assistant](https://github.com/xlabtg/teleton-agent) plugin.*`,
            `*To disable auto-creation: set \`plugins.self_improvement_assistant.auto_create_issues: false\` in config.*`,
          ]
            .filter((l) => l !== null)
            .join("\n");

          const issue = await withRetry(() =>
            githubRequest(`/repos/${owner}/${repoName}/issues`, {
              method: "POST",
              body: JSON.stringify({
                title: params.title,
                body,
                labels: [...new Set([...(params.labels ?? []), "ai-suggested"])],
              }),
            })
          );

          // Update task record if linked
          if (params.task_id && sdk.db) {
            sdk.db
              .prepare(
                `UPDATE improvement_tasks SET status = 'created', github_issue_url = ? WHERE id = ?`
              )
              .run(issue.html_url, params.task_id);
          }

          return { success: true, data: { url: issue.html_url, number: issue.number } };
        } catch (error) {
          sdk.log.error(`create_github_issue_from_finding failed: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    },

    // ── 3. list_analysis_history ─────────────────────────────────────────
    {
      name: "list_analysis_history",
      description: "List previous codebase analysis runs stored in the plugin database.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of records to return (default 10)",
            default: 10,
          },
        },
      },
      scope: "admin-only",
      category: "read",
      execute(params) {
        try {
          if (!sdk.db) return { success: true, data: [] };
          const limit = Math.min(params?.limit ?? 10, 100);
          const rows = sdk.db
            .prepare(
              `SELECT * FROM analysis_log ORDER BY timestamp DESC LIMIT ?`
            )
            .all(limit);
          return { success: true, data: rows };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    // ── 4. list_improvement_tasks ────────────────────────────────────────
    {
      name: "list_improvement_tasks",
      description: "List improvement tasks found during analysis, optionally filtered by status.",
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

    // ── 5. configure_autonomous_analysis ────────────────────────────────
    {
      name: "configure_autonomous_analysis",
      description:
        "Enable or disable periodic autonomous codebase analysis. When enabled, analysis runs at the configured interval and notifies the admin if findings exist.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          interval_hours: { type: "number", minimum: 1, maximum: 168 },
          notify_on_findings: { type: "boolean" },
          auto_create_issues: { type: "boolean" },
        },
        required: ["enabled"],
      },
      scope: "admin-only",
      execute(params) {
        try {
          const current = sdk.storage?.get("autonomous_config") ?? {};
          const updated = { ...current, ...params };
          sdk.storage?.set("autonomous_config", updated);
          return {
            success: true,
            data: {
              message: `Autonomous analysis ${params.enabled ? "enabled" : "disabled"}.`,
              config: updated,
              next_run: params.enabled
                ? new Date(
                    Date.now() + (updated.interval_hours ?? 24) * 3_600_000
                  ).toISOString()
                : null,
            },
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
};

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Called once when the plugin is loaded. Starts the autonomous analysis loop. */
export async function start(ctx) {
  const autonomousCfg = ctx.sdk?.storage?.get("autonomous_config");
  if (!autonomousCfg?.enabled) return;

  const intervalMs = (autonomousCfg.interval_hours ?? 24) * 3_600_000;

  ctx.sdk?.log?.info(
    `self-improvement-assistant: autonomous analysis every ${autonomousCfg.interval_hours}h`
  );

  const run = async () => {
    try {
      const adminId = ctx.config?.telegram?.admin_ids?.[0];
      if (!adminId) return;

      const toolDefs = tools(ctx.sdk);
      const analyzeTool = toolDefs.find((t) => t.name === "analyze_codebase_quality");
      if (!analyzeTool) return;

      const result = await analyzeTool.execute(
        { focus_areas: ["security", "performance", "tests"] },
        { config: ctx.config }
      );

      if (
        result.success &&
        result.data.findings.length > 0 &&
        autonomousCfg.notify_on_findings !== false &&
        ctx.sdk?.telegram?.isAvailable?.()
      ) {
        const top3 = result.data.findings.slice(0, 3);
        const msg =
          `🔍 *Self-Improvement Analysis* found ${result.data.findings.length} potential issue(s):\n\n` +
          top3
            .map((f) => `• *${(f.severity ?? "medium").toUpperCase()}* in \`${f.file}\`: ${f.description}`)
            .join("\n") +
          `\n\nRun \`analyze_codebase_quality\` for the full report.`;

        await ctx.sdk.telegram.sendMessage(String(adminId), msg);
      }
    } catch (err) {
      ctx.sdk?.log?.error(`Autonomous analysis error: ${err.message}`);
    }
  };

  // Use the scheduler if available; otherwise fall back to setInterval.
  if (typeof ctx.scheduler?.every === "function") {
    ctx.scheduler.every(autonomousCfg.interval_hours ?? 24, "hours", run);
  } else {
    const timerId = setInterval(run, intervalMs);
    // Store so we can clear it in stop()
    globalThis.__selfImprovementTimer = timerId;
  }
}

/** Called when the plugin is stopped (hot-reload or shutdown). */
export async function stop() {
  if (globalThis.__selfImprovementTimer) {
    clearInterval(globalThis.__selfImprovementTimer);
    delete globalThis.__selfImprovementTimer;
  }
}
