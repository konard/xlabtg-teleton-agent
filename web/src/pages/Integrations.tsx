import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  IntegrationAuthType,
  IntegrationCatalogEntry,
  IntegrationEntity,
  IntegrationType,
} from "../lib/api";
import { useConfirm } from "../components/ConfirmDialog";

const AUTH_TYPES: IntegrationAuthType[] = [
  "none",
  "api_key",
  "oauth2",
  "jwt",
  "basic",
  "custom_header",
];

const STATUS_COLOR: Record<string, string> = {
  healthy: "var(--green)",
  degraded: "var(--cyan)",
  unhealthy: "var(--red)",
  unconfigured: "var(--text-tertiary)",
  unknown: "var(--text-tertiary)",
};

interface FormState {
  id: string;
  name: string;
  type: IntegrationType;
  provider: string;
  baseUrl: string;
  healthCheckUrl: string;
  authType: IntegrationAuthType;
  requestsPerMinute: string;
}

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  type: "api",
  provider: "custom-http",
  baseUrl: "",
  healthCheckUrl: "",
  authType: "none",
  requestsPerMinute: "",
};

function templateToForm(template: IntegrationCatalogEntry): FormState {
  return {
    id: "",
    name: template.name,
    type: template.type,
    provider: template.provider,
    baseUrl: typeof template.defaultConfig.baseUrl === "string" ? template.defaultConfig.baseUrl : "",
    healthCheckUrl:
      typeof template.defaultConfig.healthCheckUrl === "string"
        ? template.defaultConfig.healthCheckUrl
        : "",
    authType: template.authTypes[0] ?? "none",
    requestsPerMinute: "",
  };
}

