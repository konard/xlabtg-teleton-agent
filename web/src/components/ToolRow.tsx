import { ToolInfo } from '../lib/api';
import { ListRow } from './List';
import { Select } from './Select';

interface ToolRowProps {
  tool: ToolInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
}

const SCOPE_OPTIONS = ['open', 'dm-only', 'group-only', 'admin-only', 'allowlist', 'disabled'];
const SCOPE_LABELS = ['All', 'DM only', 'Group only', 'Admin only', 'Allowlist', 'Disabled'];

export function ToolRow({ tool, updating, onToggle, onScope }: ToolRowProps) {
  const busy = updating === tool.name;
  const scopeVal = tool.scope === 'always' ? 'open' : tool.scope;

  return (
    <ListRow
      insetSeparator
      className={tool.enabled ? undefined : 'dimmed'}
      title={tool.name}
      subtitle={tool.description}
      trailing={
        <>
          <Select
            value={scopeVal}
            options={SCOPE_OPTIONS}
            labels={SCOPE_LABELS}
            onChange={(v) => v && onScope(tool.name, v as ToolInfo['scope'])}
            disabled={!tool.enabled || busy}
            style={{ minWidth: '112px' }}
          />
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
        </>
      }
    />
  );
}
