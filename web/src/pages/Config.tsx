import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useConfigState } from '../hooks/useConfigState';
import { PillBar } from '../components/PillBar';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { Select } from '../components/Select';
import { ArrayInput } from '../components/ArrayInput';
import { EditableField } from '../components/EditableField';
import { ConfigSection } from '../components/ConfigSection';
import { InfoTip } from '../components/InfoTip';
import { InfoBanner } from '../components/InfoBanner';
import { errMsg } from '../lib/utils';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';

const TABS = [
  { id: 'llm', label: 'LLM' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'ton-proxy', label: 'TON Proxy' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'tool-rag', label: 'Tool RAG' },
];

const API_KEY_KEYS = ['agent.api_key', 'telegram.bot_token', 'tavily_api_key', 'tonapi_key', 'toncenter_api_key'];
const ADVANCED_KEYS = [
  'embedding.provider', 'embedding.model', 'webui.port', 'webui.log_requests',
  'deals.enabled', 'deals.expiry_seconds', 'deals.buy_max_floor_percent', 'deals.sell_min_floor_percent',
  'agent.base_url', 'dev.hot_reload',
];
const SESSION_KEYS = [
  'agent.session_reset_policy.daily_reset_enabled',
  'agent.session_reset_policy.daily_reset_hour',
  'agent.session_reset_policy.idle_expiry_enabled',
  'agent.session_reset_policy.idle_expiry_minutes',
];

