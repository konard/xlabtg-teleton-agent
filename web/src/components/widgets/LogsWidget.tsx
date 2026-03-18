import { useRef, useEffect, useSyncExternalStore } from 'react';
import { logStore } from '../../lib/log-store';

export function LogsWidget() {
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="logs-widget-inner">
      <div className="dashboard-logs-header">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          Live Logs
        </div>
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
    </div>
  );
}
