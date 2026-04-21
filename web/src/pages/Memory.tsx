import React, { useState, useEffect, useCallback } from 'react';
import { api, MemorySourceFile, MemoryChunk } from '../lib/api';

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Memory() {
  const [filter, setFilter] = useState('');
  const [sources, setSources] = useState<MemorySourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncSynced, setSyncSynced] = useState(false);

  // Expanded source state
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [chunks, setChunks] = useState<MemoryChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMemorySources();
      setSources(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const toggleSource = async (sourceKey: string) => {
    if (expandedSource === sourceKey) {
      setExpandedSource(null);
      setChunks([]);
      return;
    }

    setExpandedSource(sourceKey);
    setChunksLoading(true);
    try {
      const res = await api.getSourceChunks(sourceKey);
      setChunks(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChunksLoading(false);
    }
  };

  const syncVectorMemory = async () => {
    setSyncLoading(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await api.syncVectorMemory();
      const data = res.data;
      setSyncSynced(data?.synced ?? false);
      setSyncMessage(data?.message ?? 'Vector memory synchronization finished.');
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncLoading(false);
    }
  };

  const lowerFilter = filter.toLowerCase();
  const filtered = lowerFilter
    ? sources.filter((s) => s.source.toLowerCase().includes(lowerFilter))
    : sources;

  return (
    <div>
      <div className="header">
        <h1>Memory</h1>
        <p>Browse indexed knowledge sources</p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {/* Search + refresh bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--separator)', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sources..."
            style={{ flex: '1 1 220px', minWidth: 0, padding: '6px 10px', fontSize: '13px' }}
          />
          <button
            onClick={syncVectorMemory}
            disabled={syncLoading}
            title="Synchronize memory files with vector memory"
            style={{ padding: '4px 12px', fontSize: '12px', opacity: syncLoading ? 0.5 : 0.7 }}
          >
            {syncLoading ? 'Syncing...' : 'Sync Vector'}
          </button>
          <button
            onClick={loadSources}
            disabled={loading}
            style={{ padding: '4px 12px', fontSize: '12px', opacity: 0.7 }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="alert error" style={{ margin: '12px 14px' }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>Dismiss</button>
          </div>
        )}

        {syncMessage && (
          <div className="alert success" style={{ margin: '12px 14px' }}>
            {syncMessage}
            {!syncSynced && <span style={{ color: 'var(--text-secondary)' }}> Local memory is still available.</span>}
            <button onClick={() => setSyncMessage(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>Dismiss</button>
          </div>
        )}

        {/* Sources table */}
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {filter ? 'No matching sources' : 'No memory files indexed'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Source</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '80px' }}>Chunks</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '140px' }}>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((src) => {
                const isExpanded = expandedSource === src.source;
                return (
                  <React.Fragment key={src.source}>
                    <tr
                      onClick={() => toggleSource(src.source)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSource(src.source); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--separator)',
                        backgroundColor: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '6px 14px' }}>
                        <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)', marginRight: '8px' }}>
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </span>
                        {src.source}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {src.entryCount}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {formatDate(src.lastUpdated)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                        <td colSpan={3} style={{ padding: '0 14px 14px 14px' }}>
                          {chunksLoading ? (
                            <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>Loading chunks...</div>
                          ) : chunks.length === 0 ? (
                            <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>No chunks</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
                              {chunks.map((chunk) => (
                                <div
                                  key={chunk.id}
                                  style={{
                                    padding: '10px 12px',
                                    border: '1px solid var(--separator)',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--surface)',
                                  }}
                                >
                                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                    {chunk.startLine != null && chunk.endLine != null && (
                                      <span>Lines {chunk.startLine}–{chunk.endLine} &middot; </span>
                                    )}
                                    {formatDate(chunk.updatedAt)}
                                  </div>
                                  <pre style={{
                                    margin: 0,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    lineHeight: '1.5',
                                    maxHeight: '300px',
                                    minHeight: '60px',
                                    overflow: 'auto',
                                    resize: 'vertical',
                                    color: 'var(--text)',
                                  }}>
                                    {chunk.text}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
