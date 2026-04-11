import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { logStore } from '../lib/log-store';
import { useAgentStatus } from '../hooks/useAgentStatus';

type ActionStatus = { type: 'success' | 'error'; message: string } | null;

export function QuickActions() {
  const { state } = useAgentStatus();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [status, setStatus] = useState<ActionStatus>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  function showStatus(type: 'success' | 'error', message: string) {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 4000);
  }

  async function handleExportLogs() {
    const logs = logStore.getLogs();
    if (logs.length === 0) {
      showStatus('error', 'No logs to export');
      return;
    }
    const lines = logs.map(
      (l) => `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] ${l.message}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('success', `Exported ${logs.length} log entries`);
  }

  async function handleClearCache() {
    setShowClearConfirm(false);
    setLoadingAction('cache');
    try {
      const res = await api.clearCache();
      if (res.success) {
        showStatus('success', res.data?.message ?? 'Cache cleared');
      } else {
        showStatus('error', res.data?.message ?? 'Failed to clear cache');
      }
    } catch (err) {
      showStatus('error', err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleRestartAgent() {
    setLoadingAction('restart');
    try {
      // Stop first, then poll until stopped, then start
      await api.agentStop();
      // Poll until stopped, then start
      let waited = 0;
      const poll = setInterval(async () => {
        waited += 500;
        try {
          const j = await api.agentStatus();
          if (j.state === 'stopped' || j.state === 'error' || waited > 15000) {
            clearInterval(poll);
            await api.agentStart();
            showStatus('success', 'Agent restarting…');
            setLoadingAction(null);
          }
        } catch {
          clearInterval(poll);
          showStatus('error', 'Restart failed — check logs');
          setLoadingAction(null);
        }
      }, 500);
    } catch (err) {
      showStatus('error', err instanceof Error ? err.message : 'Restart failed');
      setLoadingAction(null);
    }
  }

  async function handleSendTestMessage() {
    setLoadingAction('test');
    try {
      const res = await api.sendTestMessage();
      if (res.success) {
        showStatus('success', res.data?.message ?? 'Test message sent');
      } else {
        showStatus('error', 'Failed to send test message');
      }
    } catch (err) {
      showStatus('error', err instanceof Error ? err.message : 'Failed to send test message');
    } finally {
      setLoadingAction(null);
    }
  }

  const agentRunning = state === 'running';

  return (
    <div className="card">
      <div className="section-title" style={{ marginBottom: '12px' }}>Quick Actions</div>

      {status && (
        <div className={`alert ${status.type}`} style={{ marginBottom: '12px', fontSize: '13px' }}>
          {status.message}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button
          className="btn-ghost btn-sm"
          onClick={handleExportLogs}
          disabled={loadingAction !== null}
          title="Download current live log buffer as a .txt file"
        >
          Export Logs
        </button>

        <button
          className="btn-ghost btn-sm"
          onClick={() => setShowClearConfirm(true)}
          disabled={loadingAction !== null}
          title="Clear in-memory caches (embedder, tool registry)"
        >
          {loadingAction === 'cache' ? 'Clearing…' : 'Clear Cache'}
        </button>

        <button
          className="btn-ghost btn-sm"
          onClick={handleRestartAgent}
          disabled={loadingAction !== null || !agentRunning}
          title={agentRunning ? 'Stop then restart the agent' : 'Agent must be running to restart'}
        >
          {loadingAction === 'restart' ? 'Restarting…' : 'Restart Agent'}
        </button>

        <button
          className="btn-ghost btn-sm"
          onClick={handleSendTestMessage}
          disabled={loadingAction !== null || !agentRunning}
          title={agentRunning ? 'Send "Test message from Web UI" to your configured Telegram chat' : 'Agent must be running to send messages'}
        >
          {loadingAction === 'test' ? 'Sending…' : 'Send Test Message'}
        </button>
      </div>

      {/* Clear Cache confirmation dialog */}
      {showClearConfirm && createPortal(
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Clear Cache?</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
              This will clear in-memory caches. The agent will rebuild them on next use.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn-ghost"
                onClick={() => setShowClearConfirm(false)}
                style={{ fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleClearCache}
                style={{ fontSize: '13px' }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
