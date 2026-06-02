import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigState } from '../hooks/useConfigState';
import { POLICY_OPTIONS } from '../components/TelegramSettingsPanel';
import { AllowLists } from '../components/AllowLists';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { PillTabs } from '../components/PillTabs';
import { InfoTip } from '../components/InfoTip';
import { Select } from '../components/Select';
import { ProviderSwitchZone, PROVIDER_OPTIONS, PROVIDER_LABELS } from '../components/ProviderControl';
import { api, StatusData } from '../lib/api';
import { errMsg } from '../lib/utils';
import { Skeleton } from '../components/Skeleton';
import { Alert } from '../components/Alert';

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

function fmtUptime(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function StatItem({ label, value, mono, to }: { label: string; value: string | number; mono?: boolean; to?: string }) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <span
      className={`stat-item${clickable ? ' clickable' : ''}`}
      onClick={clickable ? () => navigate(to) : undefined}
      {...(clickable ? { role: 'button', tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') navigate(to); } } : {})}
    >
      <span className={`stat-v${mono ? ' mono' : ''}`}>{value}</span>
      <span className="stat-k">{label}</span>
    </span>
  );
}

export function Dashboard() {
  const {
    loading, error, setError, status, stats,
    getLocal, saveConfig,
    modelOptions, pendingProvider, pendingMeta,
    pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel,
    loadData,
  } = useConfigState();

  const handleArraySave = async (key: string, values: string[]) => {
    try {
      await api.setConfigKey(key, values);
      await loadData();
    } catch (err) {
      setError(errMsg(err));
    }
  };

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

  if (loading) {
    return (
      <div className="dashboard-root">
        <div className="header"><h1>Dashboard</h1><p>System overview</p></div>
        <div className="card dash-hero"><Skeleton width={40} height={40} /><Skeleton width={220} height={28} /></div>
        <div className="dash-statbar"><Skeleton width="100%" height={18} /></div>
      </div>
    );
  }
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const s = liveStatus ?? status;
  const platform = s.platform ? (PLATFORM_LABEL[s.platform] ?? s.platform) : null;

  return (
    <div className="dashboard-root">
      <div className="header"><h1>Dashboard</h1><p>System overview</p></div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      {/* ── Status hero ── */}
      <div className="card dash-hero">
        <span className="dash-orb" aria-hidden="true" />
        <div className="dash-hero-main">
          <div className="dash-hero-title">
            Agent
            <span className="dash-hero-state">Running</span>
          </div>
          <div className="dash-hero-sub">
            {[`up ${fmtUptime(s.uptime)}`, platform].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="dash-hero-selects">
          <div className="dash-hero-field">
            <span className="dash-hero-label">Provider</span>
            <Select
              value={pendingProvider ?? getLocal('agent.provider')}
              options={PROVIDER_OPTIONS}
              labels={PROVIDER_LABELS}
              onChange={handleProviderChange}
            />
          </div>
          <div className="dash-hero-field model">
            <span className="dash-hero-label">Model</span>
            <Select
              value={getLocal('agent.model')}
              options={modelOptions.map((m) => m.value)}
              labels={modelOptions.map((m) => m.name)}
              onChange={(v) => saveConfig('agent.model', v)}
            />
          </div>
        </div>
      </div>

      {pendingProvider && pendingMeta && (
        <div className="card" style={{ marginBottom: '14px' }}>
          <ProviderSwitchZone
            pendingMeta={pendingMeta}
            pendingApiKey={pendingApiKey}
            setPendingApiKey={setPendingApiKey}
            pendingValidating={pendingValidating}
            pendingError={pendingError}
            setPendingError={setPendingError}
            onConfirm={handleProviderConfirm}
            onCancel={handleProviderCancel}
          />
        </div>
      )}

      {/* ── Metrics ── */}
      <div className="dash-statbar">
        <StatItem label="Messages" value={stats.messages.toLocaleString()} to="/conversations" />
        <StatItem label="Chats" value={stats.chats} to="/conversations" />
        <StatItem label="Knowledge" value={stats.knowledge} to="/memory" />
        <StatItem label="Tools" value={s.toolCount} to="/tools" />
        <StatItem label="Sessions" value={s.sessionCount} />
        <StatItem label="Tokens" value={s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0'} mono />
        <StatItem label="Cost" value={s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} mono />
        <StatItem label="GRAM" value={balance ?? '—'} mono to="/wallet" />
      </div>

      {/* ── Settings (side by side) ── */}
      <div className="dashboard-settings">
        <div className="card">
          <div className="card-header"><div className="section-title">Access Policy</div></div>
          <div className="dash-policy">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>DM Policy <InfoTip text="Who can DM the agent — All, Allow List, Admins only, or Off." /></label>
              <PillTabs value={getLocal('telegram.dm_policy')} options={POLICY_OPTIONS} onChange={(v) => saveConfig('telegram.dm_policy', v)} ariaLabel="DM policy" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Group Policy <InfoTip text="Which groups the agent responds in — All, Allow List, Admins only, or Off." /></label>
              <PillTabs value={getLocal('telegram.group_policy')} options={POLICY_OPTIONS} onChange={(v) => saveConfig('telegram.group_policy', v)} ariaLabel="Group policy" />
            </div>
          </div>
        </div>
        <div className="card dash-card-fill">
          <AllowLists getLocal={getLocal} onSave={handleArraySave} />
        </div>
        {s.platform === 'linux' && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <ExecSettingsPanel getLocal={getLocal} saveConfig={saveConfig} />
          </div>
        )}
      </div>
    </div>
  );
}
