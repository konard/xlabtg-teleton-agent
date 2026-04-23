import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AgentOverview, type AgentLogs } from "../lib/api";
import { toast } from "../lib/toast-store";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatUptime(value: number | null): string {
  if (!value || value <= 0) return "—";
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const STATE_COLORS: Record<AgentOverview["state"], string> = {
  stopped: "var(--text-tertiary)",
  starting: "#ffd60a",
  running: "var(--green)",
  stopping: "#ff9f0a",
  error: "var(--red)",
};

export function Agents() {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cloneFromId, setCloneFromId] = useState("primary");
  const [selectedLogsAgent, setSelectedLogsAgent] = useState<AgentOverview | null>(null);
  const [logs, setLogs] = useState<AgentLogs | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const response = await api.listAgents();
      setAgents(response.data.agents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    const interval = setInterval(() => {
      void loadAgents();
    }, 5_000);
    return () => clearInterval(interval);
  }, [loadAgents]);

  const cloneOptions = useMemo(
    () => agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.kind})` })),
    [agents]
  );

  const refreshLogs = useCallback(
    async (agent: AgentOverview) => {
      if (!agent.logsAvailable) return;
      setSelectedLogsAgent(agent);
      setLoadingLogs(true);
      try {
        const response = await api.getManagedAgentLogs(agent.id, 200);
        setLogs(response.data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingLogs(false);
      }
    },
    []
  );

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter an agent name first");
      return;
    }

    setCreating(true);
    try {
      await api.createAgent({
        name: trimmed,
        cloneFromId: cloneFromId === "primary" ? undefined : cloneFromId,
      });
      setName("");
      toast.success("Managed agent created");
      await loadAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [cloneFromId, loadAgents, name]);

  const handleStartStop = useCallback(
    async (agent: AgentOverview, action: "start" | "stop") => {
      setBusyAgentId(agent.id);
      try {
        if (action === "start") {
          await api.startManagedAgent(agent.id);
          toast.success(`Starting ${agent.name}`);
        } else {
          await api.stopManagedAgent(agent.id);
          toast.success(`Stopping ${agent.name}`);
        }
        await loadAgents();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAgentId(null);
      }
    },
    [loadAgents]
  );

  const handleClone = useCallback(
    async (agent: AgentOverview) => {
      const cloneName = window.prompt("Name for the cloned agent", `${agent.name} Copy`)?.trim();
      if (!cloneName) return;

      setBusyAgentId(agent.id);
      try {
        await api.cloneAgent(agent.id, { name: cloneName });
        toast.success(`Cloned ${agent.name}`);
        await loadAgents();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAgentId(null);
      }
    },
    [loadAgents]
  );

  const handleDelete = useCallback(
    async (agent: AgentOverview) => {
      if (!window.confirm(`Delete ${agent.name}? This removes its isolated home directory.`)) return;

      setBusyAgentId(agent.id);
      try {
        await api.deleteAgent(agent.id);
        if (selectedLogsAgent?.id === agent.id) {
          setSelectedLogsAgent(null);
          setLogs(null);
        }
        toast.success(`Deleted ${agent.name}`);
        await loadAgents();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAgentId(null);
      }
    },
    [loadAgents, selectedLogsAgent]
  );

  if (loading) {
    return <div className="loading">Loading managed agents...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div className="header" style={{ marginBottom: 0 }}>
        <h1>Agents</h1>
        <p>Run isolated Telegram agents side by side from one control surface.</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "4px" }}>
          {error}
        </div>
      )}

      <section
        style={{
          display: "grid",
          gap: "12px",
          padding: "16px",
          borderRadius: "16px",
          border: "1px solid var(--separator)",
          background: "var(--surface)",
        }}
      >
        <div>
          <div style={{ fontSize: "15px", fontWeight: 600 }}>Create managed agent</div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
            New agents clone an existing home directory, then run with their own `TELETON_HOME`.
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <input
            type="text"
            placeholder="Agent name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select value={cloneFromId} onChange={(e) => setCloneFromId(e.target.value)}>
            {cloneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                Clone from {option.label}
              </option>
            ))}
          </select>
          <button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "14px",
        }}
      >
        {agents.map((agent) => {
          const busy = busyAgentId === agent.id;
          return (
            <article
              key={agent.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                padding: "16px",
                borderRadius: "18px",
                border: "1px solid var(--separator)",
                background: "linear-gradient(180deg, var(--surface-hover), var(--surface))",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        width: "9px",
                        height: "9px",
                        borderRadius: "50%",
                        background: STATE_COLORS[agent.state],
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      {agent.kind}
                    </span>
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    {agent.provider} / {agent.model}
                  </div>
                </div>
                <code style={{ fontSize: "11px", opacity: 0.7 }}>{agent.id}</code>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "10px 14px",
                  fontSize: "12px",
                }}
              >
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>State</div>
                  <div>{agent.state}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>PID</div>
                  <div>{agent.pid ?? "—"}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Started</div>
                  <div>{formatDate(agent.startedAt)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Uptime</div>
                  <div>{formatUptime(agent.uptimeMs)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Owner</div>
                  <div>{agent.ownerId ?? "—"}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Admins</div>
                  <div>{agent.adminIds.length > 0 ? agent.adminIds.join(", ") : "—"}</div>
                </div>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  wordBreak: "break-word",
                }}
              >
                <div>Home: {agent.homePath}</div>
                <div>Config: {agent.configPath}</div>
                {agent.lastError && <div style={{ color: "var(--red)" }}>Last error: {agent.lastError}</div>}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {agent.canStart && (
                  <button onClick={() => void handleStartStop(agent, "start")} disabled={busy}>
                    {busy ? "Working..." : "Start"}
                  </button>
                )}
                {agent.canStop && (
                  <button
                    onClick={() => void handleStartStop(agent, "stop")}
                    disabled={busy}
                    className="btn-danger"
                  >
                    {busy ? "Working..." : "Stop"}
                  </button>
                )}
                <button onClick={() => void handleClone(agent)} disabled={busy}>
                  Clone
                </button>
                {agent.canDelete && (
                  <button onClick={() => void handleDelete(agent)} disabled={busy} className="btn-danger">
                    Delete
                  </button>
                )}
                {agent.logsAvailable && (
                  <button onClick={() => void refreshLogs(agent)} disabled={busy}>
                    Logs
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {selectedLogsAgent && (
        <section
          style={{
            display: "grid",
            gap: "10px",
            padding: "16px",
            borderRadius: "16px",
            border: "1px solid var(--separator)",
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600 }}>{selectedLogsAgent.name} logs</div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {logs?.path ?? selectedLogsAgent.logPath}
              </div>
            </div>
            <button onClick={() => void refreshLogs(selectedLogsAgent)} disabled={loadingLogs}>
              {loadingLogs ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "14px",
              borderRadius: "14px",
              background: "rgba(0, 0, 0, 0.26)",
              color: "var(--text)",
              fontSize: "12px",
              lineHeight: 1.6,
              overflowX: "auto",
              maxHeight: "420px",
            }}
          >
            {logs?.lines.length ? logs.lines.join("\n") : "No logs yet."}
          </pre>
        </section>
      )}
    </div>
  );
}
