import { useEffect, useState, useCallback } from "react";
import {
  api,
  type SelfImprovementConfig,
  type SelfImprovementAnalysisEntry,
  type SelfImprovementTask,
  type PluginManifest,
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

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
        fontSize: "13px",
      }}
    >
      <span
        onClick={() => onChange(!checked)}
        style={{
          display: "inline-block",
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked ? "var(--primary, #2563eb)" : "var(--border, #d1d5db)",
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      {label}
    </label>
  );
}

// ── Focus area chips ──────────────────────────────────────────────────────────

const ALL_FOCUS_AREAS = ["security", "performance", "readability", "tests", "documentation"];

function FocusAreaPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (areas: string[]) => void;
}) {
  const toggle = (area: string) => {
    if (selected.includes(area)) {
      onChange(selected.filter((a) => a !== area));
    } else {
      onChange([...selected, area]);
    }
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {ALL_FOCUS_AREAS.map((area) => {
        const active = selected.includes(area);
        return (
          <button
            key={area}
            onClick={() => toggle(area)}
            style={{
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              border: `1px solid ${active ? "var(--primary, #2563eb)" : "var(--border, #e5e7eb)"}`,
              background: active ? "var(--primary, #2563eb)" : "transparent",
              color: active ? "#fff" : "inherit",
              cursor: "pointer",
            }}
          >
            {area}
          </button>
        );
      })}
    </div>
  );
}

// ── Analysis history table ────────────────────────────────────────────────────

