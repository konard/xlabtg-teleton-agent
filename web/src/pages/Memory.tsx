import React, { useState, useEffect, useCallback } from 'react';
import { api, MemorySourceFile, MemoryChunk, SearchResult } from '../lib/api';
import { formatDate } from '../lib/utils';
import { SearchInput } from '../components/SearchInput';

export function Memory() {
  const [filter, setFilter] = useState('');
  const [sources, setSources] = useState<MemorySourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded source state
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [chunks, setChunks] = useState<MemoryChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  // Semantic search state (wired to GET /memory/search)
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const query = filter.trim();

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

  // Debounced semantic search across indexed knowledge (hybrid vector + keyword).
  useEffect(() => {
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchKnowledge(query);
        if (!cancelled) setResults(res.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

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

  return (
    <div>
      <div className="header">
        <h1>Memory</h1>
        <p>Browse indexed knowledge sources</p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {/* Search + refresh bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Search memory content..."
            wrapperStyle={{ flex: 1 }}
            style={{ width: '100%' }}
          />
          <button
            onClick={loadSources}
            disabled={loading}
            className="btn-ghost btn-sm"
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

        {query ? (
          /* Semantic search results */
          searching ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Searching...</div>
          ) : results.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px' }}>
              {results.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    backgroundColor: 'var(--bg-glass)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    <span style={{ wordBreak: 'break-all' }}>{r.source}</span>
                    <span style={{ flexShrink: 0 }}>score {r.score.toFixed(3)}</span>
                  </div>
                  <pre style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    lineHeight: '1.5',
                    maxHeight: '300px',
                    overflow: 'auto',
                    color: 'var(--text-primary)',
                  }}>
                    {r.text}
                  </pre>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
        ) : sources.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            No memory files indexed
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Source</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '80px' }}>Chunks</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '140px' }}>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => {
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
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        backgroundColor: isExpanded ? 'var(--glass-micro)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '6px 14px' }}>
                        <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)', marginRight: '8px' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        {src.source}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {src.entryCount}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {formatDate(src.lastUpdated, 1000)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--glass-micro)', borderBottom: '1px solid var(--border)' }}>
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
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--bg-glass)',
                                  }}
                                >
                                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                    {chunk.startLine != null && chunk.endLine != null && (
                                      <span>Lines {chunk.startLine}–{chunk.endLine} &middot; </span>
                                    )}
                                    {formatDate(chunk.updatedAt, 1000)}
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
                                    color: 'var(--text-primary)',
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
