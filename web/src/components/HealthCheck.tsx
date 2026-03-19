import { useEffect, useState, useCallback } from 'react';
import { api, HealthCheckResponse, HealthStatus } from '../lib/api';

const STATUS_COLORS: Record<HealthStatus, string> = {
  healthy: 'var(--green)',
  degraded: '#FF9F0A',
  unhealthy: 'var(--red)',
  unconfigured: 'var(--text-tertiary)',
};

const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unconfigured: 'Not configured',
};

const CHECK_LABELS: Record<string, string> = {
  agent: 'Agent Process',
  database: 'Database',
  disk: 'Disk / Memory',
  memory: 'Node.js Heap',
  mcp: 'MCP Servers',
};

function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: STATUS_COLORS[status],
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

function formatDetails(details?: Record<string, unknown>): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
}

export function HealthCheck() {
  const [data, setData] = useState<HealthCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHealthCheck();
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount and poll every 60s
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const overallStatus = data?.status ?? 'unconfigured';

  return (
    <div className="health-check card" aria-label="System health status">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>System Health</h3>
        {data && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <StatusDot status={overallStatus} />
            <span style={{ color: STATUS_COLORS[overallStatus] }}>{STATUS_LABELS[overallStatus]}</span>
          </span>
        )}
        <button
          className="btn-ghost btn-sm"
          onClick={refresh}
          disabled={loading}
          style={{ marginLeft: 'auto', fontSize: '12px' }}
          aria-label="Refresh health status"
        >
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="alert error" style={{ fontSize: '12px', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      {data && (
        <div>
          {Object.entries(data.checks).map(([key, check]) => (
            <div key={key} style={{ marginBottom: '2px' }}>
              <button
                className="btn-ghost"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '6px 8px',
                  fontSize: '13px',
                  textAlign: 'left',
                  borderRadius: 'var(--radius-sm)',
                }}
                onClick={() => setExpanded(expanded === key ? null : key)}
                aria-expanded={expanded === key}
              >
                <StatusDot status={check.status} />
                <span style={{ flex: 1 }}>{CHECK_LABELS[key] ?? key}</span>
                <span style={{ color: STATUS_COLORS[check.status], fontSize: '11px' }}>
                  {STATUS_LABELS[check.status]}
                </span>
                {check.latency_ms !== undefined && (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                    {check.latency_ms}ms
                  </span>
                )}
                <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                  {expanded === key ? '▲' : '▼'}
                </span>
              </button>

              {expanded === key && (
                <div style={{ padding: '6px 8px 8px 28px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {check.message && <div style={{ color: 'var(--red)', marginBottom: '4px' }}>{check.message}</div>}
                  {check.details && <div>{formatDetails(check.details)}</div>}
                </div>
              )}
            </div>
          ))}
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Last checked: {new Date(data.checked_at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
