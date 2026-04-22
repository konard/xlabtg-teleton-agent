import { useEffect, useState, useCallback, useRef } from "react";
import {
  api,
  type AutonomousTaskData,
  type AutonomousTaskDetail,
  type AutonomousTaskStatus,
  type AutonomousStrategy,
  type AutonomousPriority,
  type AutonomousEventType,
  type AutonomousCreateInput,
  type AutonomousParsedGoal,
} from "../lib/api";
import { useConfirm } from "../components/ConfirmDialog";
import { NaturalLanguageParser } from "../components/NaturalLanguageParser";

const STATUS_COLORS: Record<AutonomousTaskStatus, string> = {
  pending: "#f0ad4e",
  queued: "#c87941",
  running: "#5bc0de",
  paused: "#9b9b9b",
  completed: "#5cb85c",
  failed: "#d9534f",
  cancelled: "#777",
};

const STATUS_LABELS: Record<AutonomousTaskStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const EVENT_COLORS: Record<AutonomousEventType, string> = {
  plan: "#5bc0de",
  tool_call: "#7b68ee",
  tool_result: "#20c997",
  reflect: "#9b59b6",
  checkpoint: "#6c757d",
  escalate: "#f0ad4e",
  error: "#d9534f",
  info: "#868e96",
};

const PRIORITY_OPTIONS: AutonomousPriority[] = ["low", "medium", "high", "critical"];
const STRATEGY_OPTIONS: AutonomousStrategy[] = ["conservative", "balanced", "aggressive"];

function StatusBadge({ status }: { status: AutonomousTaskStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "10px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: STATUS_COLORS[status],
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ProgressBar({ task }: { task: AutonomousTaskData }) {
  const max = task.constraints.maxIterations ?? 0;
  const pct = max > 0 ? Math.min(100, Math.round((task.currentStep / max) * 100)) : null;
  const indeterminate = pct === null && task.status === "running";

  const barColor = STATUS_COLORS[task.status];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "160px" }}>
      <div
        style={{
          flex: 1,
          height: "8px",
          backgroundColor: "var(--separator)",
          borderRadius: "4px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {pct !== null ? (
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              backgroundColor: barColor,
              transition: "width 300ms ease",
            }}
          />
        ) : indeterminate ? (
          <div
            className="autonomous-indeterminate-bar"
            style={{ height: "100%", backgroundColor: barColor }}
          />
        ) : (
          <div style={{ width: "0%", height: "100%" }} />
        )}
      </div>
      <span
        style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}
        title={
          max > 0 ? `${task.currentStep} / ${max} iterations` : `${task.currentStep} iterations`
        }
      >
        {max > 0 ? `${task.currentStep}/${max}` : `#${task.currentStep}`}
      </span>
    </div>
  );
}

interface CreateFormState {
  goal: string;
  priority: AutonomousPriority;
  strategy: AutonomousStrategy;
  successCriteria: string;
  failureConditions: string;
  allowedTools: string;
  restrictedTools: string;
  maxIterations: string;
  maxDurationHours: string;
  budgetTON: string;
  maxRetries: string;
  backoff: "linear" | "exponential";
}

const EMPTY_FORM: CreateFormState = {
  goal: "",
  priority: "medium",
  strategy: "balanced",
  successCriteria: "",
  failureConditions: "",
  allowedTools: "",
  restrictedTools: "",
  maxIterations: "50",
  maxDurationHours: "8",
  budgetTON: "",
  maxRetries: "3",
  backoff: "exponential",
};

