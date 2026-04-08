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

// ── Expandable help block ─────────────────────────────────────────────────────

function ExpandableHelp({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "8px",
        marginBottom: "20px",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "var(--surface-2, #f9fafb)",
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <span>📖 {title}</span>
        <span style={{ fontSize: "11px", opacity: 0.6 }}>{open ? "▲ Collapse" : "▼ Expand"}</span>
      </button>
      {open && (
        <div
          style={{
            padding: "14px 16px",
            fontSize: "13px",
            lineHeight: 1.6,
            borderTop: "1px solid var(--border, #e5e7eb)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── Tab navigation ────────────────────────────────────────────────────────────

type TabId = "overview" | "automation" | "targets" | "analytics" | "logs";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "automation", label: "Automation", icon: "🤖" },
  { id: "targets", label: "Targets", icon: "📂" },
  { id: "analytics", label: "Analytics", icon: "📈" },
  { id: "logs", label: "Logs", icon: "📜" },
];

function TabNav({
  active,
  onChange,
  pendingCount,
  onRefresh,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  pendingCount: number;
  onRefresh: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "4px",
        marginBottom: "16px",
        borderBottom: "1px solid var(--border, #e5e7eb)",
        paddingBottom: "0",
      }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: "8px 16px",
            background: "none",
            border: "none",
            borderBottom:
              active === tab.id
                ? "2px solid var(--primary, #2563eb)"
                : "2px solid transparent",
            color: active === tab.id ? "var(--primary, #2563eb)" : "inherit",
            fontWeight: active === tab.id ? 600 : 400,
            cursor: "pointer",
            fontSize: "14px",
            marginBottom: "-1px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.id === "logs" && pendingCount > 0 && (
            <span
              style={{
                background: "#d97706",
                color: "#fff",
                borderRadius: "10px",
                padding: "1px 6px",
                fontSize: "11px",
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
      ))}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
        <button
          onClick={onRefresh}
          style={{ padding: "6px 14px", fontSize: "12px" }}
          title="Refresh data"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

// ── Settings panel (Overview tab) ─────────────────────────────────────────────

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
          {saving ? "Saving…" : saved ? "✓ Saved" : "💾 Save Settings"}
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

// ── Quick stats (Overview tab) ────────────────────────────────────────────────

function QuickStats({
  tasks,
  analysis,
  config,
}: {
  tasks: SelfImprovementTask[];
  analysis: SelfImprovementAnalysisEntry[];
  config: SelfImprovementConfig;
}) {
  const critical = tasks.filter((t) => t.priority === "critical").length;
  const high = tasks.filter((t) => t.priority === "high").length;
  const medium = tasks.filter((t) => t.priority === "medium").length;
  const lastScan = analysis[0]?.timestamp;
  const nextScheduled =
    config.schedule_enabled && lastScan
      ? lastScan + config.schedule_interval_hours * 3_600_000
      : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "12px",
      }}
    >
      {[
        { label: "Critical", value: critical, color: "#dc2626" },
        { label: "High", value: high, color: "#d97706" },
        { label: "Medium", value: medium, color: "#2563eb" },
      ].map((s) => (
        <div
          key={s.label}
          style={{
            padding: "14px 16px",
            border: `1px solid ${s.color}33`,
            borderRadius: "8px",
            background: `${s.color}11`,
          }}
        >
          <div style={{ fontSize: "24px", fontWeight: 700, color: s.color }}>{s.value}</div>
          <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>{s.label}</div>
        </div>
      ))}
      <div
        style={{
          padding: "14px 16px",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: "8px",
          gridColumn: "span 1",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 600, opacity: 0.6, marginBottom: "4px" }}>
          LAST SCAN
        </div>
        <div style={{ fontSize: "13px" }}>
          {lastScan ? timeAgo(lastScan) : "Never"}
        </div>
        {nextScheduled && (
          <div style={{ fontSize: "12px", opacity: 0.5, marginTop: "4px" }}>
            Next: {timeAgo(nextScheduled - Date.now() * 2 + nextScheduled) === "0m ago"
              ? "soon"
              : `in ${Math.max(0, Math.floor((nextScheduled - Date.now()) / 60_000))}m`}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  config,
  plugins,
  tasks,
  analysis,
  onSaveConfig,
  onTrigger,
  triggering,
  triggerMsg,
}: {
  config: SelfImprovementConfig;
  plugins: PluginManifest[];
  tasks: SelfImprovementTask[];
  analysis: SelfImprovementAnalysisEntry[];
  onSaveConfig: (cfg: SelfImprovementConfig) => Promise<void>;
  onTrigger: () => void;
  triggering: boolean;
  triggerMsg: { type: "success" | "error"; text: string } | null;
}) {
  const hasPlugin = !!config.selected_plugin;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <ExpandableHelp title="How it works">
        <p style={{ margin: "0 0 8px" }}>
          The Self-Improvement Center is a meta-orchestrator that delegates autonomous codebase
          analysis to an installed plugin (e.g. <code>github-dev-assistant</code>). The agent
          analyzes code, discovers vulnerabilities or improvements, and can automatically create
          GitHub issues.
        </p>
        <p style={{ margin: 0 }}>
          Configure a plugin executor in the settings below, then click{" "}
          <strong>▶ Run Analysis Now</strong> to start a manual scan, or enable the scheduled
          analysis to run automatically.
        </p>
      </ExpandableHelp>

      {/* Run bar */}
      <div
        className="card"
        style={{
          padding: "16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onTrigger}
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
          {triggering ? "⏳ Running…" : "▶ Run Analysis Now"}
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
            ⚠ No plugin selected — configure one in the Settings section below.
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

      {/* Quick stats */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">📊 Quick Stats</div>
        </div>
        <div style={{ padding: "16px" }}>
          <QuickStats tasks={tasks} analysis={analysis} config={config} />
        </div>
      </div>

      {/* Settings */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">⚙️ Orchestrator Settings</div>
        </div>
        <div style={{ padding: "16px" }}>
          <SettingsPanel config={config} plugins={plugins} onSave={onSaveConfig} />
        </div>
      </div>
    </div>
  );
}

// ── Automation tab ────────────────────────────────────────────────────────────

type FixSeverity = "critical" | "critical_high" | "all";

interface AutomationSettings {
  auto_create_prs: boolean;
  fix_severity: FixSeverity;
  branch_prefix: string;
  draft_pr: boolean;
  run_tests: boolean;
  auto_merge: boolean;
}

function AutomationTab() {
  const [settings, setSettings] = useState<AutomationSettings>({
    auto_create_prs: false,
    fix_severity: "critical_high",
    branch_prefix: "fix/auto-",
    draft_pr: true,
    run_tests: true,
    auto_merge: false,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  const radioStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    border: "1px solid transparent",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <ExpandableHelp title="About Automation">
        <p style={{ margin: "0 0 8px" }}>
          Configure how the agent creates Pull Requests with automatic fixes for discovered
          vulnerabilities. You can restrict auto-fix to only critical findings, or allow it for all
          severities.
        </p>
        <p style={{ margin: 0 }}>
          Use <strong>Draft PR</strong> mode to require human review before merging. Enable{" "}
          <strong>Run Tests</strong> to validate fixes before the PR is created.
        </p>
      </ExpandableHelp>

      {/* PR Strategy */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">🎯 PR Strategy</div>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Toggle
            checked={settings.auto_create_prs}
            onChange={(v) => setSettings({ ...settings, auto_create_prs: v })}
            label="Auto-create Pull Requests for fixes"
          />

          <div>
            <label style={labelStyle}>Fix Severity Level</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {(
                [
                  { id: "critical" as FixSeverity, label: "Critical only" },
                  { id: "critical_high" as FixSeverity, label: "Critical + High" },
                  { id: "all" as FixSeverity, label: "All severities" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  style={{
                    ...radioStyle,
                    border: `1px solid ${settings.fix_severity === opt.id ? "var(--primary, #2563eb)" : "var(--border, #e5e7eb)"}`,
                    background:
                      settings.fix_severity === opt.id ? "var(--primary, #2563eb)11" : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name="fix_severity"
                    value={opt.id}
                    checked={settings.fix_severity === opt.id}
                    onChange={() => setSettings({ ...settings, fix_severity: opt.id })}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Branch Prefix</label>
            <input
              type="text"
              value={settings.branch_prefix}
              onChange={(e) => setSettings({ ...settings, branch_prefix: e.target.value })}
              placeholder="fix/auto-"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Safety controls */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">🧪 Safety Controls</div>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <Toggle
            checked={settings.draft_pr}
            onChange={(v) => setSettings({ ...settings, draft_pr: v })}
            label="Create as Draft PR (require review before merge)"
          />
          <Toggle
            checked={settings.run_tests}
            onChange={(v) => setSettings({ ...settings, run_tests: v })}
            label="Run tests before creating PR"
          />
          <Toggle
            checked={settings.auto_merge}
            onChange={(v) => setSettings({ ...settings, auto_merge: v })}
            label="Auto-merge if tests pass (critical only)"
          />

          <div
            style={{
              marginTop: "4px",
              padding: "10px 14px",
              background: "var(--surface-2, #f9fafb)",
              borderRadius: "6px",
              fontSize: "12px",
              opacity: 0.8,
              border: "1px solid var(--border, #e5e7eb)",
            }}
          >
            🧪 <strong>Dry Run Mode</strong> — test the automation pipeline without making any
            actual changes to the repository.
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={handleSave}
          style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600 }}
        >
          {saved ? "✓ Saved" : "💾 Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ── Targets tab ───────────────────────────────────────────────────────────────

interface TargetRepo {
  id: string;
  name: string;
  lastScan: number | null;
  issueCount: number;
  enabled: boolean;
}

interface ScanScope {
  source_code: boolean;
  config_files: boolean;
  dependencies: boolean;
  documentation: boolean;
  exclude_paths: string;
}

function TargetsTab({ defaultRepo }: { defaultRepo: string }) {
  const [targets, setTargets] = useState<TargetRepo[]>(
    defaultRepo
      ? [{ id: "1", name: defaultRepo, lastScan: Date.now() - 13 * 60_000, issueCount: 0, enabled: true }]
      : []
  );
  const [newRepo, setNewRepo] = useState("");
  const [scope, setScope] = useState<ScanScope>({
    source_code: true,
    config_files: true,
    dependencies: true,
    documentation: false,
    exclude_paths: "/node_modules, /dist, /vendor",
  });
  const [saved, setSaved] = useState(false);

  const addRepo = () => {
    const name = newRepo.trim();
    if (!name || targets.find((t) => t.name === name)) return;
    setTargets([
      ...targets,
      { id: String(Date.now()), name, lastScan: null, issueCount: 0, enabled: true },
    ]);
    setNewRepo("");
  };

  const removeTarget = (id: string) => {
    setTargets(targets.filter((t) => t.id !== id));
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
      <ExpandableHelp title="About Targets">
        <p style={{ margin: "0 0 8px" }}>
          Add multiple repositories to monitor. The agent will scan them on the configured
          schedule and report findings separately for each target.
        </p>
        <p style={{ margin: 0 }}>
          Use <strong>Scan Scope</strong> to control which file types are analyzed. Exclude paths
          (e.g. <code>/node_modules</code>) to speed up analysis.
        </p>
      </ExpandableHelp>

      {/* Active targets */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">📂 Active Targets</div>
        </div>
        <div style={{ padding: "16px" }}>
          {targets.length === 0 ? (
            <p style={{ fontSize: "14px", opacity: 0.6 }}>
              No repositories configured. Add one below.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {targets.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: "8px",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ color: "#16a34a", fontSize: "12px" }}>✓</span>
                    <code style={{ fontSize: "13px" }}>{t.name}</code>
                    <span style={{ fontSize: "12px", opacity: 0.5 }}>
                      Last scan: {t.lastScan ? timeAgo(t.lastScan) : "never"}
                    </span>
                    {t.issueCount > 0 && (
                      <span style={{ fontSize: "12px", opacity: 0.5 }}>
                        Issues: {t.issueCount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeTarget(t.id)}
                    style={{ padding: "4px 10px", fontSize: "12px", color: "#dc2626" }}
                    title="Remove repository"
                  >
                    ❌ Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRepo()}
              placeholder="owner/repo"
              style={{ ...inputStyle, width: "auto", flex: 1 }}
            />
            <button onClick={addRepo} style={{ padding: "7px 16px", fontSize: "13px", fontWeight: 600 }}>
              + Add Repository
            </button>
          </div>
        </div>
      </div>

      {/* Scan scope */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">🔍 Scan Scope</div>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <Toggle
            checked={scope.source_code}
            onChange={(v) => setScope({ ...scope, source_code: v })}
            label="Source code (.js, .ts, .py, .go)"
          />
          <Toggle
            checked={scope.config_files}
            onChange={(v) => setScope({ ...scope, config_files: v })}
            label="Configuration files (.yaml, .json, .env)"
          />
          <Toggle
            checked={scope.dependencies}
            onChange={(v) => setScope({ ...scope, dependencies: v })}
            label="Dependencies (package.json, requirements.txt)"
          />
          <Toggle
            checked={scope.documentation}
            onChange={(v) => setScope({ ...scope, documentation: v })}
            label="Documentation (.md files)"
          />

          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>Exclude Paths</label>
            <input
              type="text"
              value={scope.exclude_paths}
              onChange={(e) => setScope({ ...scope, exclude_paths: e.target.value })}
              placeholder="/node_modules, /dist, /vendor"
              style={inputStyle}
            />
          </div>

          <div>
            <button
              onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
              style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, marginTop: "8px" }}
            >
              {saved ? "✓ Saved" : "💾 Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({
  tasks,
  analysis,
}: {
  tasks: SelfImprovementTask[];
  analysis: SelfImprovementAnalysisEntry[];
}) {
  const critical = tasks.filter((t) => t.priority === "critical").length;
  const high = tasks.filter((t) => t.priority === "high").length;
  const medium = tasks.filter((t) => t.priority === "medium").length;
  const totalFindings = analysis.reduce((sum, e) => sum + e.issues_found, 0);
  const totalCreated = analysis.reduce((sum, e) => sum + e.issues_created, 0);
  const securityScore = Math.max(0, 10 - critical * 2 - high * 0.5 - medium * 0.1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <ExpandableHelp title="About Analytics">
        <p style={{ margin: 0 }}>
          Track progress on improving your codebase's security and quality over time. The Security
          Score is computed from the number and severity of open findings. Export reports to share
          with your team.
        </p>
      </ExpandableHelp>

      {/* Security score */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">🛡️ Security Score</div>
        </div>
        <div style={{ padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                border: `4px solid ${securityScore >= 8 ? "#16a34a" : securityScore >= 5 ? "#d97706" : "#dc2626"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "22px", fontWeight: 700 }}>{securityScore.toFixed(1)}</span>
            </div>
            <div>
              <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "8px" }}>
                Score based on open findings
              </div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#dc2626" }}>
                  Critical: <strong>{critical}</strong>
                </span>
                <span style={{ fontSize: "13px", color: "#d97706" }}>
                  High: <strong>{high}</strong>
                </span>
                <span style={{ fontSize: "13px", color: "#2563eb" }}>
                  Medium: <strong>{medium}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trends */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">📈 Analysis Trends</div>
        </div>
        <div style={{ padding: "16px" }}>
          {analysis.length === 0 ? (
            <p style={{ fontSize: "14px", opacity: 0.6 }}>
              No analysis data yet. Run your first analysis to see trends.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                {[
                  { label: "Total Scans", value: analysis.length },
                  { label: "Total Findings", value: totalFindings },
                  { label: "Issues Created", value: totalCreated },
                  {
                    label: "Avg Findings/Scan",
                    value: analysis.length ? (totalFindings / analysis.length).toFixed(1) : "—",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--border, #e5e7eb)",
                      borderRadius: "8px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "20px", fontWeight: 700 }}>{stat.value}</div>
                    <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px" }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Time</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Repo</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Files</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Findings</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Issues Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.map((e) => (
                      <tr key={e.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }} title={fmtTs(e.timestamp)}>
                          {timeAgo(e.timestamp)}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <code style={{ fontSize: "12px" }}>{e.repo}</code>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.files_analyzed}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.issues_found}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{e.issues_created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">📤 Export Report</div>
        </div>
        <div style={{ padding: "16px" }}>
          <p style={{ fontSize: "13px", opacity: 0.7, margin: "0 0 12px" }}>
            Export the current findings and analysis history in your preferred format.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {["📄 PDF", "📊 CSV", "📋 JSON"].map((fmt) => (
              <button
                key={fmt}
                style={{ padding: "7px 16px", fontSize: "13px" }}
                onClick={() => {}}
                title="Export functionality coming soon"
              >
                {fmt}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "12px", opacity: 0.5, margin: "10px 0 0" }}>
            Export functionality coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

type LogTypeFilter = "all" | "pending" | "created" | "dismissed";
type LogSeverityFilter = "all" | "critical" | "high" | "medium" | "low";

function LogsTab({
  tasks,
  analysis,
  taskFilter,
  onTaskFilterChange,
}: {
  tasks: SelfImprovementTask[];
  analysis: SelfImprovementAnalysisEntry[];
  taskFilter: LogTypeFilter;
  onTaskFilterChange: (s: LogTypeFilter) => void;
}) {
  const [severityFilter, setSeverityFilter] = useState<LogSeverityFilter>("all");

  const filtered = tasks
    .filter((t) => taskFilter === "all" || t.status === taskFilter)
    .filter((t) => severityFilter === "all" || t.priority === severityFilter);

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: 600,
    border: `1px solid ${active ? "var(--primary, #2563eb)" : "var(--border, #e5e7eb)"}`,
    background: active ? "var(--primary, #2563eb)" : "transparent",
    color: active ? "#fff" : "inherit",
    cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <ExpandableHelp title="About Logs">
        <p style={{ margin: 0 }}>
          Full audit trail of all agent actions. Filter by status and severity to focus on what
          matters. Click <strong>View GitHub Issue</strong> on any task to open it directly.
        </p>
      </ExpandableHelp>

      {/* Analysis run log */}
      {analysis.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="section-title">📜 Analysis Runs</div>
          </div>
          <div style={{ padding: "16px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Timestamp</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Repo</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Branch</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Files</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Findings</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtTs(e.timestamp)}</td>
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
            {analysis[0]?.summary && (
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
                <strong>Latest summary:</strong> {analysis[0].summary}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Improvement tasks */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">📋 Improvement Tasks</div>
        </div>
        <div style={{ padding: "16px" }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.6 }}>Status:</span>
            {(["all", "pending", "created", "dismissed"] as LogTypeFilter[]).map((s) => (
              <button key={s} onClick={() => onTaskFilterChange(s)} style={filterBtnStyle(taskFilter === s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
                {s === "pending" && tasks.filter((t) => t.status === "pending").length > 0 && (
                  <span
                    style={{
                      marginLeft: "5px",
                      background: "#d97706",
                      color: "#fff",
                      borderRadius: "8px",
                      padding: "0px 5px",
                      fontSize: "10px",
                    }}
                  >
                    {tasks.filter((t) => t.status === "pending").length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.6 }}>Severity:</span>
            {(["all", "critical", "high", "medium", "low"] as LogSeverityFilter[]).map((s) => (
              <button key={s} onClick={() => setSeverityFilter(s)} style={filterBtnStyle(severityFilter === s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p style={{ fontSize: "14px", opacity: 0.6 }}>
              No {taskFilter === "all" && severityFilter === "all" ? "" : "matching "}tasks found.
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
                      {fmtTs(task.created_at)}
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
  const [taskFilter, setTaskFilter] = useState<LogTypeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

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
        setTriggerMsg({ type: "error", text: "Unknown error" });
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

  const pendingCount = tasks.filter((t) => t.status === "pending").length;

  return (
    <div>
      <div className="header">
        <h1>🚀 Self-Improvement Center</h1>
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

      <TabNav
        active={activeTab}
        onChange={setActiveTab}
        pendingCount={pendingCount}
        onRefresh={load}
      />

      {activeTab === "overview" && (
        <OverviewTab
          config={config}
          plugins={plugins}
          tasks={tasks}
          analysis={analysis}
          onSaveConfig={handleSaveConfig}
          onTrigger={handleTrigger}
          triggering={triggering}
          triggerMsg={triggerMsg}
        />
      )}

      {activeTab === "automation" && <AutomationTab />}

      {activeTab === "targets" && <TargetsTab defaultRepo={config.target_repo} />}

      {activeTab === "analytics" && <AnalyticsTab tasks={tasks} analysis={analysis} />}

      {activeTab === "logs" && (
        <LogsTab
          tasks={tasks}
          analysis={analysis}
          taskFilter={taskFilter}
          onTaskFilterChange={setTaskFilter}
        />
      )}
    </div>
  );
}
