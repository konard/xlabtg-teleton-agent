import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  api,
  type AgentLogs,
  type AgentMessage,
  type AgentOverview,
  type CreateAgentInput,
  type ManagedAgentMemoryPolicy,
  type UpdateAgentInput,
} from "../lib/api";
import { toast } from "../lib/toast-store";

interface AgentFormState {
  name: string;
  cloneFromId: string;
  mode: AgentOverview["mode"];
  botToken: string;
  botUsername: string;
  personalApiId: string;
  personalApiHash: string;
  personalPhone: string;
  memoryPolicy: ManagedAgentMemoryPolicy;
  acknowledgePersonalAccountAccess: boolean;
  maxMemoryMb: string;
  maxConcurrentTasks: string;
  rateLimitPerMinute: string;
  llmRateLimitPerMinute: string;
  restartOnCrash: boolean;
  maxRestarts: string;
  restartBackoffMs: string;
  messagingEnabled: boolean;
  messagingAllowlist: string;
  maxMessagesPerMinute: string;
}

const DEFAULT_FORM: AgentFormState = {
  name: "",
  cloneFromId: "primary",
  mode: "personal",
  botToken: "",
  botUsername: "",
  personalApiId: "",
  personalApiHash: "",
  personalPhone: "",
  memoryPolicy: "isolated",
  acknowledgePersonalAccountAccess: false,
  maxMemoryMb: "512",
  maxConcurrentTasks: "10",
  rateLimitPerMinute: "60",
  llmRateLimitPerMinute: "30",
  restartOnCrash: true,
  maxRestarts: "3",
  restartBackoffMs: "5000",
  messagingEnabled: false,
  messagingAllowlist: "",
  maxMessagesPerMinute: "30",
};

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

