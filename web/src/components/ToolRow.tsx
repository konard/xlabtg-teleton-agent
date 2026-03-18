import { ToolInfo, ToolUsageStats } from '../lib/api';
import { CostBadge } from './CostBadge';
import { SpeedDot } from './SpeedDot';

interface ToolRowProps {
  tool: ToolInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
  onInfo?: (name: string) => void;
  search?: string;
  selected?: boolean;
  onSelect?: (name: string, selected: boolean) => void;
  stats?: ToolUsageStats;
}

function highlight(text: string, query: string | undefined): JSX.Element {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(255,200,0,0.3)', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function usageLabel(stats: ToolUsageStats | undefined): string {
  if (!stats || stats.totalCalls === 0) return 'Never used';
  const count = stats.totalCalls;
  const lastUsedAt = stats.lastUsedAt;
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const isInactive = lastUsedAt !== null && lastUsedAt < thirtyDaysAgo;
  const label = `Used ${count} ${count === 1 ? 'time' : 'times'}`;
  return isInactive ? `${label} (inactive)` : label;
}

function isRarelyUsed(stats: ToolUsageStats | undefined): boolean {
  if (!stats) return false;
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const recentUses = stats.totalCalls; // we don't have per-period counts here, use lastUsedAt as proxy
  return recentUses < 5 || (stats.lastUsedAt !== null && stats.lastUsedAt < thirtyDaysAgo);
}

export function ToolRow({ tool, updating, onToggle, onScope, onInfo, search, selected, onSelect, stats }: ToolRowProps) {
  const inactive = stats !== undefined && isRarelyUsed(stats) && stats.totalCalls > 0;

  return (
    <div
      className="tool-row"
      style={{
        opacity: tool.enabled ? 1 : 0.5,
        display: 'grid',
        gridTemplateColumns: onSelect ? 'auto 1fr auto auto auto' : '1fr auto auto auto',
        gap: '10px',
        alignItems: 'center',
      }}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={(e) => onSelect(tool.name, e.target.checked)}
          style={{ cursor: 'pointer', width: '14px', height: '14px', accentColor: 'var(--green)' }}
          title={selected ? 'Deselect tool' : 'Select tool'}
        />
      )}

      <div style={{ minWidth: 0 }}>
        <div className="tool-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {highlight(tool.name, search)}
          <CostBadge tool={tool} stats={stats} />
          <SpeedDot stats={stats} />
          {inactive && (
            <span
              title="Rarely used — consider disabling"
              style={{
                fontSize: '10px',
                color: 'var(--text-secondary)',
                border: '1px solid var(--separator)',
                borderRadius: '3px',
                padding: '0 4px',
                lineHeight: '14px',
              }}
            >
              inactive
            </span>
          )}
        </div>
        <div className="tool-desc" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{highlight(tool.description, search)}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {usageLabel(stats)}
          </span>
        </div>
      </div>

      <div className={`scope-seg${!tool.enabled || updating === tool.name ? ' disabled' : ''}`}>
        {(['always', 'dm-only', 'group-only', 'admin-only'] as const).map((s) => (
          <button
            key={s}
            className={tool.scope === s ? 'active' : ''}
            disabled={!tool.enabled || updating === tool.name}
            onClick={() => onScope(tool.name, s)}
          >
            {s === 'always' ? 'All' : s === 'dm-only' ? 'DM' : s === 'group-only' ? 'Group' : 'Admin'}
          </button>
        ))}
      </div>

      {onInfo && (
        <button
          className="btn-ghost btn-sm"
          title="View details"
          onClick={() => onInfo(tool.name)}
          style={{ padding: '3px 7px', fontSize: '13px', lineHeight: 1, opacity: 0.7 }}
        >
          ⓘ
        </button>
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={tool.enabled}
          onChange={() => onToggle(tool.name, tool.enabled)}
          disabled={updating === tool.name}
        />
        <span className="toggle-track" />
        <span className="toggle-thumb" />
      </label>
    </div>
  );
}