function statusLabel(status: string): string {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

export function Integrations() {
  const { confirm } = useConfirm();
  const [integrations, setIntegrations] = useState<IntegrationEntity[]>([]);
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credentialFor, setCredentialFor] = useState<string | null>(null);
  const [credentialAuthType, setCredentialAuthType] = useState<IntegrationAuthType>("api_key");
  const [credentialFields, setCredentialFields] = useState<Record<string, string>>({});
  const [testFor, setTestFor] = useState<string | null>(null);
  const [testAction, setTestAction] = useState("request");
  const [testParams, setTestParams] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadData = async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [listRes, catalogRes] = await Promise.all([
        api.getIntegrations(),
        api.getIntegrationCatalog(),
      ]);
      setIntegrations(listRes.data);
      setCatalog(catalogRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, []);

  const catalogByProvider = useMemo(() => {
    const map = new Map<string, IntegrationCatalogEntry>();
    for (const entry of catalog) map.set(entry.provider, entry);
    return map;
  }, [catalog]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.provider.trim()) return;
    try {
      const template = catalogByProvider.get(form.provider);
      const rateLimit = form.requestsPerMinute.trim()
        ? { requestsPerMinute: Number(form.requestsPerMinute) }
        : undefined;
      await api.createIntegration({
        id: form.id.trim() || undefined,
        name: form.name.trim(),
        type: form.type,
        provider: form.provider.trim(),
        auth: { type: form.authType },
        config: {
          ...(template?.defaultConfig ?? {}),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
          ...(form.healthCheckUrl.trim() ? { healthCheckUrl: form.healthCheckUrl.trim() } : {}),
          ...(rateLimit ? { rateLimit } : {}),
        },
        healthCheckUrl: form.healthCheckUrl.trim() || null,
      });
      setSuccess("Integration added");
      setForm(EMPTY_FORM);
      setShowAdd(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleHealth = async (id: string) => {
    setBusyId(id);
    try {
      const res = await api.checkIntegrationHealth(id);
      setSuccess(res.data.message ?? `Health: ${res.data.status}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (integration: IntegrationEntity) => {
    const ok = await confirm({
      title: `Delete "${integration.name}"?`,
      description: "Stored credentials and usage data for this integration will be removed.",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    setBusyId(integration.id);
    try {
      await api.deleteIntegration(integration.id);
      setSuccess("Integration deleted");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const credentialKeys = getCredentialKeys(credentialAuthType);

  const saveCredential = async () => {
    if (!credentialFor) return;
    try {
      await api.createIntegrationCredential(credentialFor, {
        authType: credentialAuthType,
        credentials: credentialFields,
      });
      setSuccess("Credential saved");
      setCredentialFor(null);
      setCredentialFields({});
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runTest = async () => {
    if (!testFor) return;
    try {
      const params = JSON.parse(testParams) as Record<string, unknown>;
      const res = await api.executeIntegration(testFor, testAction, params);
      setTestResult(JSON.stringify(res.data, null, 2));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Integrations</h1>
            <p>Shared external service registry, credentials, health, and execution</p>
          </div>
          <button onClick={() => setShowAdd((value) => !value)} style={{ fontSize: "13px" }}>
            {showAdd ? "Cancel" : "+ Add Integration"}
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

      {success && (
        <div className="alert success" style={{ marginBottom: "14px" }}>
          {success}
          <button
            onClick={() => setSuccess(null)}
            style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {showAdd && (
        <div className="card">
          <h2 style={{ marginBottom: "12px" }}>Add Integration</h2>
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {catalog.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setForm(templateToForm(entry))}
                  className={form.provider === entry.provider ? "tab active" : "tab"}
                  style={{ fontSize: "12px" }}
                >
                  {entry.name}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="ID">
                <input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="auto-generated"
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Type">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as IntegrationType })}
                  style={{ width: "100%" }}
                >
                  <option value="api">API</option>
                  <option value="webhook">Webhook</option>
                  <option value="oauth">OAuth</option>
                  <option value="mcp">MCP</option>
                </select>
              </Field>
              <Field label="Provider">
                <input
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Base URL">
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Health URL">
                <input
                  value={form.healthCheckUrl}
                  onChange={(e) => setForm({ ...form, healthCheckUrl: e.target.value })}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Auth">
                <select
                  value={form.authType}
                  onChange={(e) =>
                    setForm({ ...form, authType: e.target.value as IntegrationAuthType })
                  }
                  style={{ width: "100%" }}
                >
                  {AUTH_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Requests/min">
                <input
                  type="number"
                  min="1"
                  value={form.requestsPerMinute}
                  onChange={(e) => setForm({ ...form, requestsPerMinute: e.target.value })}
                  style={{ width: "100%" }}
                />
              </Field>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={() => setShowAdd(false)} style={{ opacity: 0.75 }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={!form.name.trim()}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {integrations.length === 0 ? (
        <div className="empty">
          <p>No integrations configured</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {integrations.map((integration) => (
            <div key={integration.id} className="card" style={{ marginBottom: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0 }}>{integration.name}</h2>
                    <span className="badge always">{integration.provider}</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "12px",
                        color: STATUS_COLOR[integration.status],
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: STATUS_COLOR[integration.status],
                        }}
                      />
                      {statusLabel(integration.status)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      display: "flex",
                      gap: "12px",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{integration.type}</span>
                    <span>{integration.auth.type}</span>
                    <span>{integration.stats.requestCount} calls</span>
                    <span>{integration.stats.failureCount} failures</span>
                  </div>
                  {integration.lastHealthMessage && (
                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px", marginTop: "6px" }}>
                      {integration.lastHealthMessage}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => handleHealth(integration.id)}
                    disabled={busyId === integration.id}
                    style={{ fontSize: "12px" }}
                  >
                    Check
                  </button>
                  <button
                    onClick={() => {
                      setCredentialFor(integration.id);
                      setCredentialAuthType(integration.auth.type === "none" ? "api_key" : integration.auth.type);
                      setCredentialFields({});
                    }}
                    style={{ fontSize: "12px" }}
                  >
                    Credential
                  </button>
                  <button
                    onClick={() => {
                      setTestFor(testFor === integration.id ? null : integration.id);
                      setTestAction("request");
                      setTestParams("{}");
                      setTestResult(null);
                    }}
                    style={{ fontSize: "12px" }}
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleDelete(integration)}
                    disabled={busyId === integration.id}
                    style={{ fontSize: "12px", opacity: 0.7 }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {credentialFor === integration.id && (
                <div
                  style={{
                    marginTop: "14px",
                    paddingTop: "14px",
                    borderTop: "1px solid var(--separator)",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "8px" }}>
                    <Field label="Auth type">
                      <select
                        value={credentialAuthType}
                        onChange={(e) => {
                          setCredentialAuthType(e.target.value as IntegrationAuthType);
                          setCredentialFields({});
                        }}
                        style={{ width: "100%" }}
                      >
                        {AUTH_TYPES.filter((type) => type !== "none").map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      {credentialKeys.map((key) => (
                        <Field key={key} label={key}>
                          <input
                            type={isSecretField(key) ? "password" : "text"}
                            value={credentialFields[key] ?? ""}
                            onChange={(e) =>
                              setCredentialFields({ ...credentialFields, [key]: e.target.value })
                            }
                            style={{ width: "100%" }}
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button onClick={() => setCredentialFor(null)} style={{ opacity: 0.75 }}>
                      Cancel
                    </button>
                    <button onClick={saveCredential}>Save Credential</button>
                  </div>
                </div>
              )}

              {testFor === integration.id && (
                <div
                  style={{
                    marginTop: "14px",
                    paddingTop: "14px",
                    borderTop: "1px solid var(--separator)",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: "8px" }}>
                    <input
                      value={testAction}
                      onChange={(e) => setTestAction(e.target.value)}
                      placeholder="action"
                    />
                    <input
                      value={testParams}
                      onChange={(e) => setTestParams(e.target.value)}
                      placeholder='{"path":"/health"}'
                      style={{ fontFamily: "var(--font-mono)" }}
                    />
                    <button onClick={runTest}>Run</button>
                  </div>
                  {testResult && (
                    <pre
                      style={{
                        margin: 0,
                        padding: "10px",
                        borderRadius: "8px",
                        background: "var(--surface)",
                        overflow: "auto",
                        fontSize: "12px",
                      }}
                    >
                      {testResult}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function getCredentialKeys(authType: IntegrationAuthType): string[] {
  if (authType === "basic") return ["username", "password"];
  if (authType === "jwt") return ["token"];
  if (authType === "custom_header") return ["headerName", "value"];
  if (authType === "oauth2") return ["accessToken", "refreshToken", "tokenType"];
  return ["apiKey", "headerName", "prefix"];
}

function isSecretField(key: string): boolean {
  return /key|token|secret|password|value/i.test(key);
}