function formFromAgent(agent: AgentOverview): AgentFormState {
  return {
    name: agent.name,
    cloneFromId: agent.sourceId ?? "primary",
    mode: agent.mode,
    botToken: "",
    botUsername: agent.connection.botUsername ?? "",
    personalApiId: "",
    personalApiHash: "",
    personalPhone: "",
    memoryPolicy: agent.memoryPolicy,
    acknowledgePersonalAccountAccess: Boolean(agent.security.personalAccountAccessConfirmedAt),
    maxMemoryMb: String(agent.resources.maxMemoryMb),
    maxConcurrentTasks: String(agent.resources.maxConcurrentTasks),
    rateLimitPerMinute: String(agent.resources.rateLimitPerMinute),
    llmRateLimitPerMinute: String(agent.resources.llmRateLimitPerMinute),
    restartOnCrash: agent.resources.restartOnCrash,
    maxRestarts: String(agent.resources.maxRestarts),
    restartBackoffMs: String(agent.resources.restartBackoffMs),
    messagingEnabled: agent.messaging.enabled,
    messagingAllowlist: agent.messaging.allowlist.join(", "),
    maxMessagesPerMinute: String(agent.messaging.maxMessagesPerMinute),
  };
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function personalConnectionOrUndefined(form: AgentFormState) {
  if (form.mode !== "personal") return undefined;
  const hasInput =
    form.personalApiId.trim() || form.personalApiHash.trim() || form.personalPhone.trim();
  if (!hasInput) return undefined;
  return {
    apiId: numberOrUndefined(form.personalApiId),
    apiHash: form.personalApiHash.trim() || undefined,
    phone: form.personalPhone.trim() || undefined,
  };
}

function toCreatePayload(form: AgentFormState): CreateAgentInput {
  return {
    name: form.name.trim(),
    cloneFromId: form.cloneFromId === "primary" ? undefined : form.cloneFromId,
    mode: form.mode,
    botToken: form.botToken.trim() || undefined,
    botUsername: form.botUsername.trim() || undefined,
    personalConnection: personalConnectionOrUndefined(form),
    memoryPolicy: form.memoryPolicy,
    acknowledgePersonalAccountAccess:
      form.mode === "personal" ? form.acknowledgePersonalAccountAccess : undefined,
    resources: {
      maxMemoryMb: numberOrUndefined(form.maxMemoryMb),
      maxConcurrentTasks: numberOrUndefined(form.maxConcurrentTasks),
      rateLimitPerMinute: numberOrUndefined(form.rateLimitPerMinute),
      llmRateLimitPerMinute: numberOrUndefined(form.llmRateLimitPerMinute),
      restartOnCrash: form.restartOnCrash,
      maxRestarts: numberOrUndefined(form.maxRestarts),
      restartBackoffMs: numberOrUndefined(form.restartBackoffMs),
    },
    messaging: {
      enabled: form.messagingEnabled,
      allowlist: form.messagingAllowlist
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      maxMessagesPerMinute: numberOrUndefined(form.maxMessagesPerMinute),
    },
  };
}

function toUpdatePayload(form: AgentFormState): UpdateAgentInput {
  return {
    name: form.name.trim() || undefined,
    botToken: form.botToken.trim() || undefined,
    botUsername: form.botUsername.trim() || null,
    personalConnection: personalConnectionOrUndefined(form),
    memoryPolicy: form.memoryPolicy,
    acknowledgePersonalAccountAccess:
      form.mode === "personal" ? form.acknowledgePersonalAccountAccess : undefined,
    resources: {
      maxMemoryMb: numberOrUndefined(form.maxMemoryMb),
      maxConcurrentTasks: numberOrUndefined(form.maxConcurrentTasks),
      rateLimitPerMinute: numberOrUndefined(form.rateLimitPerMinute),
      llmRateLimitPerMinute: numberOrUndefined(form.llmRateLimitPerMinute),
      restartOnCrash: form.restartOnCrash,
      maxRestarts: numberOrUndefined(form.maxRestarts),
      restartBackoffMs: numberOrUndefined(form.restartBackoffMs),
    },
    messaging: {
      enabled: form.messagingEnabled,
      allowlist: form.messagingAllowlist
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      maxMessagesPerMinute: numberOrUndefined(form.maxMessagesPerMinute),
    },
  };
}

function FormFields({
  form,
  setForm,
  submitLabel,
  submitting,
  onSubmit,
  showCloneSource,
  onValidateBotToken,
  botValidationMessage,
  botValidationLoading,
}: {
  form: AgentFormState;
  setForm: Dispatch<SetStateAction<AgentFormState>>;
  submitLabel: string;
  submitting: boolean;
  onSubmit: () => Promise<void> | void;
  showCloneSource: boolean;
  onValidateBotToken?: () => Promise<void> | void;
  botValidationMessage?: string | null;
  botValidationLoading?: boolean;
}) {
  return (
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
          value={form.name}
          onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
        />
        {showCloneSource && (
          <input
            type="text"
            placeholder="Clone source id"
            value={form.cloneFromId}
            onChange={(e) => setForm((current) => ({ ...current, cloneFromId: e.target.value }))}
          />
        )}
        <select
          value={form.mode}
          disabled={!showCloneSource}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              mode: e.target.value as AgentOverview["mode"],
            }))
          }
        >
          <option value="personal">Personal mode</option>
          <option value="bot">Bot mode</option>
        </select>
        <select
          value={form.memoryPolicy}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              memoryPolicy: e.target.value as ManagedAgentMemoryPolicy,
            }))
          }
        >
          <option value="isolated">Isolated memory</option>
          <option value="shared-read">Shared-read (modeled, blocked)</option>
          <option value="shared-write">Shared-write (modeled, blocked)</option>
        </select>
      </div>

      {form.mode === "bot" && (
        <div
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <input
            type="password"
            placeholder="Bot token"
            value={form.botToken}
            onChange={(e) => setForm((current) => ({ ...current, botToken: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Bot username"
            value={form.botUsername}
            onChange={(e) => setForm((current) => ({ ...current, botUsername: e.target.value }))}
          />
          {onValidateBotToken && (
            <button
              type="button"
              onClick={() => void onValidateBotToken()}
              disabled={botValidationLoading || !form.botToken.trim()}
            >
              {botValidationLoading ? "Checking..." : "Validate token"}
            </button>
          )}
        </div>
      )}
      {form.mode === "bot" && botValidationMessage && (
        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {botValidationMessage}
        </div>
      )}

      {form.mode === "personal" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <input
              type="number"
              min="1"
              placeholder="Telegram API ID"
              value={form.personalApiId}
              onChange={(e) =>
                setForm((current) => ({ ...current, personalApiId: e.target.value }))
              }
            />
            <input
              type="password"
              placeholder="Telegram API hash"
              value={form.personalApiHash}
              onChange={(e) =>
                setForm((current) => ({ ...current, personalApiHash: e.target.value }))
              }
            />
            <input
              type="tel"
              placeholder="Phone number"
              value={form.personalPhone}
              onChange={(e) =>
                setForm((current) => ({ ...current, personalPhone: e.target.value }))
              }
            />
          </div>
          <label
            style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "13px" }}
          >
            <input
              type="checkbox"
              checked={form.acknowledgePersonalAccountAccess}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  acknowledgePersonalAccountAccess: e.target.checked,
                }))
              }
            />
            <span>
              I understand this personal-mode agent can access the authenticated private-account
              chat scope.
            </span>
          </label>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <input
          type="number"
          min="64"
          placeholder="Max memory MB"
          value={form.maxMemoryMb}
          onChange={(e) => setForm((current) => ({ ...current, maxMemoryMb: e.target.value }))}
        />
        <input
          type="number"
          min="1"
          placeholder="Max concurrent tasks"
          value={form.maxConcurrentTasks}
          onChange={(e) =>
            setForm((current) => ({ ...current, maxConcurrentTasks: e.target.value }))
          }
        />
        <input
          type="number"
          min="1"
          placeholder="Rate limit / minute"
          value={form.rateLimitPerMinute}
          onChange={(e) =>
            setForm((current) => ({ ...current, rateLimitPerMinute: e.target.value }))
          }
        />
        <input
          type="number"
          min="1"
          placeholder="LLM rate limit / minute"
          value={form.llmRateLimitPerMinute}
          onChange={(e) =>
            setForm((current) => ({ ...current, llmRateLimitPerMinute: e.target.value }))
          }
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          alignItems: "center",
        }}
      >
        <label style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={form.restartOnCrash}
            onChange={(e) =>
              setForm((current) => ({ ...current, restartOnCrash: e.target.checked }))
            }
          />
          <span>Restart on crash</span>
        </label>
        <input
          type="number"
          min="0"
          placeholder="Max restarts"
          value={form.maxRestarts}
          onChange={(e) => setForm((current) => ({ ...current, maxRestarts: e.target.value }))}
        />
        <input
          type="number"
          min="0"
          placeholder="Restart backoff ms"
          value={form.restartBackoffMs}
          onChange={(e) => setForm((current) => ({ ...current, restartBackoffMs: e.target.value }))}
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <label style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={form.messagingEnabled}
            onChange={(e) =>
              setForm((current) => ({ ...current, messagingEnabled: e.target.checked }))
            }
          />
          <span>Enable inter-agent inbox</span>
        </label>
        <input
          type="number"
          min="1"
          placeholder="Message rate / minute"
          value={form.maxMessagesPerMinute}
          onChange={(e) =>
            setForm((current) => ({ ...current, maxMessagesPerMinute: e.target.value }))
          }
        />
      </div>
      <input
        type="text"
        placeholder="Messaging allowlist ids (comma separated, empty = open)"
        value={form.messagingAllowlist}
        onChange={(e) => setForm((current) => ({ ...current, messagingAllowlist: e.target.value }))}
      />

      <button onClick={() => void onSubmit()} disabled={submitting}>
        {submitting ? "Working..." : submitLabel}
      </button>
    </section>
  );
}

