import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type NetworkAgentData,
  type NetworkAgentStatus,
  type NetworkMessageData,
  type NetworkStatusData,
  type NetworkTrustLevel,
} from "../lib/api";
import { toast } from "../lib/toast-store";

const TRUST_LEVELS: NetworkTrustLevel[] = ["trusted", "verified", "untrusted"];
const AGENT_STATUSES: NetworkAgentStatus[] = ["available", "busy", "offline", "degraded"];

interface AgentForm {
  agentId: string;
  name: string;
  endpoint: string;
  capabilities: string;
  status: NetworkAgentStatus;
  load: string;
  trustLevel: NetworkTrustLevel;
  publicKey: string;
}

const DEFAULT_AGENT_FORM: AgentForm = {
  agentId: "",
  name: "",
  endpoint: "",
  capabilities: "",
  status: "available",
  load: "0",
  trustLevel: "untrusted",
  publicKey: "",
};

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTime(value: number | null): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function statusColor(status: NetworkAgentStatus | NetworkMessageData["status"]): string {
  if (status === "available" || status === "sent" || status === "received") return "var(--green)";
  if (status === "busy" || status === "queued") return "var(--cyan)";
  if (status === "degraded") return "var(--purple)";
  if (status === "failed") return "var(--red)";
  return "var(--text-tertiary)";
}

function parsePayload(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: "14px", minHeight: "78px" }}>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function AgentNode({ agent }: { agent: NetworkAgentData }) {
  return (
    <div
      style={{
        border: "1px solid var(--separator)",
        borderRadius: "8px",
        padding: "10px",
        background: "var(--surface)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            width: "9px",
            height: "9px",
            borderRadius: "50%",
            background: statusColor(agent.status),
            flex: "0 0 auto",
          }}
        />
        <strong style={{ overflowWrap: "anywhere" }}>{agent.name}</strong>
      </div>
      <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
        {agent.id} / {agent.trustLevel} / {formatPercent(agent.load)}
      </div>
    </div>
  );
}