export function Config() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'llm';

  const confirm = useConfirm();

  const config = useConfigState();
  const configKeys = config.configKeys;

  // TON Proxy state
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; installed: boolean; port: number; enabled: boolean; pid?: number } | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);

  const handleTabChange = (id: string) => {
    setSearchParams({ tab: id }, { replace: true });
  };

  // Load proxy status when TON Proxy tab is active
  useEffect(() => {
    if (activeTab !== 'ton-proxy') return;
    api.getTonProxyStatus()
      .then((res) => setProxyStatus(res.data))
      .catch((err) => toast.error(errMsg(err)));
  }, [activeTab]);

  const handleArraySave = async (key: string, values: string[]) => {
    config.setError(null);
    try {
      await api.setConfigKey(key, values);
      config.loadData();
    } catch (err) {
      config.setError(errMsg(err));
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


      <PillBar tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* LLM Tab */}
      {activeTab === 'llm' && (
        <>
          <div className="card-header">
            <div className="section-title">Agent</div>
          </div>
          <InfoBanner>
            Choose the AI provider and model that powers the agent. Stronger models reason better but cost more per message. The API key is sent only to the selected provider.
          </InfoBanner>
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
                  type="text"
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

      {/* Heartbeat Tab */}
      {activeTab === 'heartbeat' && (
        <>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="section-title" style={{ margin: 0 }}>Heartbeat</div>
              <label className="toggle" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={config.getLocal('heartbeat.enabled') === 'true'}
                  onChange={async (e) => {
                    const val = e.target.checked;
                    try {
                      await config.saveConfig('heartbeat.enabled', String(val));
                      toast.success(val ? 'Heartbeat enabled' : 'Heartbeat disabled');
                    } catch (err) {
                      toast.error(errMsg(err));
                    }
                  }}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
            </div>
          </div>
          <InfoBanner>
            The agent wakes up on a timer, reads its HEARTBEAT.md checklist, and executes each task autonomously (check feeds, send reports, monitor wallets...). If nothing needs doing, it stays silent. Edit HEARTBEAT.md in the Soul tab to define what the agent should do on each tick.
          </InfoBanner>
          <div className="card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              <EditableField
                label="Interval"
                description="How often the agent wakes up to run its checklist. Lower = more responsive, higher = less resource usage. Restart required."
                configKey="heartbeat.interval_ms"
                type="number"
                value={String(Math.round(Number(config.getLocal('heartbeat.interval_ms') || 1800000) / 60000))}
                serverValue={String(Math.round(Number(config.getServer('heartbeat.interval_ms') || 1800000) / 60000))}
                onChange={(v) => config.setLocal('heartbeat.interval_ms', String(Number(v) * 60000))}
                onSave={(v) => config.saveConfig('heartbeat.interval_ms', String(Number(v) * 60000))}
                onCancel={() => config.cancelLocal('heartbeat.interval_ms')}
                min={1}
                max={1440}
                placeholder="30"
                hotReload="restart"
                inline
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Self-configurable</span>
                  <InfoTip text="When on, the agent can adjust its own wake-up interval and prompt. When off, only you (admin) can change these settings from this dashboard." />
                </div>
                <label className="toggle" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={config.getLocal('heartbeat.self_configurable') === 'true'}
                    onChange={async (e) => {
                      const val = e.target.checked;
                      try {
                        await config.saveConfig('heartbeat.self_configurable', String(val));
                        toast.success('Settings saved');
                      } catch (err) {
                        toast.error(errMsg(err));
                      }
                    }}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
              </div>
            </div>
          </div>
        </>
      )}

      {/* API Keys Tab */}
      {activeTab === 'api-keys' && (
        <>
          <div className="card-header">
            <div className="section-title">API Keys</div>
          </div>
          <InfoBanner>
            Secrets used to connect to external services. Keys are stored locally in your config file and never shared. Leave a field empty to disable that integration.
          </InfoBanner>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="section-title" style={{ margin: 0 }}>TON Proxy</div>
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
                      config.loadData();
                      toast.success(enable ? 'TON Proxy started' : 'TON Proxy stopped');
                    } catch (err) {
                      setProxyError(errMsg(err));
                      toast.error(errMsg(err));
                    } finally {
                      setProxyLoading(false);
                    }
                  }}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
              {proxyLoading && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="spinner" style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: '2px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  {proxyStatus?.installed === false ? 'Downloading...' : 'Starting...'}
                </span>
              )}
              {!proxyLoading && proxyStatus?.running && (
                <span style={{ fontSize: 12, color: 'var(--green)' }}>
                  Running (PID {proxyStatus.pid})
                </span>
              )}
            </div>
          </div>
          <InfoBanner>
            Local HTTP proxy that lets the agent browse .ton websites and TON Sites. The binary is auto-downloaded on first enable, no manual install needed.
          </InfoBanner>
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
              {/* Uninstall button */}
              {!(proxyStatus?.enabled) && (
                <div>
                  <button
                    disabled={proxyLoading || !proxyStatus?.installed}
                    onClick={async () => {
                      if (!(await confirm({ message: 'Remove the TON Proxy binary from disk?', destructive: true, confirmLabel: 'Uninstall' }))) return;
                      setProxyLoading(true);
                      setProxyError(null);
                      try {
                        const res = await api.uninstallTonProxy();
                        setProxyStatus(res.data);
                        config.loadData();
                        toast.success('TON Proxy uninstalled');
                      } catch (err) {
                        setProxyError(errMsg(err));
                        toast.error(errMsg(err));
                      } finally {
                        setProxyLoading(false);
                      }
                    }}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      background: proxyStatus?.installed ? 'var(--red)' : 'var(--text-secondary)',
                      color: 'var(--text-on-accent)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: proxyStatus?.installed ? 'pointer' : 'default',
                      opacity: proxyStatus?.installed ? 1 : 0.5,
                    }}
                  >
                    Uninstall
                  </button>
                </div>
              )}

              {/* Port */}
              <EditableField
                label="Proxy Port"
                description="HTTP proxy listen address port"
                configKey="ton_proxy.port"
                type="text"
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

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <>
          <div className="card-header">
            <div className="section-title">Advanced</div>
          </div>
          <InfoBanner>
            Low-level settings for embeddings, deals, WebUI, and dev mode. Only change these if you know what you're doing, wrong values can break the agent.
          </InfoBanner>
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
          </div>
          <InfoBanner>
            Controls how the agent manages conversation memory. Daily reset clears context at a set hour to keep responses fresh. Idle expiry forgets inactive chats after a timeout, saving tokens.
          </InfoBanner>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="section-title" style={{ margin: 0 }}>Tool RAG</div>
              <label className="toggle" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={config.toolRag.enabled}
                  onChange={async () => {
                    const next = !config.toolRag!.enabled;
                    config.setError(null);
                    try {
                      await api.updateToolRag({ enabled: next });
                      config.loadData();
                      toast.success(next ? 'Tool RAG enabled' : 'Tool RAG disabled');
                    } catch (err) {
                      config.setError(errMsg(err));
                      toast.error(errMsg(err));
                    }
                  }}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
            </div>
          </div>
          <InfoBanner>
            Instead of sending all {'>'}100 tools to the LLM every time, Tool RAG picks only the most relevant ones per message. Saves tokens and improves accuracy. Disable if the agent misses tools it should use.
          </InfoBanner>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  Top-K <InfoTip text="Max tools sent to the LLM per message. Higher = more coverage but more tokens. 20-30 is a good default." />
                </label>
                <Select
                  value={String(config.toolRag.topK)}
                  options={['10', '15', '20', '25', '30', '40', '50']}
                  onChange={(v) => config.saveToolRag({ topK: Number(v) })}
                  style={{ minWidth: '80px' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }} htmlFor="skip-unlimited">
                  Skip Unlimited <InfoTip text="When on, providers that accept unlimited tools (like Anthropic) get all tools directly, no filtering needed." />
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
              <label style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                Always Include (glob patterns) <InfoTip text="Tools matching these patterns are always sent, even if RAG doesn't pick them. Use for critical tools the agent must always have access to." />
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
    </div>
  );
}