function AnalysisHistory({ entries }: { entries: SelfImprovementAnalysisEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ fontSize: "14px", opacity: 0.6, margin: "16px 0" }}>
        No analysis runs yet. Configure a plugin executor and click{" "}
        <strong>Run Analysis</strong> to start.
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

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  config,
  plugins,
  onSave,
}: {
  config: SelfImprovementConfig;
  plugins: PluginManifest[];
  onSave: (cfg: SelfImprovementConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SelfImprovementConfig>(config);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync when parent config changes (e.g. after load)
  useEffect(() => {
    setDraft(config);
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    fontSize: "13px",
    border: "1px solid var(--border, #e5e7eb)",
    borderRadius: "6px",
    background: "var(--surface, #fff)",
    color: "inherit",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    marginBottom: "5px",
    opacity: 0.75,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Executor plugin */}
      <div>
        <label style={labelStyle}>Executor Plugin</label>
        <select
          value={draft.selected_plugin}
          onChange={(e) => setDraft({ ...draft, selected_plugin: e.target.value })}
          style={inputStyle}
        >
          <option value="">— select a plugin —</option>
          {plugins.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}{p.version ? ` (v${p.version})` : ""}
            </option>
          ))}
        </select>
        <p style={{ margin: "5px 0 0", fontSize: "12px", opacity: 0.6 }}>
          The agent will delegate analysis to this plugin's tools (e.g.{" "}
          <code>github-dev-assistant</code>).
        </p>
      </div>

      {/* Guide URL */}
      <div>
        <label style={labelStyle}>Guide / Instruction URL (optional)</label>
        <input
          type="url"
          value={draft.guide_url}
          onChange={(e) => setDraft({ ...draft, guide_url: e.target.value })}
          placeholder="https://github.com/…/GUIDE.md"
          style={inputStyle}
        />
        <p style={{ margin: "5px 0 0", fontSize: "12px", opacity: 0.6 }}>
          Paste a GUIDE.md URL to give the agent context on available tools and workflows.
        </p>
      </div>

      {/* Target repository */}
      <div>
        <label style={labelStyle}>Target Repository</label>
        <input
          type="text"
          value={draft.target_repo}
          onChange={(e) => setDraft({ ...draft, target_repo: e.target.value })}
          placeholder="owner/repo"
          style={inputStyle}
        />
        <p style={{ margin: "5px 0 0", fontSize: "12px", opacity: 0.6 }}>
          GitHub repository to analyze, e.g. <code>xlabtg/teleton-agent</code>.
        </p>
      </div>

      {/* Focus areas */}
      <div>
        <label style={labelStyle}>Focus Areas</label>
        <FocusAreaPicker
          selected={draft.focus_areas}
          onChange={(areas) => setDraft({ ...draft, focus_areas: areas })}
        />
      </div>

      {/* Autonomous schedule */}
      <div
        style={{
          padding: "14px 16px",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <Toggle
          checked={draft.schedule_enabled}
          onChange={(v) => setDraft({ ...draft, schedule_enabled: v })}
          label="Enable autonomous scheduled analysis"
        />

        {draft.schedule_enabled && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label style={{ fontSize: "13px", whiteSpace: "nowrap" }}>Run every</label>
            <select
              value={draft.schedule_interval_hours}
              onChange={(e) =>
                setDraft({ ...draft, schedule_interval_hours: Number(e.target.value) })
              }
              style={{ ...inputStyle, width: "auto" }}
            >
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={168}>1 week</option>
            </select>
          </div>
        )}

        <Toggle
          checked={draft.require_approval}
          onChange={(v) => setDraft({ ...draft, require_approval: v })}
          label="Require approval before creating GitHub issues"
        />

        <Toggle
          checked={draft.auto_create_issues}
          onChange={(v) => setDraft({ ...draft, auto_create_issues: v })}
          label="Auto-create GitHub issues for critical findings"
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600 }}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Settings"}
        </button>
        {saveError && (
          <span style={{ fontSize: "13px", color: "#dc2626" }}>
            ✗ {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SelfImprove() {
  const [config, setConfig] = useState<SelfImprovementConfig>({
    selected_plugin: "",
    guide_url: "",
    target_repo: "",
    focus_areas: ["security", "performance", "readability"],
    auto_create_issues: false,
    schedule_enabled: false,
    schedule_interval_hours: 24,
    require_approval: true,
  });
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [analysis, setAnalysis] = useState<SelfImprovementAnalysisEntry[]>([]);
  const [tasks, setTasks] = useState<SelfImprovementTask[]>([]);
  const [taskFilter, setTaskFilter] = useState<"all" | "pending" | "created" | "dismissed">("all");
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"settings" | "history" | "tasks">("settings");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, pluginsRes, analysisRes, tasksRes] = await Promise.all([
        api.getSelfImprovementConfig(),
        api.getPlugins(),
        api.getSelfImprovementAnalysis(20),
        api.getSelfImprovementTasks("all", 50),
      ]);
      if (cfgRes.success && cfgRes.data) setConfig(cfgRes.data);
      if (pluginsRes.success && pluginsRes.data) setPlugins(pluginsRes.data);
      if (analysisRes.success && analysisRes.data) setAnalysis(analysisRes.data);
      if (tasksRes.success && tasksRes.data) setTasks(tasksRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveConfig = async (cfg: SelfImprovementConfig) => {
    const res = await api.saveSelfImprovementConfig(cfg);
    if (res.success && res.data) setConfig(res.data);
  };

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await api.triggerSelfImprovement();
      if (res.success && res.data) {
        setTriggerMsg({ type: "success", text: res.data.message });
      } else {
        setTriggerMsg({ type: "error", text: res.error ?? "Unknown error" });
      }
    } catch (err) {
      setTriggerMsg({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTriggering(false);
    }
  };

  if (loading) return <div className="loading">Loading…</div>;

  const hasPlugin = !!config.selected_plugin;

  return (
    <div>
      <div className="header">
        <h1>Self-Improvement</h1>
        <p>
          Meta-orchestrator: delegate autonomous codebase analysis to an installed plugin (e.g.{" "}
          <code>github-dev-assistant</code>).
        </p>
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

      {/* Run bar */}
      <div
        className="card"
        style={{
          marginBottom: "20px",
          padding: "16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={handleTrigger}
          disabled={triggering || !hasPlugin}
          style={{
            padding: "9px 22px",
            fontWeight: 600,
            fontSize: "14px",
            background: hasPlugin ? "var(--primary, #2563eb)" : undefined,
            color: hasPlugin ? "#fff" : undefined,
            border: hasPlugin ? "none" : undefined,
          }}
          title={!hasPlugin ? "Select a plugin in Settings first" : undefined}
        >
          {triggering ? "⏳ Running…" : "▶ Run Analysis"}
        </button>

        {config.selected_plugin && (
          <span style={{ fontSize: "13px", opacity: 0.7 }}>
            via <strong>{config.selected_plugin}</strong>
            {config.target_repo && (
              <>
                {" "}
                on <code>{config.target_repo}</code>
              </>
            )}
          </span>
        )}

        {!hasPlugin && (
          <span style={{ fontSize: "13px", color: "#d97706" }}>
            ⚠ No plugin selected — configure one in the Settings tab.
          </span>
        )}

        {triggerMsg && (
          <span
            style={{
              fontSize: "13px",
              color: triggerMsg.type === "success" ? "#16a34a" : "#dc2626",
            }}
          >
            {triggerMsg.type === "success" ? "✓ " : "✗ "}
            {triggerMsg.text}
          </span>
        )}
      </div>

      {/* Section tabs */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "16px",
          borderBottom: "1px solid var(--border, #e5e7eb)",
          paddingBottom: "0",
        }}
      >
        {(["settings", "history", "tasks"] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              borderBottom:
                activeSection === section
                  ? "2px solid var(--primary, #2563eb)"
                  : "2px solid transparent",
              color:
                activeSection === section ? "var(--primary, #2563eb)" : "inherit",
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

      {/* Settings section */}
      {activeSection === "settings" && (
        <div className="card">
          <div className="card-header">
            <div className="section-title">Orchestrator Settings</div>
          </div>
          <div style={{ padding: "16px" }}>
            <SettingsPanel
              config={config}
              plugins={plugins}
              onSave={handleSaveConfig}
            />
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
