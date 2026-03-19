import { useEffect, useState } from 'react';
import { useConfigState } from '../hooks/useConfigState';
import { logStore } from '../lib/log-store';
import { api, StatusData } from '../lib/api';
import { DashboardGrid } from '../components/widgets/DashboardGrid';
import { HealthCheck } from '../components/HealthCheck';

export function Dashboard() {
  const {
    loading, error, setError, saveSuccess, status, stats,
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
    poll();
    const id = setInterval(poll, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    logStore.connect();
  }, []);

  if (loading) return <div className="loading">Loading...</div>;
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const currentStatus = liveStatus ?? status;

  return (
    <div className="dashboard-root">
      <div className="header">
        <h1>Dashboard</h1>
        <p>System overview</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>Dismiss</button>
        </div>
      )}

      {saveSuccess && (
        <div className="alert success" style={{ marginBottom: '16px' }}>
          {saveSuccess}
        </div>
      )}

      <DashboardGrid
        status={currentStatus}
        stats={stats}
        showExec={currentStatus.platform === 'linux'}
        getLocal={getLocal}
        getServer={getServer}
        setLocal={setLocal}
        saveConfig={saveConfig}
        cancelLocal={cancelLocal}
        modelOptions={modelOptions}
        pendingProvider={pendingProvider}
        pendingMeta={pendingMeta}
        pendingApiKey={pendingApiKey}
        setPendingApiKey={setPendingApiKey}
        pendingValidating={pendingValidating}
        pendingError={pendingError}
        setPendingError={setPendingError}
        handleProviderChange={handleProviderChange}
        handleProviderConfirm={handleProviderConfirm}
        handleProviderCancel={handleProviderCancel}
      />

      <HealthCheck />
    </div>
  );
}
