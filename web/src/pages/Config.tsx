import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ConfigKeyData } from '../lib/api';
import { useConfirm } from '../components/ConfirmDialog';
import { useConfigState } from '../hooks/useConfigState';
import { PillBar } from '../components/PillBar';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { GroqSettingsPanel } from '../components/GroqSettingsPanel';
import { CommandControlsPanel } from '../components/CommandControlsPanel';
import { Select } from '../components/Select';
import { ArrayInput } from '../components/ArrayInput';
import { EditableField } from '../components/EditableField';
import { ConfigSection } from '../components/ConfigSection';
import { InfoTip } from '../components/InfoTip';
import { ExportImportPanel } from '../components/ExportImportPanel';
import { MtprotoSettingsPanel } from '../components/MtprotoSettingsPanel';
import { YoloSettingsPanel } from '../components/YoloSettingsPanel';

const TABS = [
  { id: 'llm', label: 'LLM' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'commands', label: 'Commands' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'ton-proxy', label: 'TON Proxy' },
  { id: 'vector-memory', label: 'Vector Memory' },
  { id: 'mrtpoto', label: 'MRTPOTO' },
  { id: 'yolo', label: 'YOLO' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'tool-rag', label: 'Tool RAG' },
  { id: 'backup', label: 'Backup' },
];

const API_KEY_KEYS = ['agent.api_key', 'telegram.bot_token', 'tavily_api_key', 'tonapi_key', 'toncenter_api_key'];
const ADVANCED_KEYS = [
  'webui.port', 'webui.log_requests',
  'deals.enabled', 'deals.expiry_seconds', 'deals.buy_max_floor_percent', 'deals.sell_min_floor_percent',
  'agent.base_url', 'dev.hot_reload',
];
const VECTOR_MEMORY_KEYS = [
  'embedding.provider',
  'embedding.model',
  'vector_memory.upstash_rest_url',
  'vector_memory.upstash_rest_token',
  'vector_memory.namespace',
];
const SESSION_KEYS = [
  'agent.session_reset_policy.daily_reset_enabled',
  'agent.session_reset_policy.daily_reset_hour',
  'agent.session_reset_policy.idle_expiry_enabled',
  'agent.session_reset_policy.idle_expiry_minutes',
];

