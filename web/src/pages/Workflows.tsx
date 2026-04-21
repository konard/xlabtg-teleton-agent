import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import type {
  WorkflowData,
  WorkflowConfig,
  WorkflowTrigger,
  WorkflowAction,
  CronTrigger,
  WebhookTrigger,
  EventTrigger,
  SendMessageAction,
  CallApiAction,
  SetVariableAction,
} from "../lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function triggerLabel(trigger: WorkflowTrigger): string {
  if (trigger.type === "cron") {
    return (trigger as CronTrigger).label || `Cron: ${(trigger as CronTrigger).cron}`;
  }
  if (trigger.type === "webhook")
    return (trigger as WebhookTrigger).secret
      ? `Webhook (POST /api/workflows/webhook/${(trigger as WebhookTrigger).secret})`
      : "Webhook";
  if (trigger.type === "event") return `Event: ${(trigger as EventTrigger).event}`;
  return "Unknown trigger";
}

function actionLabel(action: WorkflowAction): string {
  if (action.type === "send_message")
    return `Send message to ${(action as SendMessageAction).chatId}`;
  if (action.type === "call_api")
    return `${(action as CallApiAction).method} ${(action as CallApiAction).url}`;
  if (action.type === "set_variable") return `Set ${(action as SetVariableAction).name}`;
  return "Unknown action";
}

// ── Default empty config ─────────────────────────────────────────────────────

function defaultConfig(): WorkflowConfig {
  return {
    trigger: { type: "cron", cron: "0 9 * * 1", label: "Every Monday at 9:00 UTC" },
    actions: [],
  };
}

// ── TriggerEditor ─────────────────────────────────────────────────────────────

