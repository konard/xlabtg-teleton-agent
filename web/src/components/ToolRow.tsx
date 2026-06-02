import { ToolInfo } from '../lib/api';
import { PillTabs } from './PillTabs';

interface ToolRowProps {
  tool: ToolInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
}

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'open', label: 'All' },
  { value: 'dm-only', label: 'DM' },
  { value: 'group-only', label: 'Group' },
  { value: 'admin-only', label: 'Admin' },
  { value: 'allowlist', label: 'List' },
  { value: 'disabled', label: 'Off' },
];

export function ToolRow({ tool, updating, onToggle, onScope }: ToolRowProps) {
  const busy = updating === tool.name;
  const scopeVal = tool.scope === 'always' ? 'open' : tool.scope;

  return (
    <div className="tool-row2" style={{ opacity: tool.enabled ? 1 : 0.55 }}>
      <div className="tool-row2-head">
        <span className="ios-row-title">{tool.name}</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={tool.enabled}
            onChange={() => onToggle(tool.name, tool.enabled)}
            disabled={busy}
          />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>
      </div>
      {tool.description && <div className="tool-desc">{tool.description}</div>}
      <PillTabs
        value={scopeVal}
        options={SCOPE_OPTIONS}
        onChange={(v) => onScope(tool.name, v as ToolInfo['scope'])}
        disabled={!tool.enabled || busy}
        ariaLabel={`Scope for ${tool.name}`}
      />
    </div>
  );
}
