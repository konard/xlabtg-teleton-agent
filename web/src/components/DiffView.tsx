import { useMemo } from 'react';
import * as Diff from 'diff';

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
  onClose: () => void;
}

export function DiffView({ oldContent, newContent, oldLabel = 'Version', newLabel = 'Current', onClose }: DiffViewProps) {
  const hunks = useMemo(() => {
    return Diff.diffLines(oldContent, newContent);
  }, [oldContent, newContent]);

  const hasChanges = hunks.some((h) => h.added || h.removed);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--bg-card, #1e1e1e)',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '900px',
          margin: '24px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid var(--border, #333)',
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
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Diff View</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-secondary)', padding: '0 4px' }}
            title="Close"
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #333)', fontSize: '12px' }}>
          <div
            style={{
              flex: 1,
              padding: '6px 16px',
              background: 'rgba(220, 38, 38, 0.08)',
              color: 'var(--text-secondary)',
              borderRight: '1px solid var(--border, #333)',
            }}
          >
            − {oldLabel}
          </div>
          <div
            style={{
              flex: 1,
              padding: '6px 16px',
              background: 'rgba(22, 163, 74, 0.08)',
              color: 'var(--text-secondary)',
            }}
          >
            + {newLabel}
          </div>
        </div>

        {!hasChanges ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
            No differences found.
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.5' }}>
            {hunks.map((hunk, i) => {
              const lines = hunk.value.split('\n');
              // Remove trailing empty string from split
              if (lines[lines.length - 1] === '') lines.pop();

              let bg = 'transparent';
              let color = 'var(--text-primary, #ccc)';
              let prefix = ' ';

              if (hunk.added) {
                bg = 'rgba(22, 163, 74, 0.12)';
                color = '#4ade80';
                prefix = '+';
              } else if (hunk.removed) {
                bg = 'rgba(220, 38, 38, 0.12)';
                color = '#f87171';
                prefix = '−';
              }

              return (
                <div key={i} style={{ background: bg }}>
                  {lines.map((line, j) => (
                    <div
                      key={j}
                      style={{
                        padding: '0 16px',
                        color,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        display: 'flex',
                        gap: '8px',
                      }}
                    >
                      <span style={{ opacity: 0.5, userSelect: 'none', minWidth: '12px' }}>{prefix}</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
