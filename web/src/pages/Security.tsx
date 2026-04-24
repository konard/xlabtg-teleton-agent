import { useEffect, useState, useCallback } from "react";
import {
  api,
  type AuditActionType,
  type AuditReport,
  type AuditTrailEvent,
  type AuditTrailEventType,
  type AuditTrailPage,
  type AuditVerifyResult,
  type AuditLogEntry,
  type AuditLogPage,
  type SecuritySettings,
} from "../lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ACTION_LABELS: Record<AuditActionType, string> = {
  config_change: "Config Change",
  tool_toggle: "Tool Toggle",
  soul_edit: "Soul Edit",
  agent_restart: "Agent Restart",
  agent_stop: "Agent Stop",
  plugin_install: "Plugin Install",
  plugin_remove: "Plugin Remove",
  hook_change: "Hook Change",
  mcp_change: "MCP Change",
  memory_delete: "Memory Delete",
  workspace_change: "Workspace Change",
  session_delete: "Session Delete",
  secret_change: "Secret Change",
  security_change: "Security Change",
  financial_operation: "Financial Operation",
  login: "Login",
  logout: "Logout",
  other: "Other",
};

const ACTION_COLORS: Record<AuditActionType, string> = {
  config_change: "#2563eb",
  tool_toggle: "#7c3aed",
  soul_edit: "#0891b2",
  agent_restart: "#d97706",
  agent_stop: "#ef4444",
  plugin_install: "#16a34a",
  plugin_remove: "#dc2626",
  hook_change: "#9333ea",
  mcp_change: "#0e7490",
  memory_delete: "#b45309",
  workspace_change: "#059669",
  session_delete: "#d97706",
  secret_change: "#dc2626",
  security_change: "#7c3aed",
  financial_operation: "#059669",
  login: "#16a34a",
  logout: "#6b7280",
  other: "#6b7280",
};

const EVENT_LABELS: Record<AuditTrailEventType, string> = {
  "agent.decision": "Agent Decision",
  "tool.invoke": "Tool Invoke",
  "tool.result": "Tool Result",
  "llm.request": "LLM Request",
  "llm.response": "LLM Response",
  "config.change": "Config Change",
  "security.validation": "Security Validation",
  "user.action": "User Action",
  "session.lifecycle": "Session Lifecycle",
};

const EVENT_COLORS: Record<AuditTrailEventType, string> = {
  "agent.decision": "#0A84FF",
  "tool.invoke": "#AF52DE",
  "tool.result": "#32ADE6",
  "llm.request": "#34C759",
  "llm.response": "#30D158",
  "config.change": "#FF9F0A",
  "security.validation": "#FF453A",
  "user.action": "#8E8E93",
  "session.lifecycle": "#64D2FF",
};

function ActionBadge({ action }: { action: AuditActionType }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: `${ACTION_COLORS[action]}22`,
        color: ACTION_COLORS[action],
        whiteSpace: "nowrap",
      }}
    >
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

function EventBadge({ type }: { type: AuditTrailEventType }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: `${EVENT_COLORS[type]}22`,
        color: EVENT_COLORS[type],
        whiteSpace: "nowrap",
      }}
    >
      {EVENT_LABELS[type] ?? type}
    </span>
  );
}

function payloadSummary(payload: Record<string, unknown>): string {
  const preferred = ["decision", "toolName", "phase", "path", "status", "model", "success"];
  const parts = preferred
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .map((key) => `${key}: ${String(payload[key])}`);
  if (parts.length > 0) return parts.join(" | ");
  return JSON.stringify(payload);
}

// Comprehensive Audit Trail Section