export function Network() {
  const [agents, setAgents] = useState<NetworkAgentData[]>([]);
  const [messages, setMessages] = useState<NetworkMessageData[]>([]);
  const [status, setStatus] = useState<NetworkStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentForm, setAgentForm] = useState<AgentForm>(DEFAULT_AGENT_FORM);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskCapabilities, setTaskCapabilities] = useState("");
  const [taskPayload, setTaskPayload] = useState("{}");
  const [lastError, setLastError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLastError(null);
    try {
      const [agentsRes, statusRes, messagesRes] = await Promise.all([
        api.getNetworkAgents(),
        api.getNetworkStatus(),
        api.getNetworkMessages({ limit: 50 }),
      ]);
      setAgents(agentsRes.data.agents);
      setStatus(statusRes.data);
      setMessages(messagesRes.data.messages);
      setSelectedAgentId((current) => current || agentsRes.data.agents[0]?.id || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const capableAgents = useMemo(
    () => agents.filter((agent) => !agent.blocked && agent.trustLevel !== "untrusted"),
    [agents]
  );
  const selectableAgents = capableAgents.length > 0 ? capableAgents : agents;

  const registerAgent = async () => {
    setSaving(true);
    setLastError(null);
    try {
      await api.registerNetworkAgent({
        agentId: agentForm.agentId.trim(),
        name: agentForm.name.trim(),
        endpoint: agentForm.endpoint.trim(),
        capabilities: commaList(agentForm.capabilities),
        status: agentForm.status,
        load: Number(agentForm.load) || 0,
        trustLevel: agentForm.trustLevel,
        publicKey: agentForm.publicKey.trim() || null,
      });
      setAgentForm(DEFAULT_AGENT_FORM);
      toast.success("Network agent saved");
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const updateTrust = async (agent: NetworkAgentData, trustLevel: NetworkTrustLevel) => {
    await api.updateNetworkAgentTrust(agent.id, { trustLevel });
    await load();
  };

  const toggleBlocked = async (agent: NetworkAgentData) => {
    await api.updateNetworkAgentTrust(agent.id, { blocked: !agent.blocked });
    await load();
  };

  const removeAgent = async (agent: NetworkAgentData) => {
    await api.removeNetworkAgent(agent.id);
    await load();
  };

  const delegateTask = async () => {
    if (!selectedAgentId) return;
    setSaving(true);
    setLastError(null);
    try {
      await api.delegateNetworkTask(selectedAgentId, {
        description: taskDescription.trim(),
        requiredCapabilities: commaList(taskCapabilities),
        payload: parsePayload(taskPayload),
      });
      setTaskDescription("");
      toast.success("Task request sent");
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <h1>Network</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px" }}>
            {loading ? "Loading..." : `${agents.length} remote agents`}
          </p>
        </div>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {lastError && <div className="alert error">{lastError}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
        }}
      >
        <StatTile label="Agents" value={status?.totalAgents ?? 0} />
        <StatTile label="Available" value={status?.availableAgents ?? 0} />
        <StatTile label="Trusted" value={status?.trustedAgents ?? 0} />
        <StatTile label="Avg Load" value={formatPercent(status?.averageLoad ?? 0)} />
        <StatTile label="Messages 1h" value={status?.messagesLastHour ?? 0} />
        <StatTile label="Errors 1h" value={status?.errorsLastHour ?? 0} />
      </div>

      <section style={{ display: "grid", gap: "12px" }}>
        <h2 style={{ fontSize: "18px" }}>Topology</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "10px",
          }}
        >
          <div className="card" style={{ padding: "14px", borderRadius: "8px" }}>
            <strong>Primary Agent</strong>
            <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
              local / orchestrator
            </div>
          </div>
          {agents.map((agent) => (
            <AgentNode key={agent.id} agent={agent} />
          ))}
        </div>
      </section>

      <div className="pipeline-layout">
        <section className="card" style={{ padding: "16px", borderRadius: "8px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Register Agent</h2>
          <div style={{ display: "grid", gap: "10px" }}>
            <div className="form-group">
              <label>Agent ID</label>
              <input
                value={agentForm.agentId}
                onChange={(e) => setAgentForm((form) => ({ ...form, agentId: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Name</label>
              <input
                value={agentForm.name}
                onChange={(e) => setAgentForm((form) => ({ ...form, name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Endpoint</label>
              <input
                value={agentForm.endpoint}
                placeholder="https://agent.example.com/api/agent-network"
                onChange={(e) => setAgentForm((form) => ({ ...form, endpoint: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Capabilities</label>
              <input
                value={agentForm.capabilities}
                placeholder="web-search, summarization"
                onChange={(e) =>
                  setAgentForm((form) => ({ ...form, capabilities: e.target.value }))
                }
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: "10px",
              }}
            >
              <div className="form-group">
                <label>Status</label>
                <select
                  value={agentForm.status}
                  onChange={(e) =>
                    setAgentForm((form) => ({
                      ...form,
                      status: e.target.value as NetworkAgentStatus,
                    }))
                  }
                >
                  {AGENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Load</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={agentForm.load}
                  onChange={(e) => setAgentForm((form) => ({ ...form, load: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Trust</label>
                <select
                  value={agentForm.trustLevel}
                  onChange={(e) =>
                    setAgentForm((form) => ({
                      ...form,
                      trustLevel: e.target.value as NetworkTrustLevel,
                    }))
                  }
                >
                  {TRUST_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Public Key</label>
              <textarea
                value={agentForm.publicKey}
                rows={4}
                onChange={(e) => setAgentForm((form) => ({ ...form, publicKey: e.target.value }))}
                style={{ width: "100%", minHeight: "96px", resize: "vertical" }}
              />
            </div>
            <button onClick={registerAgent} disabled={saving}>
              Save Agent
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gap: "14px", minWidth: 0 }}>
          <div className="card" style={{ padding: "16px", borderRadius: "8px" }}>
            <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Task Delegation</h2>
            <div style={{ display: "grid", gap: "10px" }}>
              <div className="form-group">
                <label>Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                >
                  {selectableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Required Capabilities</label>
                <input
                  value={taskCapabilities}
                  placeholder="summarization"
                  onChange={(e) => setTaskCapabilities(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Payload JSON</label>
                <textarea
                  value={taskPayload}
                  rows={5}
                  onChange={(e) => setTaskPayload(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "130px",
                    resize: "vertical",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              </div>
              <button
                onClick={delegateTask}
                disabled={saving || !selectedAgentId || !taskDescription.trim()}
              >
                Send Task
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: "16px", borderRadius: "8px", minWidth: 0 }}>
            <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Remote Agents</h2>
            <div style={{ display: "grid", gap: "10px" }}>
              {agents.length === 0 && (
                <div style={{ color: "var(--text-secondary)" }}>No remote agents registered.</div>
              )}
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: "10px",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--separator)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: statusColor(agent.status),
                        }}
                      />
                      <strong style={{ overflowWrap: "anywhere" }}>{agent.name}</strong>
                    </div>
                    <div
                      style={{
                        marginTop: "4px",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {agent.endpoint}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "12px" }}>
                      {agent.capabilities.join(", ") || "-"}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "6px", justifyItems: "end" }}>
                    <select
                      value={agent.trustLevel}
                      onChange={(e) => void updateTrust(agent, e.target.value as NetworkTrustLevel)}
                    >
                      {TRUST_LEVELS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => void toggleBlocked(agent)}
                      >
                        {agent.blocked ? "Unblock" : "Block"}
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => void removeAgent(agent)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ padding: "16px", borderRadius: "8px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Message Log</h2>
        <div style={{ display: "grid", gap: "8px" }}>
          {messages.length === 0 && (
            <div style={{ color: "var(--text-secondary)" }}>No network messages recorded.</div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: "10px",
                padding: "10px 0",
                borderBottom: "1px solid var(--separator)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: statusColor(message.status),
                    }}
                  />
                  <strong>{message.type}</strong>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {message.from} to {message.to}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "4px",
                    color: "var(--text-secondary)",
                    fontSize: "12px",
                    overflowWrap: "anywhere",
                  }}
                >
                  {message.correlationId}
                </div>
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: "12px", textAlign: "right" }}>
                <div>{message.status}</div>
                <div>{formatTime(message.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