function TriggerEditor({
  trigger,
  onChange,
}: {
  trigger: WorkflowTrigger;
  onChange: (t: WorkflowTrigger) => void;
}) {
  const handleTypeChange = (type: WorkflowTrigger["type"]) => {
    if (type === "cron") onChange({ type: "cron", cron: "0 9 * * 1", label: "" });
    else if (type === "webhook") onChange({ type: "webhook" });
    else onChange({ type: "event", event: "agent.start" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <label
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            display: "block",
            marginBottom: "4px",
          }}
        >
          Trigger Type
        </label>
        <select
          value={trigger.type}
          onChange={(e) => handleTypeChange(e.target.value as WorkflowTrigger["type"])}
          style={{ width: "100%" }}
        >
          <option value="cron">Time-based (Cron)</option>
          <option value="webhook">Webhook</option>
          <option value="event">Event</option>
        </select>
      </div>

      {trigger.type === "cron" && (
        <>
          <div>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Cron Expression
            </label>
            <input
              type="text"
              value={(trigger as CronTrigger).cron}
              onChange={(e) => onChange({ ...trigger, cron: e.target.value } as CronTrigger)}
              placeholder="0 9 * * 1"
              style={{ width: "100%", fontFamily: "monospace" }}
            />
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Format: minute hour day month weekday — e.g. "0 9 * * 1" = every Monday at 9am
            </div>
          </div>
          <div>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Label (optional)
            </label>
            <input
              type="text"
              value={(trigger as CronTrigger).label ?? ""}
              onChange={(e) => onChange({ ...trigger, label: e.target.value } as CronTrigger)}
              placeholder="Every Monday at 9:00 UTC"
              style={{ width: "100%" }}
            />
          </div>
        </>
      )}

      {trigger.type === "webhook" && (
        <div
          style={{
            padding: "10px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.04)",
            fontSize: "13px",
          }}
        >
          A unique webhook URL will be available at{" "}
          <code>/api/workflows/webhook/&#123;secret&#125;</code> once saved. POST to this URL to
          trigger the workflow.
        </div>
      )}

      {trigger.type === "event" && (
        <div>
          <label
            style={{
              fontSize: "12px",
              color: "var(--text-secondary)",
              display: "block",
              marginBottom: "4px",
            }}
          >
            Event
          </label>
          <select
            value={(trigger as EventTrigger).event}
            onChange={(e) => onChange({ ...trigger, event: e.target.value } as EventTrigger)}
            style={{ width: "100%" }}
          >
            <option value="agent.start">Agent started</option>
            <option value="agent.stop">Agent stopped</option>
            <option value="agent.error">Agent error</option>
            <option value="tool.complete">Tool completed</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ── ActionEditor ──────────────────────────────────────────────────────────────

function ActionEditor({
  action,
  index,
  onChange,
  onRemove,
}: {
  action: WorkflowAction;
  index: number;
  onChange: (a: WorkflowAction) => void;
  onRemove: () => void;
}) {
  const handleTypeChange = (type: WorkflowAction["type"]) => {
    if (type === "send_message") onChange({ type: "send_message", chatId: "", text: "" });
    else if (type === "call_api") onChange({ type: "call_api", method: "GET", url: "" });
    else onChange({ type: "set_variable", name: "", value: "" });
  };

  return (
    <div
      style={{
        padding: "12px",
        border: "1px solid var(--separator)",
        borderRadius: "8px",
        background: "rgba(255,255,255,0.02)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          Action {index + 1}
        </span>
        <button
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            color: "var(--red, #d9534f)",
            fontSize: "14px",
            opacity: 0.6,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.6";
          }}
          title="Remove action"
        >
          &#x2715;
        </button>
      </div>

      <div>
        <label
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            display: "block",
            marginBottom: "4px",
          }}
        >
          Action Type
        </label>
        <select
          value={action.type}
          onChange={(e) => handleTypeChange(e.target.value as WorkflowAction["type"])}
          style={{ width: "100%" }}
        >
          <option value="send_message">Send Telegram message</option>
          <option value="call_api">Call external API</option>
          <option value="set_variable">Set variable</option>
        </select>
      </div>

      {action.type === "send_message" && (
        <>
          <div>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Chat ID or username
            </label>
            <input
              type="text"
              value={(action as SendMessageAction).chatId}
              onChange={(e) => onChange({ ...action, chatId: e.target.value } as SendMessageAction)}
              placeholder="@username or 123456789"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Message text
            </label>
            <textarea
              value={(action as SendMessageAction).text}
              onChange={(e) => onChange({ ...action, text: e.target.value } as SendMessageAction)}
              placeholder="Your message here..."
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        </>
      )}

      {action.type === "call_api" && (
        <>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: "0 0 100px" }}>
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  display: "block",
                  marginBottom: "4px",
                }}
              >
                Method
              </label>
              <select
                value={(action as CallApiAction).method}
                onChange={(e) => onChange({ ...action, method: e.target.value } as CallApiAction)}
                style={{ width: "100%" }}
              >
                {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  display: "block",
                  marginBottom: "4px",
                }}
              >
                URL
              </label>
              <input
                type="text"
                value={(action as CallApiAction).url}
                onChange={(e) => onChange({ ...action, url: e.target.value } as CallApiAction)}
                placeholder="https://example.com/api/endpoint"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Body (JSON, optional)
            </label>
            <textarea
              value={(action as CallApiAction).body ?? ""}
              onChange={(e) =>
                onChange({ ...action, body: e.target.value || undefined } as CallApiAction)
              }
              placeholder='{"key": "value"}'
              rows={2}
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
            />
          </div>
        </>
      )}

      {action.type === "set_variable" && (
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Variable name
            </label>
            <input
              type="text"
              value={(action as SetVariableAction).name}
              onChange={(e) => onChange({ ...action, name: e.target.value } as SetVariableAction)}
              placeholder="my_variable"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Value
            </label>
            <input
              type="text"
              value={(action as SetVariableAction).value}
              onChange={(e) => onChange({ ...action, value: e.target.value } as SetVariableAction)}
              placeholder="some value"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── WorkflowForm ──────────────────────────────────────────────────────────────

interface WorkflowFormProps {
  initial?: WorkflowData | null;
  saving: boolean;
  onSave: (data: {
    name: string;
    description: string;
    enabled: boolean;
    config: WorkflowConfig;
  }) => void;
  onCancel: () => void;
}

function WorkflowForm({ initial, saving, onSave, onCancel }: WorkflowFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [config, setConfig] = useState<WorkflowConfig>(initial?.config ?? defaultConfig());

  const handleTriggerChange = (trigger: WorkflowTrigger) => {
    setConfig((prev) => ({ ...prev, trigger }));
  };

  const handleActionChange = (index: number, action: WorkflowAction) => {
    setConfig((prev) => {
      const actions = [...prev.actions];
      actions[index] = action;
      return { ...prev, actions };
    });
  };

  const handleRemoveAction = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  };

  const handleAddAction = () => {
    setConfig((prev) => ({
      ...prev,
      actions: [...prev.actions, { type: "send_message", chatId: "", text: "" }],
    }));
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), enabled, config });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Basic info */}
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <label
            style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "4px" }}
          >
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workflow"
            maxLength={100}
            style={{ width: "100%" }}
            autoFocus
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingTop: "24px" }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Enabled</span>
        </div>
      </div>

      <div>
        <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          maxLength={500}
          style={{ width: "100%" }}
        />
      </div>

      {/* Trigger */}
      <div className="card" style={{ padding: "14px" }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#6ea8fe",
            marginBottom: "10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#6ea8fe",
            }}
          />
          Trigger
        </div>
        <TriggerEditor trigger={config.trigger} onChange={handleTriggerChange} />
      </div>

      {/* Actions */}
      <div className="card" style={{ padding: "14px" }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#5cb85c",
            marginBottom: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#5cb85c",
              }}
            />
            Actions
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 400 }}>
            {config.actions.length}/10
          </span>
        </div>

        {config.actions.length === 0 && (
          <div
            style={{
              padding: "16px",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "13px",
              border: "1px dashed var(--separator)",
              borderRadius: "6px",
              marginBottom: "10px",
            }}
          >
            No actions yet. Add at least one action to execute when triggered.
          </div>
        )}

        <div
          style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "10px" }}
        >
          {config.actions.map((action, i) => (
            <ActionEditor
              key={i}
              action={action}
              index={i}
              onChange={(a) => handleActionChange(i, a)}
              onRemove={() => handleRemoveAction(i)}
            />
          ))}
        </div>

        {config.actions.length < 10 && (
          <button className="btn-ghost btn-sm" onClick={handleAddAction}>
            + Add Action
          </button>
        )}
      </div>

      {/* Submit */}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !name.trim()}
          style={{ minWidth: "80px" }}
        >
          {saving ? "Saving..." : initial ? "Save Changes" : "Create Workflow"}
        </button>
      </div>
    </div>
  );
}