function PersonalAuthPanel({
  agent,
  onAuthenticated,
}: {
  agent: AgentOverview;
  onAuthenticated: () => Promise<void> | void;
}) {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [authSessionId, setAuthSessionId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setApiId("");
    setApiHash("");
    setPhone("");
    setAuthSessionId(null);
    setCode("");
    setPassword("");
    setPasswordRequired(false);
    setPasswordHint(null);
    setMessage(null);
  }, [agent.id]);

  const handleSendCode = useCallback(async () => {
    setBusy(true);
    try {
      const response = await api.sendManagedPersonalCode(agent.id, {
        apiId: numberOrUndefined(apiId),
        apiHash: apiHash.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      const result = response.data;
      setAuthSessionId(result.authSessionId);
      setPasswordRequired(false);
      setPasswordHint(null);
      setMessage(
        result.codeDelivery === "fragment" && result.fragmentUrl
          ? `Code sent via Fragment: ${result.fragmentUrl}`
          : `Code sent via ${result.codeDelivery}${result.codeLength ? ` (${result.codeLength} digits)` : ""}`
      );
      toast.success("Telegram code sent");
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }, [agent.id, apiHash, apiId, phone]);

  const handleVerifyCode = useCallback(async () => {
    if (!authSessionId) return;
    setBusy(true);
    try {
      const response = await api.verifyManagedPersonalCode(agent.id, authSessionId, code.trim());
      const result = response.data;
      if (result.status === "authenticated") {
        setMessage(result.user ? `Authenticated as ${result.user.firstName}` : "Authenticated");
        setAuthSessionId(null);
        setCode("");
        setPassword("");
        setPasswordRequired(false);
        toast.success("Personal Telegram session verified");
        await onAuthenticated();
      } else if (result.status === "2fa_required") {
        setPasswordRequired(true);
        setPasswordHint(result.passwordHint ?? null);
        setMessage("Two-factor password required");
      } else {
        setMessage(result.status.replace(/_/g, " "));
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }, [agent.id, authSessionId, code, onAuthenticated]);

  const handleVerifyPassword = useCallback(async () => {
    if (!authSessionId) return;
    setBusy(true);
    try {
      const response = await api.verifyManagedPersonalPassword(agent.id, authSessionId, password);
      const result = response.data;
      if (result.status === "authenticated") {
        setMessage(result.user ? `Authenticated as ${result.user.firstName}` : "Authenticated");
        setAuthSessionId(null);
        setCode("");
        setPassword("");
        setPasswordRequired(false);
        toast.success("Personal Telegram session verified");
        await onAuthenticated();
      } else {
        setMessage(result.status.replace(/_/g, " "));
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }, [agent.id, authSessionId, onAuthenticated, password]);

  const handleResend = useCallback(async () => {
    if (!authSessionId) return;
    setBusy(true);
    try {
      const response = await api.resendManagedPersonalCode(agent.id, authSessionId);
      const result = response.data;
      setMessage(
        result.codeDelivery === "fragment" && result.fragmentUrl
          ? `Code resent via Fragment: ${result.fragmentUrl}`
          : `Code resent via ${result.codeDelivery}${result.codeLength ? ` (${result.codeLength} digits)` : ""}`
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }, [agent.id, authSessionId]);

  const handleCancel = useCallback(async () => {
    if (!authSessionId) return;
    setBusy(true);
    try {
      await api.cancelManagedPersonalAuth(agent.id, authSessionId);
      setAuthSessionId(null);
      setCode("");
      setPassword("");
      setPasswordRequired(false);
      setMessage("Authentication session cancelled");
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }, [agent.id, authSessionId]);

  return (
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
        <div style={{ fontSize: "15px", fontWeight: 600 }}>Personal Telegram auth</div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Session: {agent.hasPersonalSession ? "verified" : "missing"} · Credentials:{" "}
          {agent.hasPersonalCredentials ? "configured" : "missing"}
          {agent.personalPhoneMasked ? ` · ${agent.personalPhoneMasked}` : ""}
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
          type="number"
          min="1"
          placeholder={agent.hasPersonalCredentials ? "API ID (saved)" : "Telegram API ID"}
          value={apiId}
          onChange={(e) => setApiId(e.target.value)}
        />
        <input
          type="password"
          placeholder={agent.hasPersonalCredentials ? "API hash (saved)" : "Telegram API hash"}
          value={apiHash}
          onChange={(e) => setApiHash(e.target.value)}
        />
        <input
          type="tel"
          placeholder={agent.personalPhoneMasked ?? "Phone number"}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void handleSendCode()}
          disabled={
            busy ||
            (!agent.hasPersonalCredentials && (!apiId.trim() || !apiHash.trim() || !phone.trim()))
          }
        >
          {busy ? "Working..." : "Send code"}
        </button>
      </div>

      {authSessionId && (
        <div
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void handleVerifyCode()}
            disabled={busy || !code.trim()}
          >
            Verify code
          </button>
          <button type="button" onClick={() => void handleResend()} disabled={busy}>
            Resend
          </button>
          <button type="button" onClick={() => void handleCancel()} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {authSessionId && passwordRequired && (
        <div
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <input
            type="password"
            placeholder={passwordHint ? `2FA password, hint: ${passwordHint}` : "2FA password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void handleVerifyPassword()}
            disabled={busy || !password}
          >
            Verify password
          </button>
        </div>
      )}

      {message && <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{message}</div>}
    </section>
  );
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
  const [createForm, setCreateForm] = useState<AgentFormState>(DEFAULT_FORM);
  const [createBotValidation, setCreateBotValidation] = useState<string | null>(null);
  const [validatingCreateBot, setValidatingCreateBot] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AgentFormState>(DEFAULT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectedLogsAgentId, setSelectedLogsAgentId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentLogs | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedMessagesAgentId, setSelectedMessagesAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageFromId, setMessageFromId] = useState("primary");
  const [messageText, setMessageText] = useState("");

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

  const editableAgent = useMemo(
    () => agents.find((agent) => agent.id === editingAgentId) ?? null,
    [agents, editingAgentId]
  );
  const selectedLogsAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedLogsAgentId) ?? null,
    [agents, selectedLogsAgentId]
  );
  const selectedMessagesAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedMessagesAgentId) ?? null,
    [agents, selectedMessagesAgentId]
  );
  const messageSourceOptions = useMemo(
    () => agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.kind})` })),
    [agents]
  );

  const refreshLogs = useCallback(async (agentId: string) => {
    setSelectedLogsAgentId(agentId);
    setLoadingLogs(true);
    try {
      const response = await api.getManagedAgentLogs(agentId, 200);
      setLogs(response.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  const refreshMessages = useCallback(async (agentId: string) => {
    setSelectedMessagesAgentId(agentId);
    setLoadingMessages(true);
    try {
      const response = await api.getManagedAgentMessages(agentId, 100);
      setMessages(response.data.messages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createForm.name.trim()) {
      toast.error("Enter an agent name first");
      return;
    }

    setCreating(true);
    try {
      const response = await api.createAgent(toCreatePayload(createForm));
      setCreateForm(DEFAULT_FORM);
      setCreateBotValidation(null);
      toast.success("Managed agent created");
      await loadAgents();
      if (response.data.mode === "personal" && !response.data.hasPersonalSession) {
        setEditingAgentId(response.data.id);
        setEditForm(formFromAgent(response.data));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [createForm, loadAgents]);

  const handleValidateCreateBot = useCallback(async () => {
    const token = createForm.botToken.trim();
    if (!token) {
      toast.error("Enter a bot token first");
      return;
    }

    setValidatingCreateBot(true);
    try {
      const response = await api.validateManagedBotToken(token);
      const result = response.data;
      if (result.valid) {
        const username = result.bot?.username ?? "";
        if (username) {
          setCreateForm((current) => ({
            ...current,
            botUsername: current.botUsername || username,
          }));
        }
        setCreateBotValidation(username ? `Validated @${username}` : "Bot token validated");
        toast.success("Bot token validated");
      } else {
        setCreateBotValidation(result.error ?? "Bot token is invalid");
        toast.error(result.error ?? "Bot token is invalid");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCreateBotValidation(message);
      toast.error(message);
    } finally {
      setValidatingCreateBot(false);
    }
  }, [createForm.botToken]);

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
        await api.cloneAgent(agent.id, {
          name: cloneName,
          mode: agent.mode,
          memoryPolicy: agent.memoryPolicy,
          acknowledgePersonalAccountAccess: agent.mode === "personal" ? true : undefined,
        });
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
      if (!window.confirm(`Delete ${agent.name}? This removes its isolated home directory.`))
        return;

      setBusyAgentId(agent.id);
      try {
        await api.deleteAgent(agent.id);
        if (selectedLogsAgentId === agent.id) {
          setSelectedLogsAgentId(null);
          setLogs(null);
        }
        if (selectedMessagesAgentId === agent.id) {
          setSelectedMessagesAgentId(null);
          setMessages([]);
        }
        if (editingAgentId === agent.id) {
          setEditingAgentId(null);
        }
        toast.success(`Deleted ${agent.name}`);
        await loadAgents();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAgentId(null);
      }
    },
    [editingAgentId, loadAgents, selectedLogsAgentId, selectedMessagesAgentId]
  );

  const handleEdit = useCallback((agent: AgentOverview) => {
    setEditingAgentId(agent.id);
    setEditForm(formFromAgent(agent));
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingAgentId) return;
    setSavingEdit(true);
    try {
      await api.updateAgent(editingAgentId, toUpdatePayload(editForm));
      toast.success("Managed agent updated");
      await loadAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }, [editForm, editingAgentId, loadAgents]);

  const handleSendMessage = useCallback(async () => {
    if (!selectedMessagesAgentId) return;
    if (!messageText.trim()) {
      toast.error("Enter a message first");
      return;
    }
    try {
      await api.sendManagedAgentMessage(selectedMessagesAgentId, {
        fromId: messageFromId,
        text: messageText.trim(),
      });
      setMessageText("");
      toast.success("Inbox message queued");
      await refreshMessages(selectedMessagesAgentId);
      await loadAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [loadAgents, messageFromId, messageText, refreshMessages, selectedMessagesAgentId]);

  if (loading) {
    return <div className="loading">Loading managed agents...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div className="header" style={{ marginBottom: 0 }}>
        <h1>Agents</h1>
        <p>
          Run isolated Telegram runtimes with explicit mode, policy, restart, and inbox controls.
        </p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "4px" }}>
          {error}
        </div>
      )}

      <section style={{ display: "grid", gap: "8px" }}>
        <div style={{ fontSize: "15px", fontWeight: 600 }}>Create managed agent</div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Personal-mode agents require phone/API credentials, explicit consent, and per-agent
          Telegram verification. Bot-mode agents require a bot token and start with polling
          transport.
        </div>
        <FormFields
          form={createForm}
          setForm={setCreateForm}
          submitLabel="Create managed agent"
          submitting={creating}
          onSubmit={handleCreate}
          showCloneSource
          onValidateBotToken={handleValidateCreateBot}
          botValidationMessage={createBotValidation}
          botValidationLoading={validatingCreateBot}
        />
      </section>

      {editableAgent && (
        <section style={{ display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600 }}>Edit {editableAgent.name}</div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Stop the agent before changing runtime, messaging, or credential settings.
              </div>
            </div>
            <button onClick={() => setEditingAgentId(null)}>Close</button>
          </div>
          <FormFields
            form={editForm}
            setForm={setEditForm}
            submitLabel="Save agent settings"
            submitting={savingEdit}
            onSubmit={handleSaveEdit}
            showCloneSource={false}
          />
          {editableAgent.mode === "personal" && (
            <PersonalAuthPanel agent={editableAgent} onAuthenticated={loadAgents} />
          )}
        </section>
      )}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        width: "9px",
                        height: "9px",
                        borderRadius: "50%",
                        background: STATE_COLORS[agent.state],
                        display: "inline-block",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        textTransform: "uppercase",
                      }}
                    >
                      {agent.kind}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        textTransform: "uppercase",
                      }}
                    >
                      {agent.mode}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        textTransform: "uppercase",
                      }}
                    >
                      {agent.transport}
                    </span>
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 600 }}>{agent.name}</div>
                  <div
                    style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}
                  >
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
                  <div style={{ color: "var(--text-secondary)" }}>Health</div>
                  <div>{agent.health}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>PID</div>
                  <div>{agent.pid ?? "—"}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Uptime</div>
                  <div>{formatUptime(agent.uptimeMs)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Started</div>
                  <div>{formatDate(agent.startedAt)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Last exit</div>
                  <div>{formatDate(agent.lastExitAt)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Restarts</div>
                  <div>{agent.restartCount}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Inbox</div>
                  <div>{agent.pendingMessages}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Memory policy</div>
                  <div>{agent.memoryPolicy}</div>
                </div>
                <div>
                  <div style={{ color: "var(--text-secondary)" }}>Bot username</div>
                  <div>{agent.connection.botUsername ?? "—"}</div>
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
                <div>
                  Runtime: {agent.resources.maxConcurrentTasks} tasks,{" "}
                  {agent.resources.rateLimitPerMinute} req/min,{" "}
                  {agent.resources.llmRateLimitPerMinute} LLM/min, {agent.resources.maxMemoryMb} MB
                </div>
                <div>
                  Restart: {agent.resources.restartOnCrash ? "on" : "off"} /{" "}
                  {agent.resources.maxRestarts} max / {agent.resources.restartBackoffMs} ms backoff
                </div>
                <div>
                  Inbox: {agent.messaging.enabled ? "enabled" : "disabled"}
                  {agent.messaging.allowlist.length > 0
                    ? ` · allowlist ${agent.messaging.allowlist.join(", ")}`
                    : " · open"}
                </div>
                {agent.mode === "personal" && (
                  <div>
                    Personal consent:{" "}
                    {agent.security.personalAccountAccessConfirmedAt
                      ? formatDate(agent.security.personalAccountAccessConfirmedAt)
                      : "missing"}
                  </div>
                )}
                {agent.mode === "personal" && (
                  <div>
                    Personal auth: {agent.hasPersonalSession ? "verified" : "missing session"} ·{" "}
                    {agent.hasPersonalCredentials
                      ? "credentials configured"
                      : "credentials missing"}
                    {agent.personalPhoneMasked ? ` · ${agent.personalPhoneMasked}` : ""}
                  </div>
                )}
                {agent.canStartReason && (
                  <div style={{ color: "var(--red)" }}>Start blocked: {agent.canStartReason}</div>
                )}
                {agent.lastError && (
                  <div style={{ color: "var(--red)" }}>Last error: {agent.lastError}</div>
                )}
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
                {agent.kind === "managed" && (
                  <button onClick={() => handleEdit(agent)} disabled={busy}>
                    Edit
                  </button>
                )}
                <button onClick={() => void handleClone(agent)} disabled={busy}>
                  Clone
                </button>
                {agent.canDelete && (
                  <button
                    onClick={() => void handleDelete(agent)}
                    disabled={busy}
                    className="btn-danger"
                  >
                    Delete
                  </button>
                )}
                {agent.logsAvailable && (
                  <button onClick={() => void refreshLogs(agent.id)} disabled={busy}>
                    Logs
                  </button>
                )}
                {agent.kind === "managed" && (
                  <button onClick={() => void refreshMessages(agent.id)} disabled={busy}>
                    Inbox
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
            <button onClick={() => void refreshLogs(selectedLogsAgent.id)} disabled={loadingLogs}>
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

      {selectedMessagesAgent && (
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600 }}>
                {selectedMessagesAgent.name} inbox
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                File-backed backend primitive with allowlist and rate-limit enforcement.
              </div>
            </div>
            <button
              onClick={() => void refreshMessages(selectedMessagesAgent.id)}
              disabled={loadingMessages}
            >
              {loadingMessages ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "180px 1fr auto",
            }}
          >
            <select value={messageFromId} onChange={(e) => setMessageFromId(e.target.value)}>
              {messageSourceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  From {option.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Queue a message into this agent's inbox"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
            <button onClick={() => void handleSendMessage()}>Send</button>
          </div>

          <div
            style={{
              display: "grid",
              gap: "10px",
              maxHeight: "420px",
              overflowY: "auto",
            }}
          >
            {messages.length === 0 && (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                No inbox messages yet.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  padding: "12px",
                  borderRadius: "14px",
                  border: "1px solid var(--separator)",
                  background: "var(--surface-hover)",
                }}
              >
                <div
                  style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}
                >
                  {message.fromId} → {message.toId} · {formatDate(message.createdAt)}
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>{message.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