function AuditTrailSection() {
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<AuditTrailEventType | "">("");
  const [session, setSession] = useState("");
  const [actor, setActor] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [data, setData] = useState<AuditTrailPage | null>(null);
  const [verification, setVerification] = useState<AuditVerifyResult | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [chain, setChain] = useState<AuditTrailEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;

  const filterBounds = () => ({
    from: since ? Math.floor(new Date(since).getTime() / 1000) : null,
    to: until ? Math.floor(new Date(until).getTime() / 1000) : null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bounds = filterBounds();
      const [eventsRes, reportRes] = await Promise.all([
        api.getAuditEvents({
          page,
          limit,
          type: filterType ? (filterType as AuditTrailEventType) : null,
          session: session.trim() || null,
          actor: actor.trim() || null,
          ...bounds,
        }),
        api.getAuditReport("daily_activity", 24),
      ]);
      setData(eventsRes.data ?? null);
      setReport(reportRes.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [page, filterType, session, actor, since, until]);

  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    setError(null);
    try {
      const res = await api.verifyAuditTrail(filterBounds());
      setVerification(res.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify audit trail");
    }
  };

  const showChain = async (eventId: string) => {
    setError(null);
    try {
      const res = await api.getAuditChain(eventId);
      setChain(res.data?.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load decision chain");
    }
  };

  const exportTrail = async (format: "json" | "csv") => {
    setError(null);
    try {
      const bounds = filterBounds();
      const exported = await api.exportAuditTrail({
        format,
        type: filterType ? (filterType as AuditTrailEventType) : null,
        session: session.trim() || null,
        actor: actor.trim() || null,
        ...bounds,
      });
      const url = URL.createObjectURL(exported.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exported.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export audit trail");
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 1;
  const totalEvents = Number(report?.summary.totalEvents ?? 0);

  return (
    <section style={{ marginBottom: "32px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="card" style={{ padding: "14px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>24h Events</div>
          <div style={{ fontSize: "22px", fontWeight: 600 }}>{totalEvents}</div>
        </div>
        <div className="card" style={{ padding: "14px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Integrity</div>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 600,
              color: verification
                ? verification.valid
                  ? "var(--green)"
                  : "var(--red)"
                : "var(--text)",
            }}
          >
            {verification ? (verification.valid ? "Verified" : "Broken") : "Unchecked"}
          </div>
        </div>
        <div className="card" style={{ padding: "14px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Checked</div>
          <div style={{ fontSize: "22px", fontWeight: 600 }}>{verification?.checked ?? "-"}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "16px" }}>Audit Trail</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={verify}
          >
            Verify
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => exportTrail("json")}
          >
            JSON
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => exportTrail("csv")}
          >
            CSV
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value as AuditTrailEventType | "");
            setPage(1);
          }}
          style={{ fontSize: "13px", padding: "4px 8px" }}
        >
          <option value="">All event types</option>
          {(Object.keys(EVENT_LABELS) as AuditTrailEventType[]).map((type) => (
            <option key={type} value={type}>
              {EVENT_LABELS[type]}
            </option>
          ))}
        </select>
        <input
          value={session}
          onChange={(e) => {
            setSession(e.target.value);
            setPage(1);
          }}
          placeholder="Session ID"
          style={{ fontSize: "13px", minWidth: 180 }}
        />
        <input
          value={actor}
          onChange={(e) => {
            setActor(e.target.value);
            setPage(1);
          }}
          placeholder="Actor"
          style={{ fontSize: "13px", minWidth: 120 }}
        />
        <input
          type="datetime-local"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
            setPage(1);
          }}
          title="From date"
          style={{ fontSize: "13px" }}
        />
        <input
          type="datetime-local"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setPage(1);
          }}
          title="To date"
          style={{ fontSize: "13px" }}
        />
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div
            style={{
              height: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            Loading...
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div
            style={{
              height: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            No audit trail events yet
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--separator)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Time
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Type
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Actor
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Session
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Payload
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Chain
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid var(--separator)" }}>
                    <td
                      style={{
                        padding: "8px 12px",
                        whiteSpace: "nowrap",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {fmtTs(entry.created_at)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <EventBadge type={entry.event_type} />
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "11px" }}>
                      {entry.actor}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        fontFamily: "monospace",
                        fontSize: "11px",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.session_id ?? ""}
                    >
                      {entry.session_id ?? "-"}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={JSON.stringify(entry.payload)}
                    >
                      {payloadSummary(entry.payload)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                        onClick={() => showChain(entry.id)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.total > limit && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "12px",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {data.total} total | Page {page} of {totalPages}
          </span>
          <button
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ fontSize: "12px", padding: "4px 10px" }}
          >
            Prev
          </button>
          <button
            className="btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ fontSize: "12px", padding: "4px 10px" }}
          >
            Next
          </button>
        </div>
      )}

      {chain && (
        <div className="card" style={{ marginTop: "16px", padding: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "12px",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "14px" }}>Decision Chain</h3>
            <button
              className="btn-ghost"
              style={{ fontSize: "12px", padding: "4px 8px" }}
              onClick={() => setChain(null)}
            >
              Close
            </button>
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            {chain.map((event) => (
              <div
                key={event.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr",
                  gap: "12px",
                  alignItems: "start",
                  borderBottom: "1px solid var(--separator)",
                  paddingBottom: "8px",
                }}
              >
                <EventBadge type={event.event_type} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      marginBottom: "2px",
                    }}
                  >
                    {fmtTs(event.created_at)} | {event.actor}
                  </div>
                  <div style={{ fontSize: "12px", overflowWrap: "anywhere" }}>
                    {payloadSummary(event.payload)}
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "10px",
                      color: "var(--text-tertiary)",
                      marginTop: "4px",
                    }}
                  >
                    {event.checksum.slice(0, 16)}...
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Audit Log Section ─────────────────────────────────────────────────────────

function AuditLogSection() {
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<AuditActionType | "">("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : null;
      const untilTs = until ? Math.floor(new Date(until).getTime() / 1000) : null;
      const res = await api.getAuditLog({
        page,
        limit,
        type: filterType ? (filterType as AuditActionType) : null,
        since: sinceTs,
        until: untilTs,
      });
      setData(res.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [page, filterType, since, until]);

  useEffect(() => {
    load();
  }, [load]);

  const exportUrl = api.getAuditExportUrl({
    type: filterType ? (filterType as AuditActionType) : null,
    since: since ? Math.floor(new Date(since).getTime() / 1000) : null,
    until: until ? Math.floor(new Date(until).getTime() / 1000) : null,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  return (
    <section style={{ marginBottom: "32px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "16px" }}>Audit Log</h2>
        <a href={exportUrl} download style={{ textDecoration: "none" }}>
          <button className="btn-ghost" style={{ fontSize: "12px", padding: "4px 12px" }}>
            Export CSV
          </button>
        </a>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "12px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value as AuditActionType | "");
            setPage(1);
          }}
          style={{ fontSize: "13px", padding: "4px 8px" }}
        >
          <option value="">All action types</option>
          {(Object.keys(ACTION_LABELS) as AuditActionType[]).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
            setPage(1);
          }}
          title="From date"
          style={{ fontSize: "13px" }}
        />
        <input
          type="datetime-local"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setPage(1);
          }}
          title="To date"
          style={{ fontSize: "13px" }}
        />
        {(filterType || since || until) && (
          <button
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => {
              setFilterType("");
              setSince("");
              setUntil("");
              setPage(1);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div
            style={{
              height: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            Loading…
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div
            style={{
              height: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            No audit log entries yet
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--separator)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Timestamp
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Action
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    Details
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    IP
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    User Agent
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry: AuditLogEntry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid var(--separator)" }}>
                    <td
                      style={{
                        padding: "8px 12px",
                        whiteSpace: "nowrap",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {fmtTs(entry.created_at)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <ActionBadge action={entry.action} />
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.details}
                    >
                      {entry.details}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        fontFamily: "monospace",
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {entry.ip ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--text-secondary)",
                        fontSize: "11px",
                      }}
                      title={entry.user_agent ?? ""}
                    >
                      {entry.user_agent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > limit && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "12px",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {data.total} total · Page {page} of {totalPages}
          </span>
          <button
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ fontSize: "12px", padding: "4px 10px" }}
          >
            ← Prev
          </button>
          <button
            className="btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ fontSize: "12px", padding: "4px 10px" }}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

// ── Security Settings Section ─────────────────────────────────────────────────

function SecuritySettingsSection() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [timeoutMinutes, setTimeoutMinutes] = useState("");
  const [ipAllowlist, setIpAllowlist] = useState("");
  const [rateLimit, setRateLimit] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSecuritySettings();
      const s = res.data ?? null;
      setSettings(s);
      if (s) {
        setTimeoutMinutes(
          s.session_timeout_minutes != null ? String(s.session_timeout_minutes) : ""
        );
        setIpAllowlist(s.ip_allowlist.join("\n"));
        setRateLimit(s.rate_limit_rpm != null ? String(s.rate_limit_rpm) : "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load security settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const patch: Partial<SecuritySettings> = {
        session_timeout_minutes:
          timeoutMinutes.trim() === "" ? null : parseInt(timeoutMinutes.trim(), 10),
        ip_allowlist: ipAllowlist
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        rate_limit_rpm: rateLimit.trim() === "" ? null : parseInt(rateLimit.trim(), 10),
      };
      const res = await api.updateSecuritySettings(patch);
      setSettings(res.data ?? null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ marginBottom: "32px" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: "16px" }}>Security Settings</h2>

      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}
      {success && (
        <div className="alert success" style={{ marginBottom: "12px" }}>
          Settings saved.
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>Loading…</div>
      ) : (
        <div className="card" style={{ padding: "20px", maxWidth: 600 }}>
          {/* Session Timeout */}
          <div className="form-group" style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "6px", fontWeight: 500 }}>
              Session Timeout (minutes)
            </label>
            <input
              type="number"
              min="1"
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(e.target.value)}
              placeholder="Leave empty to never expire"
              style={{ width: "100%", maxWidth: 300 }}
            />
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              Auto-logout after X minutes of inactivity. Leave empty to disable.
            </p>
          </div>

          {/* IP Allowlist */}
          <div className="form-group" style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "6px", fontWeight: 500 }}>
              IP Allowlist
            </label>
            <textarea
              value={ipAllowlist}
              onChange={(e) => setIpAllowlist(e.target.value)}
              placeholder={"One IP per line, e.g.:\n127.0.0.1\n192.168.1.0"}
              rows={4}
              style={{ width: "100%", maxWidth: 400, fontFamily: "monospace", fontSize: "13px" }}
            />
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              Only allow access from these IPs. Leave empty to allow all.{" "}
              <strong style={{ color: "#ef4444" }}>
                Warning: make sure your own IP is listed before saving.
              </strong>
            </p>
          </div>

          {/* Rate Limiting */}
          <div className="form-group" style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", marginBottom: "6px", fontWeight: 500 }}>
              Rate Limit (requests/minute)
            </label>
            <input
              type="number"
              min="1"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              placeholder="Leave empty to disable"
              style={{ width: "100%", maxWidth: 300 }}
            />
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              Maximum API requests per minute from a single IP. Leave empty to disable.
            </p>
          </div>

          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>

          {settings && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                backgroundColor: "var(--surface)",
                borderRadius: 6,
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              <strong>Current status:</strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                <li>
                  Session timeout:{" "}
                  {settings.session_timeout_minutes != null
                    ? `${settings.session_timeout_minutes} minutes`
                    : "disabled"}
                </li>
                <li>
                  IP allowlist:{" "}
                  {settings.ip_allowlist.length > 0
                    ? settings.ip_allowlist.join(", ")
                    : "allow all"}
                </li>
                <li>
                  Rate limiting:{" "}
                  {settings.rate_limit_rpm != null
                    ? `${settings.rate_limit_rpm} req/min`
                    : "disabled"}
                </li>
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Secrets Overview Section ──────────────────────────────────────────────────

function SecretsSection() {
  return (
    <section style={{ marginBottom: "32px" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: "16px" }}>Secrets Management</h2>
      <div className="card" style={{ padding: "20px" }}>
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "13px" }}>
          API keys and secrets are managed in the{" "}
          <a href="/config" style={{ color: "var(--accent)" }}>
            Config
          </a>{" "}
          page. Sensitive fields are masked and stored securely in the local config file.
        </p>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "13px" }}>
          All changes to secret values are recorded in the Audit Log above with action type{" "}
          <strong>Config Change</strong>.
        </p>
      </div>
    </section>
  );
}

// ── Main Security Page ────────────────────────────────────────────────────────

export function Security() {
  const [tab, setTab] = useState<"trail" | "log" | "settings" | "secrets">("trail");
  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: "trail", label: "Audit Trail" },
    { id: "log", label: "Admin Log" },
    { id: "settings", label: "Settings" },
    { id: "secrets", label: "Secrets" },
  ];

  return (
    <div className="dashboard-root">
      <div className="header">
        <h1>Security Center</h1>
        <p>Audit trail, security settings, and secrets management</p>
      </div>

      <div
        style={{
          display: "inline-flex",
          gap: "4px",
          padding: "4px",
          background: "var(--surface)",
          borderRadius: 8,
          marginBottom: "20px",
        }}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "" : "btn-ghost"}
            onClick={() => setTab(item.id)}
            style={{ fontSize: "13px", padding: "6px 12px" }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "trail" && <AuditTrailSection />}
      {tab === "log" && <AuditLogSection />}
      {tab === "settings" && <SecuritySettingsSection />}
      {tab === "secrets" && <SecretsSection />}
    </div>
  );
}
