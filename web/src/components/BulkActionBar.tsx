import { ToolInfo } from '../lib/api';
import { Select } from './Select';

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onEnableSelected: () => void;
  onDisableSelected: () => void;
  onSetScope: (scope: ToolInfo['scope']) => void;
  onDisableUnused: () => void;
  onExport: () => void;
  onImport: () => void;
  busy: boolean;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onEnableSelected,
  onDisableSelected,
  onSetScope,
  onDisableUnused,
  onExport,
  onImport,
  busy,
}: BulkActionBarProps): JSX.Element {
  const scopeOptions: ToolInfo['scope'][] = ['always', 'dm-only', 'group-only', 'admin-only'];
  const scopeLabels = ['Set Scope…', 'All', 'DM only', 'Group only', 'Admin only'];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        padding: '8px 14px',
        backgroundColor: 'rgba(255,255,255,0.05)',
        border: '1px solid var(--separator)',
        borderRadius: '8px',
        marginBottom: '14px',
      }}
    >
      {/* Selection count + Select All / Deselect All */}
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginRight: '4px' }}>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{selectedCount}</span> selected
      </span>

      <button
        className="btn-ghost btn-sm"
        onClick={onSelectAll}
        disabled={busy || selectedCount === totalCount}
        title="Select all visible tools"
      >
        Select All
      </button>
      <button
        className="btn-ghost btn-sm"
        onClick={onDeselectAll}
        disabled={busy || selectedCount === 0}
        title="Deselect all tools"
      >
        Deselect All
      </button>

      {selectedCount > 0 && (
        <>
          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--separator)', margin: '0 4px' }} />

          <button
            className="btn-sm"
            onClick={onEnableSelected}
            disabled={busy}
            style={{ background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' }}
          >
            Enable Selected
          </button>
          <button
            className="btn-sm"
            onClick={onDisableSelected}
            disabled={busy}
          >
            Disable Selected
          </button>

          <Select
            value=""
            options={['', ...scopeOptions]}
            labels={scopeLabels}
            onChange={(v) => { if (v && !busy) onSetScope(v as ToolInfo['scope']); }}
            style={{ minWidth: '110px', opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : undefined }}
          />
        </>
      )}

      <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--separator)', margin: '0 4px' }} />

      <button
        className="btn-ghost btn-sm"
        onClick={onDisableUnused}
        disabled={busy}
        title="Disable tools not used in the last 30 days"
      >
        Disable Unused
      </button>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
        <button
          className="btn-ghost btn-sm"
          onClick={onExport}
          disabled={busy}
          title="Export tool configuration as JSON"
        >
          Export
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={onImport}
          disabled={busy}
          title="Import tool configuration from JSON"
        >
          Import
        </button>
      </div>
    </div>
  );
}
