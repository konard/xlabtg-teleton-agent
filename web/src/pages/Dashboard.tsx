import { useEffect, useRef, useSyncExternalStore, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigState } from '../hooks/useConfigState';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { logStore } from '../lib/log-store';
import { api, StatusData } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { Alert } from '../components/Alert';

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

function fmtUptime(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function StatCard({ label, value, mono, to }: { label: string; value: string | number; mono?: boolean; to?: string }) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <div
      className={`stat-card${clickable ? ' clickable' : ''}`}
      onClick={clickable ? () => navigate(to) : undefined}
      {...(clickable ? { role: 'button', tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') navigate(to); } } : {})}
    >
      <span className={`stat-value${mono ? ' mono' : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
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

  // Poll /api/status every 10s for live metrics (tokens, uptime).
  const [liveStatus, setLiveStatus] = useState<StatusData | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => api.getStatus().then((r) => { if (active) setLiveStatus(r.data); }).catch(() => {});
    const id = setInterval(poll, 10_000);
    api.getWallet().then((r) => { if (active) setBalance(r.data?.balance ?? null); }).catch(() => {});
    return () => { active = false; clearInterval(id); };
  }, []);

  const logs = useSyncExternalStore((cb) => logStore.subscribe(cb), () => logStore.getLogs());
  const connected = useSyncExternalStore((cb) => logStore.subscribe(cb), () => logStore.isConnected());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logStore.connect(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  if (loading) {
    return (
      <div className="dashboard-root">
        <div className="header"><h1>Dashboard</h1><p>System overview</p></div>
        <div className="card dash-hero"><Skeleton width={40} height={40} /><Skeleton width={220} height={28} /></div>
        <div className="stat-grid">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={68} />)}
        </div>
      </div>
    );
  }
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const s = liveStatus ?? status;
  const platform = s.platform ? (PLATFORM_LABEL[s.platform] ?? s.platform) : null;
  const provider = s.provider ? s.provider.charAt(0).toUpperCase() + s.provider.slice(1) : null;
  const modelLabel = modelOptions.find((m) => m.value === s.model)?.name ?? s.model;

  return (
    <div className="dashboard-root">
      <div className="header"><h1>Dashboard</h1><p>System overview</p></div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      {/* ── Status hero ── */}
      <div className="card dash-hero">
        <span className="dash-orb" aria-hidden="true" />
        <div className="dash-hero-main">
          <div className="dash-hero-title">
            {modelLabel || 'Agent'}
            <span className="dash-hero-state">Running</span>
          </div>
          <div className="dash-hero-sub">
            {[provider, `up ${fmtUptime(s.uptime)}`, platform].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div className="stat-grid">
        <StatCard label="Messages" value={stats.messages.toLocaleString()} to="/conversations" />
        <StatCard label="Chats" value={stats.chats} to="/conversations" />
        <StatCard label="Knowledge" value={stats.knowledge} to="/memory" />
        <StatCard label="Tools" value={s.toolCount} to="/tools" />
        <StatCard label="Sessions" value={s.sessionCount} />
        <StatCard label="Tokens" value={s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0'} mono />
        <StatCard label="Cost" value={s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} mono />
        <StatCard label="GRAM" value={balance ?? '—'} mono to="/wallet" />
      </div>

      {/* ── Settings (side by side) ── */}
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
    <div className="card dash-logs">
      <button className="dash-logs-toggle" onClick={toggle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          Live Logs
          {logs.length > 0 && <span className="dash-logs-count">({logs.length})</span>}
        </span>
        <span className="dash-logs-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>&#9660;</span>
      </button>
      {open && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 14px 6px' }}>
            <button className="btn-ghost btn-sm" onClick={() => logStore.clear()}>Clear</button>
          </div>
          <div className="dashboard-logs-scroll">
            {logs.length === 0 ? (
              <div className="empty">Waiting for logs…</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className={`badge ${log.level === 'warn' ? 'warn' : log.level === 'error' ? 'error' : 'info'}`}>
                    {log.level.toUpperCase()}
                  </span>{' '}
                  <span style={{ color: 'var(--text-tertiary)' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
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
