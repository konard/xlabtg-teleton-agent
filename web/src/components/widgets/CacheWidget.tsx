import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CacheResourceType, type CacheStats } from '../../lib/api';

const TYPE_LABELS: Record<CacheResourceType, string> = {
  tools: 'Tools',
  prompts: 'Prompts',
  embeddings: 'Embeddings',
  api_responses: 'API',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function CacheWidget() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCacheStats();
      setStats(res.data ?? null);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  function showStatus(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 3000);
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
      await load();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const typeRows = useMemo(() => {
    if (!stats) return [];
    return (Object.keys(TYPE_LABELS) as CacheResourceType[]).map((type) => ({
      type,
      label: TYPE_LABELS[type],
      stats: stats.byType[type],
    }));
  }, [stats]);

  const recentEntries = stats?.entries.slice(0, 6) ?? [];

  return (
    <div className="cache-widget">
      <div className="cache-controls">
        <div className="cache-state">{stats?.enabled === false ? 'Disabled' : 'Active'}</div>
        <div className="cache-buttons">
          <button className="btn-ghost btn-sm" type="button" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button
            className="btn-ghost btn-sm"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              runAction('warm', async () => {
                const res = await api.warmCache();
                const tools = res.data?.warmed.tools.length ?? 0;
                const prompts = res.data?.warmed.prompts.length ?? 0;
                showStatus(`Warmed ${tools} tools, ${prompts} prompts`);
              })
            }
          >
            Warm
          </button>
          <button
            className="btn-ghost btn-sm"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              runAction('clear', async () => {
                await api.deleteCache();
                showStatus('Cache cleared');
              })
            }
          >
            Clear
          </button>
        </div>
      </div>

      {status && <div className="cache-status">{status}</div>}

      <div className="cache-summary-grid">
        <div className="cache-metric">
          <span>Hit rate</span>
          <strong>{stats ? formatPercent(stats.hitRate) : '--'}</strong>
        </div>
        <div className="cache-metric">
          <span>Entries</span>
          <strong>{stats ? `${stats.size}/${stats.maxEntries}` : '--'}</strong>
        </div>
        <div className="cache-metric">
          <span>Memory</span>
          <strong>{stats ? formatBytes(stats.memoryBytes) : '--'}</strong>
        </div>
        <div className="cache-metric">
          <span>Saved</span>
          <strong>{stats ? formatMs(stats.latencySavedMs) : '--'}</strong>
        </div>
      </div>

      <div className="cache-type-list">
        {loading && !stats ? (
          <div className="cache-empty">Loading...</div>
        ) : (
          typeRows.map((row) => (
            <button
              className="cache-type-row"
              key={row.type}
              type="button"
              disabled={busy !== null}
              title={`Invalidate ${row.label}`}
              onClick={() =>
                runAction(row.type, async () => {
                  const res = await api.invalidateCache({ type: row.type });
                  showStatus(`Invalidated ${res.data?.invalidated ?? 0} entries`);
                })
              }
            >
              <span>{row.label}</span>
              <span>{row.stats.size}</span>
              <span>{formatBytes(row.stats.memoryBytes)}</span>
              <span>
                {row.stats.hits}/{row.stats.misses}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="cache-entry-list">
        {recentEntries.length === 0 ? (
          <div className="cache-empty">No cache entries</div>
        ) : (
          recentEntries.map((entry) => (
            <div className="cache-entry-row" key={entry.key}>
              <div className="cache-entry-main">
                <span>{TYPE_LABELS[entry.type]}</span>
                <strong>{entry.resourceId}</strong>
              </div>
              <button
                className="btn-ghost btn-sm cache-entry-remove"
                type="button"
                title="Invalidate entry"
                disabled={busy !== null}
                onClick={() =>
                  runAction(entry.key, async () => {
                    const res = await api.invalidateCache({ key: entry.key });
                    showStatus(`Invalidated ${res.data?.invalidated ?? 0} entry`);
                  })
                }
              >
                x
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
