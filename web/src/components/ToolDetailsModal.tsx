import { useEffect, useState } from 'react';
import { api, ToolDetails } from '../lib/api';

interface ToolDetailsModalProps {
  toolName: string;
  onClose: () => void;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'Never';
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ToolDetailsModal({ toolName, onClose }: ToolDetailsModalProps) {
  const [details, setDetails] = useState<ToolDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Test tool state
  const [testParams, setTestParams] = useState('{}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getToolDetails(toolName)
      .then((res) => {
        setDetails(res.data ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [toolName]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(testParams);
      } catch {
        setTestError('Invalid JSON in parameters');
        setTesting(false);
        return;
      }
      const res = await api.testTool(toolName, params);
      setTestResult(JSON.stringify(res.data, null, 2));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: '640px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
              {toolName}
            </div>
            {details && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                {details.module && <span>module: <span style={{ color: 'var(--text)' }}>{details.module}</span></span>}
                {details.category && <span style={{ marginLeft: '10px' }}>category: <span style={{ color: 'var(--text)' }}>{details.category}</span></span>}
              </div>
            )}
          </div>
          <button
            className="btn-ghost btn-sm"
            onClick={onClose}
            style={{ marginLeft: '12px', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {loading && <div className="loading" style={{ padding: '20px 0' }}>Loading…</div>}

        {error && (
          <div className="alert error">{error}</div>
        )}

        {details && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Status badges */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className={`badge ${details.enabled ? 'always' : 'warn'}`}>
                {details.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className="badge">
                {details.scope}
              </span>
            </div>

            {/* Description */}
            {details.description && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                  Description
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.5 }}>
                  {details.description}
                </div>
              </div>
            )}

            {/* Parameters */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                Parameters Schema
              </div>
              <pre style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
                background: 'var(--surface)',
                border: '1px solid var(--separator)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                overflowX: 'auto',
                maxHeight: '200px',
                overflowY: 'auto',
                lineHeight: 1.5,
                margin: 0,
              }}>
                {JSON.stringify(details.parameters, null, 2)}
              </pre>
            </div>

            {/* Usage stats */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                Usage Statistics
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '8px',
              }}>
                {[
                  { label: 'Total calls', value: String(details.stats.totalCalls) },
                  { label: 'Successes', value: String(details.stats.successCount) },
                  { label: 'Failures', value: String(details.stats.failureCount) },
                  { label: 'Avg duration', value: formatDuration(details.stats.avgDurationMs) },
                  { label: 'Last used', value: formatTimestamp(details.stats.lastUsedAt), wide: true },
                ].map(({ label, value, wide }) => (
                  <div
                    key={label}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--separator)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      gridColumn: wide ? '1 / -1' : undefined,
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Test Tool */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                Test Tool
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  value={testParams}
                  onChange={(e) => setTestParams(e.target.value)}
                  rows={4}
                  placeholder='{ "paramName": "value" }'
                  spellCheck={false}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    padding: '8px 10px',
                    background: 'var(--surface)',
                    border: '1px solid var(--separator)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text)',
                    resize: 'vertical',
                    outline: 'none',
                    width: '100%',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn-sm"
                    onClick={runTest}
                    disabled={testing}
                  >
                    {testing ? 'Running…' : 'Run Test'}
                  </button>
                  {(testResult || testError) && (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => { setTestResult(null); setTestError(null); }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {testError && (
                  <div className="alert error" style={{ fontSize: '12px' }}>{testError}</div>
                )}
                {testResult && (
                  <pre style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text)',
                    background: 'var(--surface)',
                    border: '1px solid var(--separator)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    overflowX: 'auto',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    lineHeight: 1.5,
                    margin: 0,
                  }}>
                    {testResult}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
