import { useEffect, useState, useCallback } from "react";
import {
  api,
  type SelfImprovementAnalysisEntry,
  type SelfImprovementTask,
} from "../lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

// ── Severity badge ─────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#d97706",
  medium: "#2563eb",
  low: "#6b7280",
};

function SeverityBadge({ priority }: { priority: string }) {
  const color = SEVERITY_COLORS[priority] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: `${color}22`,
        color,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
      }}
    >
      {priority}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: "#d97706",
  created: "#16a34a",
  dismissed: "#6b7280",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: `${color}22`,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

// ── Analysis history table ────────────────────────────────────────────────────

function AnalysisHistory({ entries }: { entries: SelfImprovementAnalysisEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ fontSize: "14px", opacity: 0.6, margin: "16px 0" }}>
        No analysis runs yet. Install the{" "}
        <code>self-improvement-assistant</code> plugin and run{" "}
        <code>analyze_codebase_quality</code> via the agent.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Time</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Repo</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Branch</th>
            <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Files</th>
            <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Findings</th>
            <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Issues Created</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.id}
              style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}
            >
              <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }} title={fmtTs(e.timestamp)}>
                {timeAgo(e.timestamp)}
              </td>
              <td style={{ padding: "8px 12px" }}>
                <code style={{ fontSize: "12px" }}>{e.repo}</code>
              </td>
              <td style={{ padding: "8px 12px" }}>
                <code style={{ fontSize: "12px" }}>{e.branch}</code>
              </td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.files_analyzed}</td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.issues_found}</td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.issues_created}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > 0 && entries[0].summary && (
        <div
          style={{
            marginTop: "12px",
            padding: "12px",
            background: "var(--surface-2, #f9fafb)",
            borderRadius: "6px",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          <strong>Latest summary:</strong> {entries[0].summary}
        </div>
      )}
    </div>
  );
}

// ── Improvement tasks list ────────────────────────────────────────────────────