// ── WorkflowRow ───────────────────────────────────────────────────────────────

function WorkflowRow({
  workflow,
  onEdit,
  onToggle,
  onDelete,
}: {
  workflow: WorkflowData;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        tabIndex={0}
        role="button"
        style={{
          cursor: "pointer",
          borderBottom: expanded ? "none" : "1px solid var(--separator)",
          backgroundColor: expanded ? "rgba(255,255,255,0.03)" : undefined,
          opacity: workflow.enabled ? 1 : 0.55,
        }}
        className="file-row"
      >
        <td style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-secondary)", width: "14px" }}>
              {expanded ? "▼" : "▶"}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>{workflow.name}</div>
              {workflow.description && (
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  {workflow.description}
                </div>
              )}
            </div>
          </div>
        </td>
        <td style={{ padding: "10px 14px", fontSize: "12px", color: "var(--text-secondary)" }}>
          {triggerLabel(workflow.config.trigger)}
        </td>
        <td
          style={{
            padding: "10px 14px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {workflow.config.actions.length}
        </td>
        <td
          style={{
            padding: "10px 14px",
            textAlign: "right",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {formatDate(workflow.lastRunAt)}
        </td>
        <td
          style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          <label className="toggle" style={{ marginRight: "8px" }}>
            <input
              type="checkbox"
              checked={workflow.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
          <button
            className="btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            style={{ fontSize: "12px", marginRight: "4px" }}
          >
            Edit
          </button>
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete workflow"
          >
            &#128465;
          </button>
        </td>
      </tr>

      {expanded && (
        <tr
          style={{
            backgroundColor: "rgba(255,255,255,0.02)",
            borderBottom: "1px solid var(--separator)",
          }}
        >
          <td colSpan={5} style={{ padding: "0 14px 14px 42px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "6px 12px",
                fontSize: "13px",
                paddingTop: "10px",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>ID</span>
              <code style={{ fontSize: "11px", wordBreak: "break-all" }}>{workflow.id}</code>

              <span style={{ color: "var(--text-secondary)" }}>Trigger</span>
              <span>{triggerLabel(workflow.config.trigger)}</span>

              <span style={{ color: "var(--text-secondary)" }}>Actions</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {workflow.config.actions.length === 0 ? (
                  <span style={{ color: "var(--text-secondary)" }}>None</span>
                ) : (
                  workflow.config.actions.map((a, i) => (
                    <span key={i} style={{ fontSize: "12px" }}>
                      {i + 1}. {actionLabel(a)}
                    </span>
                  ))
                )}
              </div>

              <span style={{ color: "var(--text-secondary)" }}>Runs</span>
              <span>{workflow.runCount}</span>

              <span style={{ color: "var(--text-secondary)" }}>Last run</span>
              <span>{formatDate(workflow.lastRunAt)}</span>

              <span style={{ color: "var(--text-secondary)" }}>Created</span>
              <span>{formatDate(workflow.createdAt)}</span>

              {workflow.lastError && (
                <>
                  <span style={{ color: "var(--text-secondary)" }}>Last error</span>
                  <code
                    style={{
                      fontSize: "11px",
                      color: "#f99",
                      background: "rgba(100,0,0,0.15)",
                      padding: "4px 6px",
                      borderRadius: "4px",
                      wordBreak: "break-word",
                    }}
                  >
                    {workflow.lastError}
                  </code>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Workflows page ────────────────────────────────────────────────────────────

export function Workflows() {
  const [workflows, setWorkflows] = useState<WorkflowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal state: null = list view, 'create' = new workflow, WorkflowData = editing
  const [modal, setModal] = useState<null | "create" | WorkflowData>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.workflowsList();
      setWorkflows(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleCreate = async (data: {
    name: string;
    description: string;
    enabled: boolean;
    config: WorkflowConfig;
  }) => {
    setSaving(true);
    try {
      const res = await api.workflowsCreate({
        name: data.name,
        description: data.description || undefined,
        enabled: data.enabled,
        config: data.config,
      });
      setWorkflows((prev) => [res.data!, ...prev]);
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (
    id: string,
    data: { name: string; description: string; enabled: boolean; config: WorkflowConfig }
  ) => {
    setSaving(true);
    try {
      const res = await api.workflowsUpdate(id, {
        name: data.name,
        description: data.description || null,
        enabled: data.enabled,
        config: data.config,
      });
      setWorkflows((prev) => prev.map((w) => (w.id === id ? res.data! : w)));
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.workflowsToggle(id, enabled);
      setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, enabled } : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.workflowsDelete(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="header">
        <h1>Workflows</h1>
        <p>Automate actions with time-based, webhook, and event triggers</p>
      </div>

      {error && (
        <div
          className="alert error"
          style={{
            marginBottom: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button className="btn-ghost btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Create / Edit modal */}
      {modal !== null && (
        <div className="modal-overlay" onClick={() => !saving && setModal(null)}>
          <div
            className="modal"
            style={{ maxWidth: "600px", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "16px" }}>
              {modal === "create" ? "Create Workflow" : `Edit: ${(modal as WorkflowData).name}`}
            </h2>
            <WorkflowForm
              initial={modal === "create" ? null : (modal as WorkflowData)}
              saving={saving}
              onSave={(data) => {
                if (modal === "create") {
                  handleCreate(data);
                } else {
                  handleUpdate((modal as WorkflowData).id, data);
                }
              }}
              onCancel={() => setModal(null)}
            />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="card"
        style={{
          padding: "10px 14px",
          marginBottom: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
          {workflows.filter((w) => w.enabled).length > 0 && (
            <> · {workflows.filter((w) => w.enabled).length} active</>
          )}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            style={{ padding: "4px 12px", fontSize: "12px", opacity: 0.7 }}
            onClick={loadWorkflows}
          >
            Refresh
          </button>
          <button onClick={() => setModal("create")}>+ New Workflow</button>
        </div>
      </div>

      {/* Workflow list */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: "20px", textAlign: "center" }}>Loading...</div>
        ) : workflows.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              No workflows yet
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Create your first workflow to automate actions with triggers and conditions.
            </div>
            <button onClick={() => setModal("create")}>+ Create Workflow</button>
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--separator)",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                <th style={{ textAlign: "left", padding: "8px 14px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 14px", width: 220 }}>Trigger</th>
                <th style={{ textAlign: "center", padding: "8px 14px", width: 80 }}>Actions</th>
                <th style={{ textAlign: "right", padding: "8px 14px", width: 130 }}>Last Run</th>
                <th style={{ textAlign: "right", padding: "8px 14px", width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <WorkflowRow
                  key={wf.id}
                  workflow={wf}
                  onEdit={() => setModal(wf)}
                  onToggle={(enabled) => handleToggle(wf.id, enabled)}
                  onDelete={() => handleDelete(wf.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info section */}
      <div
        className="card"
        style={{
          padding: "14px 16px",
          marginTop: "16px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        <div
          style={{ fontWeight: 600, marginBottom: "8px", fontSize: "13px", color: "var(--text)" }}
        >
          About Workflows
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <div>
            <div style={{ fontWeight: 600, color: "#6ea8fe", marginBottom: "4px" }}>Triggers</div>
            <div>
              <strong>Time-based</strong> — cron schedule (e.g. every Monday at 9am)
            </div>
            <div>
              <strong>Webhook</strong> — external HTTP request
            </div>
            <div>
              <strong>Event</strong> — agent lifecycle events
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "#5cb85c", marginBottom: "4px" }}>Actions</div>
            <div>
              <strong>Send message</strong> — send text to a Telegram chat
            </div>
            <div>
              <strong>Call API</strong> — HTTP request to any URL
            </div>
            <div>
              <strong>Set variable</strong> — store a value for later use
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "#f0ad4e", marginBottom: "4px" }}>Limits</div>
            <div>Max 100 workflows</div>
            <div>Max 10 actions per workflow</div>
            <div>Cron format: minute hour day month weekday</div>
          </div>
        </div>
      </div>
    </div>
  );
}