function linesToArray(value: string): string[] | undefined {
  const arr = value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function buildPayload(form: CreateFormState): AutonomousCreateInput | { error: string } {
  if (!form.goal.trim()) {
    return { error: "Goal is required" };
  }

  const constraints: AutonomousCreateInput["constraints"] = {};
  const mi = numberOrUndefined(form.maxIterations);
  if (mi !== undefined) constraints.maxIterations = mi;
  const md = numberOrUndefined(form.maxDurationHours);
  if (md !== undefined) constraints.maxDurationHours = md;
  const bt = numberOrUndefined(form.budgetTON);
  if (bt !== undefined) constraints.budgetTON = bt;
  const allowed = linesToArray(form.allowedTools);
  if (allowed) constraints.allowedTools = allowed;
  const restricted = linesToArray(form.restrictedTools);
  if (restricted) constraints.restrictedTools = restricted;

  const payload: AutonomousCreateInput = {
    goal: form.goal.trim(),
    priority: form.priority,
    strategy: form.strategy,
    successCriteria: linesToArray(form.successCriteria),
    failureConditions: linesToArray(form.failureConditions),
  };

  if (Object.keys(constraints).length > 0) {
    payload.constraints = constraints;
  }

  const retries = numberOrUndefined(form.maxRetries);
  if (retries !== undefined) {
    payload.retryPolicy = { maxRetries: retries, backoff: form.backoff };
  }

  return payload;
}

function applyParsedGoal(form: CreateFormState, parsed: AutonomousParsedGoal): CreateFormState {
  const next: CreateFormState = { ...form };
  if (parsed.goal) next.goal = parsed.goal;
  if (parsed.successCriteria.length > 0) {
    next.successCriteria = parsed.successCriteria.join("\n");
  }
  if (parsed.failureConditions.length > 0) {
    next.failureConditions = parsed.failureConditions.join("\n");
  }
  next.strategy = parsed.suggestedStrategy;
  next.priority = parsed.suggestedPriority;
  if (parsed.constraints.maxIterations !== undefined) {
    next.maxIterations = String(parsed.constraints.maxIterations);
  }
  if (parsed.constraints.maxDurationHours !== undefined) {
    next.maxDurationHours = String(parsed.constraints.maxDurationHours);
  }
  if (parsed.constraints.budgetTON !== undefined) {
    next.budgetTON = String(parsed.constraints.budgetTON);
  }
  if (parsed.constraints.allowedTools && parsed.constraints.allowedTools.length > 0) {
    next.allowedTools = parsed.constraints.allowedTools.join("\n");
  }
  if (parsed.constraints.restrictedTools && parsed.constraints.restrictedTools.length > 0) {
    next.restrictedTools = parsed.constraints.restrictedTools.join("\n");
  }
  return next;
}

function CreateTaskForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleParsed = (parsed: AutonomousParsedGoal) => {
    setForm((prev) => applyParsedGoal(prev, parsed));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = buildPayload(form);
    if ("error" in payload) {
      setError(payload.error);
      return;
    }

    setSubmitting(true);
    try {
      await api.autonomousCreate(payload);
      setForm(EMPTY_FORM);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="card"
      style={{ padding: "16px", marginBottom: "14px" }}
    >
      <h3 style={{ marginTop: 0, marginBottom: "12px" }}>New autonomous task</h3>

      <NaturalLanguageParser onParsed={handleParsed} disabled={submitting} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          margin: "4px 0 14px 0",
          fontSize: "11px",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <div style={{ flex: 1, height: "1px", backgroundColor: "var(--separator)" }} />
        <span>or fill manually</span>
        <div style={{ flex: 1, height: "1px", backgroundColor: "var(--separator)" }} />
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div className="form-group">
        <label>
          Goal <span style={{ color: "#d9534f" }}>*</span>
        </label>
        <textarea
          value={form.goal}
          onChange={(e) => update("goal", e.target.value)}
          placeholder="e.g. Monitor new DeDust pools every 5 minutes and report to @channel"
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
          required
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="form-group">
          <label title="How eagerly the agent acts without confirmation">Strategy</label>
          <select
            value={form.strategy}
            onChange={(e) => update("strategy", e.target.value as AutonomousStrategy)}
            style={{ width: "100%" }}
          >
            {STRATEGY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label title="Relative ordering for the task queue">Priority</label>
          <select
            value={form.priority}
            onChange={(e) => update("priority", e.target.value as AutonomousPriority)}
            style={{ width: "100%" }}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="form-group">
          <label title="Each bullet = one criterion that must be satisfied">
            Success criteria (one per line)
          </label>
          <textarea
            value={form.successCriteria}
            onChange={(e) => update("successCriteria", e.target.value)}
            placeholder={"recorded ≥1 pool\nreport sent to @channel"}
            rows={3}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        <div className="form-group">
          <label title="Automatically marks the task as failed if any condition holds">
            Failure conditions (one per line)
          </label>
          <textarea
            value={form.failureConditions}
            onChange={(e) => update("failureConditions", e.target.value)}
            placeholder={"3 consecutive errors\nbudget exceeded"}
            rows={3}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <div className="form-group">
          <label title="Cap on loop iterations before the task is forced to fail">
            Max iterations
          </label>
          <input
            type="number"
            min="1"
            value={form.maxIterations}
            onChange={(e) => update("maxIterations", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <div className="form-group">
          <label title="Soft time budget for the whole task">Max duration (hours)</label>
          <input
            type="number"
            min="0"
            step="0.25"
            value={form.maxDurationHours}
            onChange={(e) => update("maxDurationHours", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <div className="form-group">
          <label title="Hard cap on TON spending across the whole task (optional)">
            Budget (TON)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.budgetTON}
            onChange={(e) => update("budgetTON", e.target.value)}
            placeholder="unlimited"
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="form-group">
          <label title="Whitelist — only these tools may be called">
            Allowed tools (one per line)
          </label>
          <textarea
            value={form.allowedTools}
            onChange={(e) => update("allowedTools", e.target.value)}
            placeholder="leave blank to allow all"
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        <div className="form-group">
          <label title="Blacklist — these tools require user confirmation">
            Restricted tools (one per line)
          </label>
          <textarea
            value={form.restrictedTools}
            onChange={(e) => update("restrictedTools", e.target.value)}
            placeholder={"ton_send\njetton_send"}
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="form-group">
          <label>Retry max attempts</label>
          <input
            type="number"
            min="0"
            value={form.maxRetries}
            onChange={(e) => update("maxRetries", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div className="form-group">
          <label>Retry backoff</label>
          <select
            value={form.backoff}
            onChange={(e) => update("backoff", e.target.value as "linear" | "exponential")}
            style={{ width: "100%" }}
          >
            <option value="linear">linear</option>
            <option value="exponential">exponential</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create task"}
        </button>
      </div>
    </form>
  );
}

function TaskDetailPanel({
  taskId,
  onClose,
  onChange,
}: {
  taskId: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { confirm } = useConfirm();
  const [detail, setDetail] = useState<AutonomousTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextInput, setContextInput] = useState("");
  const [contextError, setContextError] = useState<string | null>(null);
  const [injecting, setInjecting] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.autonomousGet(taskId);
      setDetail(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const isActive = detail.status === "running" || detail.status === "pending" || detail.status === "queued";
    if (!isActive) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [detail, load]);

  useEffect(() => {
    if (autoScrollRef.current && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [detail?.executionLogs.length]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  const injectContext = async () => {
    setContextError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(contextInput);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Context must be a JSON object");
      }
    } catch (err) {
      setContextError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }

    setInjecting(true);
    try {
      await api.autonomousInjectContext(taskId, parsed);
      setContextInput("");
      await load();
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      setInjecting(false);
    }
  };

  const deleteTask = async () => {
    if (
      !(await confirm({
        title: "Delete task?",
        description: "Task, checkpoints and logs will be removed. This cannot be undone.",
        variant: "danger",
        confirmText: "Delete",
      }))
    )
      return;
    try {
      await api.autonomousDelete(taskId);
      onChange();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: "16px" }}>
        Loading task…
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert error" style={{ marginBottom: "12px" }}>
        {error}
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="card" style={{ padding: "16px", marginBottom: "14px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "10px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <StatusBadge status={detail.status} />
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              priority: {detail.priority} · strategy: {detail.strategy}
            </span>
          </div>
          <h3 style={{ margin: "8px 0 4px 0", wordBreak: "break-word" }}>{detail.goal}</h3>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            id: <code>{detail.id}</code>
          </div>
        </div>
        <button className="btn-ghost" onClick={onClose} title="Close details" aria-label="Close">
          ✕
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "8px",
          fontSize: "12px",
          marginBottom: "12px",
        }}
      >
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Current step</div>
          <div>{detail.currentStep}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Max iterations</div>
          <div>{detail.constraints.maxIterations ?? "—"}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Budget (TON)</div>
          <div>{detail.constraints.budgetTON ?? "—"}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Created</div>
          <div>{formatDate(detail.createdAt)}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Started</div>
          <div>{formatDate(detail.startedAt)}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)" }}>Completed</div>
          <div>{formatDate(detail.completedAt)}</div>
        </div>
      </div>

      {detail.successCriteria.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
            Success criteria
          </div>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
            {detail.successCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {detail.result && (
        <div className="alert success" style={{ marginBottom: "10px" }}>
          <strong>Result:</strong> {detail.result}
        </div>
      )}

      {detail.error && (
        <div className="alert error" style={{ marginBottom: "10px" }}>
          <strong>Error:</strong> {detail.error}
        </div>
      )}

      <div style={{ marginBottom: "10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Execution log ({detail.executionLogs.length})
          </div>
          <button className="btn-ghost btn-sm" onClick={load} title="Refresh logs">
            Refresh
          </button>
        </div>
        <div
          onScroll={handleScroll}
          style={{
            maxHeight: "260px",
            overflowY: "auto",
            backgroundColor: "var(--bg-secondary, rgba(0,0,0,0.04))",
            borderRadius: "6px",
            border: "1px solid var(--separator)",
            padding: "8px",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "12px",
            lineHeight: 1.5,
          }}
        >
          {detail.executionLogs.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
              No execution events yet.
            </div>
          ) : (
            detail.executionLogs.map((log) => (
              <div key={log.id} style={{ marginBottom: "2px" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>{" "}
                <span
                  style={{
                    color: EVENT_COLORS[log.eventType],
                    fontWeight: 600,
                    textTransform: "uppercase",
                    fontSize: "10px",
                  }}
                >
                  [{log.eventType}]
                </span>{" "}
                <span>step {log.step}:</span> {log.message}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {(detail.status === "running" ||
        detail.status === "pending" ||
        detail.status === "queued" ||
        detail.status === "paused") && (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
            Inject context (JSON object)
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={contextInput}
              onChange={(e) => setContextInput(e.target.value)}
              placeholder='{"note": "skip retries"}'
              style={{ flex: 1, fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}
            />
            <button
              onClick={injectContext}
              disabled={injecting || !contextInput.trim()}
              className="btn-sm"
            >
              {injecting ? "Injecting..." : "Inject"}
            </button>
          </div>
          {contextError && (
            <div className="alert error" style={{ marginTop: "6px" }}>
              {contextError}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
        <button onClick={deleteTask} className="btn-danger btn-sm">
          Delete task
        </button>
      </div>
    </div>
  );
}

export function Autonomous() {
  const { confirm } = useConfirm();
  const [tasks, setTasks] = useState<AutonomousTaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutonomousTaskStatus | "">("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autonomousEnabled, setAutonomousEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("teleton:autonomous-enabled") === "true";
    } catch {
      return false;
    }
  });

  const load = useCallback(async () => {
    try {
      const res = await api.autonomousList();
      setTasks(res.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "running" || t.status === "pending" || t.status === "queued");
    if (!hasActive) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [tasks, load]);

  const toggleAutonomous = () => {
    const next = !autonomousEnabled;
    setAutonomousEnabled(next);
    try {
      localStorage.setItem("teleton:autonomous-enabled", String(next));
    } catch {
      // ignore storage errors
    }
  };

  const runAction = async (
    fn: () => Promise<unknown>,
    confirmCfg?: Parameters<typeof confirm>[0]
  ) => {
    if (confirmCfg && !(await confirm(confirmCfg))) return;
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const counts = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const filtered = filter ? tasks.filter((t) => t.status === filter) : tasks;

  return (
    <div>
      <div
        className="header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <h1>Autonomous Mode</h1>
          <p>
            Self-managed tasks that decompose a goal, execute actions, and adapt — within configured
            guardrails.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label
            title={
              autonomousEnabled
                ? "Autonomous mode is enabled. New tasks will start automatically."
                : "Autonomous mode is disabled. Tasks stay pending until enabled."
            }
            style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
          >
            <span
              style={{
                fontSize: "13px",
                color: autonomousEnabled ? "var(--text)" : "var(--text-secondary)",
              }}
            >
              {autonomousEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              onClick={toggleAutonomous}
              role="switch"
              aria-checked={autonomousEnabled}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggleAutonomous();
                }
              }}
              style={{
                width: "40px",
                height: "22px",
                borderRadius: "11px",
                backgroundColor: autonomousEnabled ? "#5cb85c" : "var(--separator)",
                position: "relative",
                transition: "background-color 200ms",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: autonomousEnabled ? "20px" : "2px",
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                  transition: "left 200ms",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </span>
            <span style={{ fontSize: "13px" }}>🔄 Autonomous Mode</span>
          </label>

          <button onClick={() => setShowCreateForm(true)} disabled={showCreateForm}>
            + New task
          </button>
        </div>
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

      {!autonomousEnabled && tasks.some((t) => t.status === "pending") && (
        <div
          className="alert"
          style={{
            marginBottom: "14px",
            borderLeft: "3px solid #f0ad4e",
          }}
        >
          Autonomous Mode is disabled. Pending tasks will not start until you enable the toggle
          above.
        </div>
      )}

      {showCreateForm && (
        <CreateTaskForm
          onCreated={() => {
            setShowCreateForm(false);
            load();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div
        className="card"
        style={{
          padding: "10px 14px",
          marginBottom: "14px",
          display: "flex",
          gap: "16px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span
          onClick={() => setFilter("")}
          style={{
            cursor: "pointer",
            fontWeight: filter === "" ? "bold" : "normal",
            color: filter === "" ? "var(--text)" : "var(--text-secondary)",
            fontSize: "13px",
          }}
        >
          All ({tasks.length})
        </span>
        {(Object.keys(STATUS_LABELS) as AutonomousTaskStatus[]).map((s) => (
          <span
            key={s}
            onClick={() => setFilter(filter === s ? "" : s)}
            style={{
              cursor: "pointer",
              fontWeight: filter === s ? "bold" : "normal",
              color: filter === s ? STATUS_COLORS[s] : "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            {STATUS_LABELS[s]} ({counts[s] || 0})
          </span>
        ))}
      </div>

      {selectedId && (
        <TaskDetailPanel taskId={selectedId} onClose={() => setSelectedId(null)} onChange={load} />
      )}

      {loading && tasks.length === 0 ? (
        <div className="card" style={{ padding: "16px" }}>
          Loading tasks…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: "24px", textAlign: "center" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            {tasks.length === 0
              ? "No autonomous tasks yet. Click “+ New task” to create one."
              : "No tasks match the current filter."}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Goal</th>
                <th style={{ padding: "10px 12px" }}>Progress</th>
                <th style={{ padding: "10px 12px" }}>Strategy</th>
                <th style={{ padding: "10px 12px" }}>Created</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const canPause = task.status === "running" || task.status === "pending" || task.status === "queued";
                const canResume = task.status === "paused";
                const canStop =
                  task.status !== "completed" &&
                  task.status !== "failed" &&
                  task.status !== "cancelled";
                return (
                  <tr
                    key={task.id}
                    style={{
                      borderTop: "1px solid var(--separator)",
                      cursor: "pointer",
                      backgroundColor:
                        selectedId === task.id
                          ? "var(--bg-secondary, rgba(0,0,0,0.03))"
                          : undefined,
                    }}
                    onClick={() => setSelectedId(task.id)}
                  >
                    <td style={{ padding: "10px 12px" }}>
                      <StatusBadge status={task.status} />
                    </td>
                    <td style={{ padding: "10px 12px", maxWidth: "320px" }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={task.goal}
                      >
                        {task.goal}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <ProgressBar task={task} />
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                      }}
                    >
                      {task.strategy}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                      }}
                    >
                      {formatDate(task.createdAt)}
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn-ghost btn-sm"
                        disabled={!canPause}
                        onClick={() => runAction(() => api.autonomousPause(task.id))}
                        title="Pause"
                      >
                        ⏸
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={!canResume}
                        onClick={() => runAction(() => api.autonomousResume(task.id))}
                        title="Resume"
                      >
                        ▶
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={!canStop}
                        onClick={() =>
                          runAction(() => api.autonomousStop(task.id), {
                            title: "Stop task?",
                            description: "The task will be cancelled and cannot be resumed.",
                            variant: "warning",
                            confirmText: "Stop",
                          })
                        }
                        title="Stop"
                      >
                        🛑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