function HeartbeatTab({ config }: { config: ReturnType<typeof useConfigState> }) {
  const selfConfigurable =
    config.getLocal('heartbeat.self_configurable') === 'true' ||
    config.getLocal('heartbeat.self_configurable') === true;

  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);

  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{
    content: string;
    suppressed: boolean;
    sentToTelegram: boolean;
  } | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const serverPrompt = String(
    config.getServer('heartbeat.prompt') ||
    'Read HEARTBEAT.md if it exists. Follow it strictly. If nothing needs attention, reply NO_ACTION.'
  );
  const localPrompt = promptDraft ?? String(config.getLocal('heartbeat.prompt') || serverPrompt);
  const promptDirty = localPrompt !== serverPrompt;

  const intervalMs = Number(config.getLocal('heartbeat.interval_ms') || 1800000);
  const intervalMin = Math.round(intervalMs / 60000);

  const handleSavePrompt = async () => {
    if (!promptDirty || promptSaving) return;
    setPromptSaving(true);
    try {
      await config.saveConfig('heartbeat.prompt', localPrompt);
      setPromptDraft(null);
    } finally {
      setPromptSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggerLoading(true);
    setTriggerResult(null);
    setTriggerError(null);
    try {
      const res = await api.triggerHeartbeat();
      setTriggerResult(res.data);
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggerLoading(false);
    }
  };

  return (
    <>
      <div className="card-header">
        <div className="section-title">Heartbeat</div>
        <p className="card-description">
          Periodic autonomous wake-up. The agent reads HEARTBEAT.md and acts on its tasks, or stays silent.
        </p>
      </div>

      {/* Enable / Interval / Self-configurable */}
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="toggle" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={
                    config.getLocal('heartbeat.enabled') === 'true' ||
                    config.getLocal('heartbeat.enabled') === true
                  }
                  onChange={async (e) => {
                    await config.saveConfig('heartbeat.enabled', String(e.target.checked));
                  }}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
              <span>Enabled</span>
              <InfoTip text="When enabled, the agent wakes up periodically to check HEARTBEAT.md and act on pending tasks. Replies NO_ACTION (silently suppressed) when nothing needs attention." />
            </div>
          </div>

          <EditableField
            label="Interval"
            description={`Time between heartbeat ticks (in minutes). Requires restart to take effect.`}
            configKey="heartbeat.interval_ms"
            type="number"
            value={String(intervalMin)}
            serverValue={String(Math.round(Number(config.getServer('heartbeat.interval_ms') || 1800000) / 60000))}
            onChange={(v) => config.setLocal('heartbeat.interval_ms', String(Number(v) * 60000))}
            onSave={(v) => config.saveConfig('heartbeat.interval_ms', String(Number(v) * 60000))}
            onCancel={() => config.cancelLocal('heartbeat.interval_ms')}
            min={1}
            max={1440}
            placeholder="30"
            hotReload="restart"
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="toggle" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={selfConfigurable}
                  onChange={async (e) => {
                    await config.saveConfig('heartbeat.self_configurable', String(e.target.checked));
                  }}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
              <span>Self-configurable</span>
              <InfoTip text="Allow the agent to modify its own heartbeat settings (interval, prompt). When off, only the admin can change these via the web UI." />
            </div>
          </div>
        </div>
      </div>

      {/* Prompt editor */}
      <div className="card-header" style={{ marginTop: 16 }}>
        <div className="section-title">Heartbeat Prompt</div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Prompt sent to the agent on each heartbeat tick.{' '}
            {!selfConfigurable && (
              <span style={{ color: 'var(--warning, #f59e0b)' }}>
                Enable <strong>Self-configurable</strong> above to edit this field.
              </span>
            )}
          </p>
          <textarea
            rows={4}
            disabled={!selfConfigurable || promptSaving}
            value={localPrompt}
            onChange={(e) => setPromptDraft(e.target.value)}
            style={{
              width: '100%',
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: 13,
              padding: '8px 10px',
              boxSizing: 'border-box',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: selfConfigurable ? 'var(--input-bg, var(--bg))' : 'var(--bg-muted, var(--bg))',
              color: 'var(--text)',
              opacity: selfConfigurable ? 1 : 0.6,
            }}
          />
          {selfConfigurable && promptDirty && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={handleSavePrompt}
                disabled={promptSaving}
                style={{ fontSize: 13, padding: '4px 14px' }}
              >
                {promptSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="btn"
                onClick={() => setPromptDraft(null)}
                disabled={promptSaving}
                style={{ fontSize: 13, padding: '4px 14px' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Manual trigger */}
      <div className="card-header" style={{ marginTop: 16 }}>
        <div className="section-title">Manual Trigger</div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Run a heartbeat tick immediately. The agent will execute its heartbeat prompt and any
            actionable response will be delivered to the configured admin Telegram chat.
            Next scheduled tick: every <strong>{intervalMin} min</strong>.
          </p>
          <div>
            <button
              className="btn btn-primary"
              onClick={handleTrigger}
              disabled={triggerLoading}
              style={{ fontSize: 13, padding: '6px 18px' }}
            >
              {triggerLoading ? 'Running…' : 'Run Heartbeat Now'}
            </button>
          </div>
          {triggerError && (
            <div className="alert error" style={{ marginTop: 4 }}>
              {triggerError}
            </div>
          )}
          {triggerResult && (
            <div
              style={{
                background: 'var(--bg-muted, var(--bg))',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
              }}
            >
              <div style={{ marginBottom: 6, fontWeight: 600 }}>
                Result:{' '}
                {triggerResult.suppressed ? (
                  <span style={{ color: 'var(--text-secondary)' }}>NO_ACTION (suppressed)</span>
                ) : triggerResult.sentToTelegram ? (
                  <span style={{ color: 'var(--success, #22c55e)' }}>Sent to Telegram</span>
                ) : (
                  <span style={{ color: 'var(--warning, #f59e0b)' }}>Response (Telegram unavailable)</span>
                )}
              </div>
              {triggerResult.content && (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: 'var(--text)',
                  }}
                >
                  {triggerResult.content}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function Config() {
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'llm';

  const config = useConfigState();

  // Raw config keys state for ConfigSection tabs
  const [configKeys, setConfigKeys] = useState<ConfigKeyData[]>([]);

  // TON Proxy state
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; installed: boolean; port: number; enabled: boolean; pid?: number } | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);

  const handleTabChange = (id: string) => {
    setSearchParams({ tab: id }, { replace: true });
  };

  // Load config keys on mount (needed by ConfigSection in multiple tabs)
  useEffect(() => {
    api.getConfigKeys()
      .then((res) => setConfigKeys(res.data))
      .catch(() => {});
  }, []);

  // Load proxy status when TON Proxy tab is active
  useEffect(() => {
    if (activeTab !== 'ton-proxy') return;
    api.getTonProxyStatus()
      .then((res) => setProxyStatus(res.data))
      .catch(() => {});
  }, [activeTab]);

  const loadKeys = () => {
    api.getConfigKeys()
      .then((res) => setConfigKeys(res.data))
      .catch(() => {});
  };

  const handleArraySave = async (key: string, values: string[]) => {
    config.setError(null);
    try {
      await api.setConfigKey(key, values);
      config.showSuccess(`${key} updated successfully`);
      loadKeys();
    } catch (err) {
      config.setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (config.loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="header">
        <h1>Configuration</h1>
        <p>Manage settings and API keys</p>
      </div>

      {config.error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {config.error}
          <button onClick={() => config.setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {config.saveSuccess && (
        <div className="alert success" style={{ marginBottom: '16px' }}>
          {config.saveSuccess}
        </div>
      )}

      <PillBar tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* LLM Tab */}
      {activeTab === 'llm' && (
        <>
          <div className="card-header">
            <div className="section-title">Agent</div>
          </div>
          <div className="card">
            <AgentSettingsPanel
              getLocal={config.getLocal}
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
              modelOptions={config.modelOptions}
              pendingProvider={config.pendingProvider}
              pendingMeta={config.pendingMeta}
              pendingApiKey={config.pendingApiKey}
              setPendingApiKey={config.setPendingApiKey}
              pendingValidating={config.pendingValidating}
              pendingError={config.pendingError}
              setPendingError={config.setPendingError}
              handleProviderChange={config.handleProviderChange}
              handleProviderConfirm={config.handleProviderConfirm}
              handleProviderCancel={config.handleProviderCancel}
            />
          </div>

          {config.getLocal('agent.provider') === 'cocoon' && (
            <>
              <div className="card-header">
                <div className="section-title">Cocoon</div>
              </div>
              <div className="card">
                <EditableField
                  label="Proxy Port"
                  description="Cocoon Network proxy port"
                  configKey="cocoon.port"
                  type="number"
                  value={config.getLocal('cocoon.port')}
                  serverValue={config.getServer('cocoon.port')}
                  onChange={(v) => config.setLocal('cocoon.port', v)}
                  onSave={(v) => config.saveConfig('cocoon.port', v)}
                  onCancel={() => config.cancelLocal('cocoon.port')}
                  min={1}
                  max={65535}
                  placeholder="11434"
                  hotReload="restart"
                />
              </div>
            </>
          )}

          <GroqSettingsPanel
            getLocal={config.getLocal}
            getServer={config.getServer}
            saveConfig={config.saveConfig}
            isGroqProvider={config.getLocal('agent.provider') === 'groq'}
          />


        </>
      )}

      {/* Telegram Tab */}
      {activeTab === 'telegram' && (
        <TelegramSettingsPanel
          getLocal={config.getLocal}
          getServer={config.getServer}
          setLocal={config.setLocal}
          saveConfig={config.saveConfig}
          cancelLocal={config.cancelLocal}
          configKeys={configKeys}
          onArraySave={handleArraySave}
          extended={true}
        />
      )}

      {/* Commands Tab */}
      {activeTab === 'commands' && (
        <div className="card">
          <CommandControlsPanel
            getLocal={config.getLocal}
            saveConfig={config.saveConfig}
            onArraySave={handleArraySave}
          />
        </div>
      )}

      {/* Heartbeat Tab */}
      {activeTab === 'heartbeat' && (
        <HeartbeatTab config={config} />
      )}

      {/* API Keys Tab */}
      {activeTab === 'api-keys' && (
        <>
          <div className="card-header">
            <div className="section-title">API Keys</div>
          </div>
          <div className="card">
            <ConfigSection
              keys={API_KEY_KEYS}
              configKeys={configKeys}
              getLocal={config.getLocal}
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
            />
          </div>
        </>
      )}

      {/* TON Proxy Tab */}
      {activeTab === 'ton-proxy' && (
        <>
          <div className="card-header">
            <div className="section-title">TON Proxy</div>
            <p className="card-description">
              Tonutils-Proxy gateway for accessing .ton websites. The binary is auto-downloaded from GitHub on first enable.
            </p>
          </div>
          <div className="card">
            {proxyError && (
              <div className="alert error" style={{ marginBottom: '14px' }}>
                {proxyError}
                <button onClick={() => setProxyError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
                  Dismiss
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Top row: toggle left, uninstall right */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className="toggle" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      disabled={proxyLoading}
                      checked={proxyStatus?.enabled ?? config.getLocal('ton_proxy.enabled') === 'true'}
                      onChange={async (e) => {
                        const enable = e.target.checked;
                        setProxyLoading(true);
                        setProxyError(null);
                        try {
                          const res = enable
                            ? await api.startTonProxy()
                            : await api.stopTonProxy();
                          setProxyStatus(res.data);
                          config.showSuccess(enable ? 'TON Proxy started' : 'TON Proxy stopped');
                          loadKeys();
                        } catch (err) {
                          setProxyError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setProxyLoading(false);
                        }
                      }}
                    />
                    <span className="toggle-track" />
                    <span className="toggle-thumb" />
                  </label>
                  <span>Enabled</span>
                  {proxyLoading && (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span className="spinner" style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        border: '2px solid var(--separator)',
                        borderTopColor: 'var(--accent)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                      {proxyStatus?.installed === false ? 'Downloading binary...' : 'Starting...'}
                    </span>
                  )}
                  {!proxyLoading && proxyStatus?.running && (
                    <span style={{ fontSize: '12px', color: 'var(--green, #22c55e)' }}>
                      Running (PID {proxyStatus.pid})
                    </span>
                  )}
                  <InfoTip text="Enable TON Proxy — auto-downloads the binary if not found" />
                </div>
                {!(proxyStatus?.enabled) && (
                  <button
                    disabled={proxyLoading || !proxyStatus?.installed}
                    onClick={async () => {
                      if (!(await confirm({ title: "Remove TON Proxy?", description: "This will remove the TON Proxy binary from disk.", variant: "danger", confirmText: "Remove" }))) return;
                      setProxyLoading(true);
                      setProxyError(null);
                      try {
                        const res = await api.uninstallTonProxy();
                        setProxyStatus(res.data);
                        config.showSuccess('TON Proxy uninstalled');
                        loadKeys();
                      } catch (err) {
                        setProxyError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setProxyLoading(false);
                      }
                    }}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      background: proxyStatus?.installed ? 'var(--red, #ef4444)' : 'var(--text-secondary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: proxyStatus?.installed ? 'pointer' : 'default',
                      opacity: proxyStatus?.installed ? 1 : 0.5,
                    }}
                  >
                    Uninstall
                  </button>
                )}
              </div>

              {/* Port */}
              <EditableField
                label="Proxy Port"
                description="HTTP proxy listen address port"
                configKey="ton_proxy.port"
                type="number"
                value={config.getLocal('ton_proxy.port') || '8080'}
                serverValue={config.getServer('ton_proxy.port') || '8080'}
                onChange={(v) => config.setLocal('ton_proxy.port', v)}
                onSave={(v) => config.saveConfig('ton_proxy.port', v)}
                onCancel={() => config.cancelLocal('ton_proxy.port')}
                min={1}
                max={65535}
                placeholder="8080"
                hotReload="restart"
              />

              {/* Binary Path */}
              <EditableField
                label="Binary Path"
                description="Custom path to tonutils-proxy-cli binary"
                configKey="ton_proxy.binary_path"
                type="text"
                value={config.getLocal('ton_proxy.binary_path')}
                serverValue={config.getServer('ton_proxy.binary_path')}
                onChange={(v) => config.setLocal('ton_proxy.binary_path', v)}
                onSave={(v) => config.saveConfig('ton_proxy.binary_path', v)}
                onCancel={() => config.cancelLocal('ton_proxy.binary_path')}
                placeholder="~/.teleton/bin/tonutils-proxy-cli (auto-download)"
                hotReload="restart"
              />

            </div>
          </div>
        </>
      )}

      {/* Vector Memory Tab */}
      {activeTab === 'vector-memory' && (
        <>
          <div className="card-header">
            <div className="section-title">Vector Memory</div>
            <p className="card-description">
              Configure embeddings and optional Upstash Vector access for semantic memory.
            </p>
          </div>
          <div className="card">
            <ConfigSection
              keys={VECTOR_MEMORY_KEYS}
              configKeys={configKeys}
              getLocal={config.getLocal}
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
            />
          </div>
        </>
      )}

      {/* MRTPOTO Tab */}
      {activeTab === 'mrtpoto' && (
        <MtprotoSettingsPanel
          showSuccess={config.showSuccess}
          setError={config.setError}
        />
      )}

      {/* YOLO Tab */}
      {activeTab === 'yolo' && (
        <>
          <div className="card-header">
            <div className="section-title">YOLO — Exec Settings</div>
            <p className="card-description">
              Configure shell command execution capabilities for the agent. Choose between disabled, allowlist (safe), or full YOLO access.
            </p>
          </div>
          <div className="card">
            <YoloSettingsPanel
              getLocal={config.getLocal}
              saveConfig={config.saveConfig}
              onArraySave={handleArraySave}
            />
          </div>
        </>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <>
          <div className="card-header">
            <div className="section-title">Advanced</div>
          </div>
          <div className="card">
            <ConfigSection
              keys={ADVANCED_KEYS}
              configKeys={configKeys}
              getLocal={config.getLocal}
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
            />
          </div>
        </>
      )}

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <>
          <div className="card-header">
            <div className="section-title">Sessions</div>
            <p className="card-description">Session reset and expiry policies</p>
          </div>
          <div className="card">
            <ConfigSection
              keys={SESSION_KEYS}
              configKeys={configKeys}
              getLocal={config.getLocal}
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
            />
          </div>
        </>
      )}

      {/* Tool RAG Tab */}
      {activeTab === 'tool-rag' && config.toolRag && (
        <>
          <div className="card-header">
            <div className="section-title">Tool RAG</div>
            <p className="card-description">
              Semantic tool selection — sends only the most relevant tools to the LLM per message.
            </p>
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Enabled</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.toolRag.enabled}
                  onChange={() => config.saveToolRag({ enabled: !config.toolRag!.enabled })}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '13px', color: 'var(--text)' }}>
                  Top-K <InfoTip text="Number of most relevant tools to send per message" />
                </label>
                <Select
                  value={String(config.toolRag.topK)}
                  options={['10', '15', '20', '25', '30', '40', '50']}
                  onChange={(v) => config.saveToolRag({ topK: Number(v) })}
                  style={{ minWidth: '80px' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="skip-unlimited">
                  Skip Unlimited <InfoTip text="Skip RAG filtering for providers with no tool limit" />
                </label>
                <label className="toggle">
                  <input
                    id="skip-unlimited"
                    type="checkbox"
                    checked={config.toolRag.skipUnlimitedProviders ?? false}
                    onChange={() => config.saveToolRag({ skipUnlimitedProviders: !config.toolRag!.skipUnlimitedProviders })}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
              </div>
            </div>
            <div style={{ marginTop: '12px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)', display: 'block', marginBottom: '6px' }}>
                Always Include (glob patterns) <InfoTip text="Tool name patterns that are always included regardless of RAG scoring" />
              </label>
              <ArrayInput
                value={config.toolRag.alwaysInclude ?? []}
                onChange={(values) => config.saveToolRag({ alwaysInclude: values })}
                placeholder="e.g. telegram_send_*"
              />
            </div>
          </div>
        </>
      )}

      {/* Backup Tab */}
      {activeTab === 'backup' && (
        <ExportImportPanel />
      )}
    </div>
  );
}