function ImprovementTaskList({
  tasks,
  statusFilter,
  onStatusFilterChange,
}: {
  tasks: SelfImprovementTask[];
  statusFilter: "all" | "pending" | "created" | "dismissed";
  onStatusFilterChange: (s: "all" | "pending" | "created" | "dismissed") => void;
}) {
  const filtered =
    statusFilter === "all" ? tasks : tasks.filter((t) => t.status === statusFilter);

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {(["all", "pending", "created", "dismissed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onStatusFilterChange(s)}
            style={{
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              border: `1px solid ${statusFilter === s ? "var(--primary, #2563eb)" : "var(--border, #e5e7eb)"}`,
              background: statusFilter === s ? "var(--primary, #2563eb)" : "transparent",
              color: statusFilter === s ? "#fff" : "inherit",
              cursor: "pointer",
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: "14px", opacity: 0.6 }}>
          No {statusFilter === "all" ? "" : statusFilter + " "}tasks found.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {filtered.map((task) => (
            <div
              key={task.id}
              style={{
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "8px",
                padding: "12px 16px",
                background: "var(--surface, #fff)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <SeverityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                  {task.file_path && (
                    <code
                      style={{
                        fontSize: "11px",
                        background: "var(--surface-2, #f3f4f6)",
                        padding: "2px 6px",
                        borderRadius: "3px",
                      }}
                    >
                      {task.file_path}
                    </code>
                  )}
                </div>
                <span style={{ fontSize: "12px", opacity: 0.5, whiteSpace: "nowrap" }}>
                  {timeAgo(task.created_at)}
                </span>
              </div>

              <p style={{ margin: "0 0 6px", fontSize: "13px", lineHeight: 1.5 }}>
                {task.description}
              </p>

              {task.suggestion && (
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "12px",
                    opacity: 0.75,
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}
                >
                  💡 {task.suggestion}
                </p>
              )}

              {task.github_issue_url && (
                <a
                  href={task.github_issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "12px", color: "var(--primary, #2563eb)" }}
                >
                  View GitHub Issue ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SelfImprove() {
  const [status, setStatus] = useState<{
    installed: boolean;
    analysis_count?: number;
    pending_tasks?: number;
    last_analysis?: number | null;
  } | null>(null);
  const [analysis, setAnalysis] = useState<SelfImprovementAnalysisEntry[]>([]);
  const [tasks, setTasks] = useState<SelfImprovementTask[]>([]);
  const [taskFilter, setTaskFilter] = useState<"all" | "pending" | "created" | "dismissed">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"overview" | "history" | "tasks">("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, analysisRes, tasksRes] = await Promise.all([
        api.getSelfImprovementStatus(),
        api.getSelfImprovementAnalysis(20),
        api.getSelfImprovementTasks("all", 50),
      ]);
      setStatus(statusRes.data);
      setAnalysis(analysisRes.data);
      setTasks(tasksRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="header">
        <h1>Self-Improvement</h1>
        <p>Autonomous codebase analysis and improvement tracking</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "14px" }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Status cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <div className="card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "4px" }}>Plugin Status</div>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>
            {status?.installed ? (
              <span style={{ color: "#16a34a" }}>Installed</span>
            ) : (
              <span style={{ color: "#6b7280" }}>Not installed</span>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "4px" }}>Analysis Runs</div>
          <div style={{ fontWeight: 700, fontSize: "22px" }}>
            {status?.analysis_count ?? 0}
          </div>
        </div>

        <div className="card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "4px" }}>Pending Tasks</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: "22px",
              color: (status?.pending_tasks ?? 0) > 0 ? "#d97706" : "inherit",
            }}
          >
            {status?.pending_tasks ?? 0}
          </div>
        </div>

        <div className="card" style={{ padding: "16px" }}>
          <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "4px" }}>Last Analysis</div>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>
            {status?.last_analysis ? timeAgo(status.last_analysis) : "—"}
          </div>
        </div>
      </div>

      {/* Plugin not installed notice */}
      {!status?.installed && (
        <div
          className="card"
          style={{ padding: "20px", marginBottom: "24px", borderLeft: "3px solid #d97706" }}
        >
          <h3 style={{ margin: "0 0 8px", fontSize: "15px" }}>Plugin not installed</h3>
          <p style={{ margin: "0 0 12px", fontSize: "13px", lineHeight: 1.6 }}>
            The <code>self-improvement-assistant</code> plugin is not installed yet. Copy the
            example from the repository and place it in{" "}
            <code>~/.teleton/plugins/self-improvement-assistant/</code>, then restart the agent.
          </p>
          <p style={{ margin: 0, fontSize: "13px", opacity: 0.7 }}>
            Example plugin source:{" "}
            <code>examples/plugins/self-improvement-assistant/index.js</code>
          </p>
        </div>
      )}

      {/* Section tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "16px", borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "0" }}>
        {(["overview", "history", "tasks"] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              borderBottom: activeSection === section ? "2px solid var(--primary, #2563eb)" : "2px solid transparent",
              color: activeSection === section ? "var(--primary, #2563eb)" : "inherit",
              fontWeight: activeSection === section ? 600 : 400,
              cursor: "pointer",
              fontSize: "14px",
              marginBottom: "-1px",
            }}
          >
            {section.charAt(0).toUpperCase() + section.slice(1)}
            {section === "tasks" && tasks.filter((t) => t.status === "pending").length > 0 && (
              <span
                style={{
                  marginLeft: "6px",
                  background: "#d97706",
                  color: "#fff",
                  borderRadius: "10px",
                  padding: "1px 6px",
                  fontSize: "11px",
                }}
              >
                {tasks.filter((t) => t.status === "pending").length}
              </span>
            )}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <button
            onClick={load}
            style={{ padding: "6px 14px", fontSize: "12px" }}
            title="Refresh data"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Overview section */}
      {activeSection === "overview" && (
        <div>
          <div className="card">
            <div className="card-header">
              <div className="section-title">About Self-Improvement</div>
            </div>
            <div style={{ padding: "16px", fontSize: "14px", lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 12px" }}>
                The <strong>self-improvement-assistant</strong> plugin enables the agent to
                autonomously analyze its own codebase for potential improvements, bugs, and
                refactoring opportunities, and optionally create GitHub issues from findings.
              </p>
              <p style={{ margin: "0 0 12px" }}>
                <strong>Available agent tools after installing the plugin:</strong>
              </p>
              <ul style={{ margin: "0 0 12px", paddingLeft: "20px" }}>
                <li>
                  <code>analyze_codebase_quality</code> — Scan a GitHub repository for issues
                </li>
                <li>
                  <code>create_github_issue_from_finding</code> — Open a GitHub issue from a finding
                </li>
                <li>
                  <code>list_analysis_history</code> — View past analysis runs
                </li>
                <li>
                  <code>list_improvement_tasks</code> — Browse discovered improvement tasks
                </li>
                <li>
                  <code>configure_autonomous_analysis</code> — Enable periodic scheduled analysis
                </li>
              </ul>
              <p style={{ margin: 0, opacity: 0.7 }}>
                Requires a GitHub Personal Access Token with <code>repo</code> scope, stored as the{" "}
                <code>github_token</code> plugin secret.
              </p>
            </div>
          </div>

          <div className="card" style={{ marginTop: "16px" }}>
            <div className="card-header">
              <div className="section-title">Quick Start</div>
            </div>
            <div style={{ padding: "16px" }}>
              <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", lineHeight: 2 }}>
                <li>
                  Copy{" "}
                  <code>examples/plugins/self-improvement-assistant/</code> to{" "}
                  <code>~/.teleton/plugins/self-improvement-assistant/</code>
                </li>
                <li>Restart the agent to load the plugin</li>
                <li>
                  Set the GitHub token secret:{" "}
                  <code>/plugin keys self-improvement-assistant github_token YOUR_PAT</code>
                </li>
                <li>
                  Run the analysis:{" "}
                  <code>analyze_codebase_quality repo="xlabtg/teleton-agent"</code>
                </li>
                <li>Review findings on the Tasks tab and create GitHub issues as needed</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* History section */}
      {activeSection === "history" && (
        <div className="card">
          <div className="card-header">
            <div className="section-title">Analysis History</div>
          </div>
          <div style={{ padding: "16px" }}>
            <AnalysisHistory entries={analysis} />
          </div>
        </div>
      )}

      {/* Tasks section */}
      {activeSection === "tasks" && (
        <div className="card">
          <div className="card-header">
            <div className="section-title">Improvement Tasks</div>
          </div>
          <div style={{ padding: "16px" }}>
            <ImprovementTaskList
              tasks={tasks}
              statusFilter={taskFilter}
              onStatusFilterChange={setTaskFilter}
            />
          </div>
        </div>
      )}
    </div>
  );
}
