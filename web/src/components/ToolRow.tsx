import { ToolInfo } from '../lib/api';

interface ToolRowProps {
  tool: ToolInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
  onInfo?: (name: string) => void;
  search?: string;
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

export function ToolRow({ tool, updating, onToggle, onScope, onInfo, search }: ToolRowProps) {
  return (
    <div
      className="tool-row"
      style={{
        opacity: tool.enabled ? 1 : 0.5,
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto',
        gap: '10px',
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="tool-name">{highlight(tool.name, search)}</div>
        <div className="tool-desc">{highlight(tool.description, search)}</div>
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
