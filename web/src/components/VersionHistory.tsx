import { useState, useEffect, useCallback } from 'react';
import { api, type SoulVersionMeta } from '../lib/api';

interface VersionHistoryProps {
  filename: string;
  onRestore: (content: string) => void;
  onDiff: (versionContent: string, versionLabel: string) => void;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function VersionHistory({ filename, onRestore, onDiff, onClose }: VersionHistoryProps) {
  const [versions, setVersions] = useState<SoulVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSoulVersions(filename);
      setVersions(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filename]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleRestore = async (id: number) => {
    try {
      const res = await api.getSoulVersion(filename, id);
      if (window.confirm('Restore this version? Your current unsaved changes will be replaced in the editor.')) {
        onRestore(res.data.content);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDiff = async (version: SoulVersionMeta) => {
    try {
      const res = await api.getSoulVersion(filename, version.id);
      const label = version.comment
        ? `${version.comment} (${formatDate(version.created_at)})`
        : formatDate(version.created_at);
      onDiff(res.data.content, label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this version? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.deleteSoulVersion(filename, id);
      setVersions((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '340px',
        background: 'var(--bg-card, #1e1e1e)',
        borderLeft: '1px solid var(--border, #333)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, #333)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Version History</h3>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-secondary)', padding: '0 4px' }}
          title="Close"
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {error && (
          <div className="alert error" style={{ margin: '8px', fontSize: '13px' }}>{error}</div>
        )}
        {loading && (
          <div className="loading" style={{ padding: '16px', textAlign: 'center' }}>Loading versions...</div>
        )}
        {!loading && versions.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            No saved versions yet. Use "Save Version" to create a snapshot.
          </div>
        )}
        {versions.map((v) => (
          <div
            key={v.id}
            style={{
              padding: '10px 12px',
              marginBottom: '6px',
              borderRadius: '6px',
              background: 'var(--bg-secondary, #252525)',
              border: '1px solid var(--border, #333)',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              {formatDate(v.created_at)} · {formatSize(v.content_length)}
            </div>
            {v.comment && (
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', wordBreak: 'break-word' }}>
                {v.comment}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => void handleRestore(v.id)}
                style={{ fontSize: '12px', padding: '3px 8px' }}
                title="Load this version into the editor"
              >
                Restore
              </button>
              <button
                onClick={() => void handleDiff(v)}
                style={{ fontSize: '12px', padding: '3px 8px' }}
                title="Compare with current editor content"
              >
                Diff
              </button>
              <button
                onClick={() => void handleDelete(v.id)}
                disabled={deleting === v.id}
                style={{ fontSize: '12px', padding: '3px 8px', color: 'var(--color-error, #e05252)' }}
                title="Delete this version"
              >
                {deleting === v.id ? '...' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border, #333)', fontSize: '12px', color: 'var(--text-secondary)' }}>
        {versions.length > 0 ? `${versions.length} version${versions.length === 1 ? '' : 's'} · last 50 kept` : ''}
      </div>
    </div>
  );
}
