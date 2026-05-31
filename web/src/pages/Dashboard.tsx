import { useEffect, useRef, useSyncExternalStore, useState, useCallback } from 'react';
import { useConfigState } from '../hooks/useConfigState';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { logStore } from '../lib/log-store';
import { api, StatusData } from '../lib/api';
import { Loading } from '../components/Loading';
import { Alert } from '../components/Alert';

function Metric({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export function Dashboard() {
  const {
    loading, error, setError, status, stats,
    getLocal, getServer, setLocal, cancelLocal, saveConfig,
    modelOptions, pendingProvider, pendingMeta,
    pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel,
  } = useConfigState();

  // Poll /api/status every 10s for live metrics (tokens, uptime)
  const [liveStatus, setLiveStatus] = useState<StatusData | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => {
      api.getStatus().then((res) => { if (active) setLiveStatus(res.data); }).catch(() => {});
    };
    const id = setInterval(poll, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const currentStatus = liveStatus ?? status;

  const logs = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.getLogs()
  );
  const connected = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.isConnected()
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logStore.connect();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (loading) return <Loading />;
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const s = currentStatus ?? status;
  const uptime = s.uptime < 3600
    ? `${Math.floor(s.uptime / 60)}m`
    : `${Math.floor(s.uptime / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`;

  return (
    <div className="dashboard-root">
      <div className="header">
        <h1>Dashboard</h1>
        <p>System overview</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}


      {/* ── Status bar ─────────────────────────────────────── */}
      <div className="card status-bar">
        <div className="status-row">
          <Metric label="Uptime" value={uptime} />
          <Metric label="Sessions" value={s.sessionCount} />
          <Metric label="Tools" value={s.toolCount} />
          <Metric label="Knowledge" value={stats.knowledge} />
          <Metric label="Messages" value={stats.messages.toLocaleString()} />
          <Metric label="Chats" value={stats.chats} />
          <Metric label="Tokens" value={s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0'} mono />
          <Metric label="Cost" value={s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} mono />
        </div>
      </div>

      {/* ── Settings (side by side) ────────────────────────── */}
      <div className="dashboard-settings">
        <div className="card">
          <AgentSettingsPanel
            compact
            getLocal={getLocal} getServer={getServer} setLocal={setLocal} saveConfig={saveConfig} cancelLocal={cancelLocal}
            modelOptions={modelOptions}
            pendingProvider={pendingProvider} pendingMeta={pendingMeta}
            pendingApiKey={pendingApiKey} setPendingApiKey={setPendingApiKey}
            pendingValidating={pendingValidating}
            pendingError={pendingError} setPendingError={setPendingError}
            handleProviderChange={handleProviderChange}
            handleProviderConfirm={handleProviderConfirm}
            handleProviderCancel={handleProviderCancel}
          />
        </div>
        <div className="card">
          <TelegramSettingsPanel getLocal={getLocal} getServer={getServer} setLocal={setLocal} saveConfig={saveConfig} cancelLocal={cancelLocal} />
        </div>
        {s.platform === 'linux' && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <ExecSettingsPanel getLocal={getLocal} saveConfig={saveConfig} />
          </div>
        )}
      </div>

      {/* ── Live Logs (collapsible) ── */}
      <LogsPanel logs={logs} connected={connected} bottomRef={bottomRef} />
    </div>
  );
}

function LogsPanel({ logs, connected, bottomRef }: {
  logs: Array<{ level: string; timestamp: number; message: string }>;
  connected: boolean;
  bottomRef: React.RefObject<HTMLDivElement>;
}) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: '12px' }}>
      <button
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          Live Logs
          {logs.length > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>
              ({logs.length})
            </span>
          )}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
          &#9660;
        </span>
      </button>
      {open && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 14px 6px' }}>
            <button className="btn-ghost btn-sm" onClick={() => logStore.clear()}>Clear</button>
          </div>
          <div className="dashboard-logs-scroll">
            {logs.length === 0 ? (
              <div className="empty">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className={`badge ${log.level === 'warn' ? 'warn' : log.level === 'error' ? 'error' : 'info'}`}>
                    {log.level.toUpperCase()}
                  </span>{' '}
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  {log.message}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </>
      )}
    </div>
  );
}
