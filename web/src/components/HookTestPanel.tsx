/**
 * HookTestPanel — test your hook rules against a sample message.
 * Shows which hooks fire, debug trace, and overall result.
 */

import { useState, useRef } from 'react';
import { api } from '../lib/api';
import type { HookTestResult, HookTraceStep } from '../lib/api';

function TraceLog({ steps }: { steps: HookTraceStep[] }) {
  return (
    <div style={{
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.6',
      padding: '10px 12px',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: '8px',
      border: '1px solid var(--separator)',
    }}>
      {steps.map((s, i) => (
        <div key={i} style={{ color: s.matched ? 'var(--green, #30d158)' : 'var(--text-secondary)' }}>
          {s.matched ? '✓ ' : '· '}{s.step}
        </div>
      ))}
    </div>
  );
}

function ResultBadge({ blocked }: { blocked: boolean }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '4px 12px',
      borderRadius: '20px',
      fontWeight: 700,
      fontSize: '13px',
      background: blocked ? 'rgba(255,59,48,0.15)' : 'rgba(48,209,88,0.15)',
      color: blocked ? 'var(--red, #ff3b30)' : 'var(--green, #30d158)',
      border: `1px solid ${blocked ? 'rgba(255,59,48,0.3)' : 'rgba(48,209,88,0.3)'}`,
    }}>
      {blocked ? '🚫 BLOCKED' : '✅ ALLOWED'}
    </span>
  );
}

export function HookTestPanel() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<HookTestResult | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runTest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.testHooks(message);
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runTest();
    }
  };

  return (
    <div className="card" style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>Test Panel</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Debug mode
        </label>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>
        Test your message against current hook rules without sending anything to Telegram.
      </p>

      <textarea
        ref={textareaRef}
        placeholder="Test your message... (Ctrl+Enter to run)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={4000}
        rows={3}
        style={{ width: '100%', resize: 'vertical', marginBottom: '8px' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: result ? '16px' : 0 }}>
        <button
          className="btn-sm"
          onClick={runTest}
          disabled={loading || !message.trim()}
        >
          {loading ? 'Testing...' : 'Test Hooks'}
        </button>
        {result && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => { setResult(null); setMessage(''); }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          Ctrl+Enter
        </span>
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: '10px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gap: '12px' }}>
          {/* Overall result */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <ResultBadge blocked={result.blocked} />
            {result.blocked && result.blockResponse && (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Reply: <em>"{result.blockResponse}"</em>
              </span>
            )}
            {!result.blocked && result.injectedContext && (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Context injected: {result.injectedContext.length} chars
              </span>
            )}
          </div>

          {/* Triggered hooks */}
          {result.triggeredHooks.length > 0 ? (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Matched Triggers
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {result.triggeredHooks.map((h, i) => (
                  <div key={i} className="tool-row" style={{ padding: '8px 12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>"{h.keyword}"</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                        → inject context ({h.context.length} chars)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !result.blocked && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              No hooks matched
            </div>
          )}

          {/* Debug trace */}
          {debugMode && result.trace.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Step-by-step trace
              </div>
              <TraceLog steps={result.trace} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
