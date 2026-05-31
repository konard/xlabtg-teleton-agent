import { useEffect, useState, Fragment } from 'react';
import { api, ToolInfo, ModuleInfo } from '../lib/api';
import { ToolRow } from '../components/ToolRow';
import { Select } from '../components/Select';
import { SearchInput } from '../components/SearchInput';
import { useToolManager } from '../hooks/useToolManager';
import { errMsg } from '../lib/utils';

export function Tools() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadTools = () => {
    setLoading(true);
    return api.getTools()
      .then((toolsRes) => {
        setModules(toolsRes.data);
        setLoading(false);
      })
      .catch((err) => {
        tm.setError(errMsg(err));
        setLoading(false);
      });
  };

  const tm = useToolManager(loadTools);
  const { updating, error, setError, toggleEnabled, updateScope, bulkToggle, bulkScope } = tm;

  useEffect(() => {
    loadTools();
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  const builtIn = modules.filter((m) => !m.isPlugin);
  const builtInCount = builtIn.reduce((sum, m) => sum + m.toolCount, 0);
  const enabledCount = builtIn.reduce((sum, m) => sum + m.tools.filter(t => t.enabled).length, 0);

  const trimmedSearch = search.trim().toLowerCase();
  const filtered = trimmedSearch
    ? builtIn.filter((m) =>
        m.name.toLowerCase().includes(trimmedSearch) ||
        m.tools.some(t => t.name.toLowerCase().includes(trimmedSearch) || t.description.toLowerCase().includes(trimmedSearch))
      )
    : builtIn;

  return (
    <div>
      <div className="header">
        <h1>Tools</h1>
        <p>{builtInCount} built-in tools across {builtIn.length} modules</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
            <button className="btn-sm" onClick={() => { setError(null); loadTools(); }}>Retry</button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 2, borderRadius: 'var(--radius-pill)' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>{enabledCount}</span> enabled
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{builtInCount - enabledCount}</span> disabled
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search tools..." />
          {trimmedSearch && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {filtered.length} of {builtIn.length} modules
            </span>
          )}
          <button
            className="btn-ghost btn-sm"
            onClick={loadTools}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Module table */}
      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {trimmedSearch ? 'No modules match your search' : 'No modules found'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Module</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 70 }}>Enabled</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: 200 }}>Controls</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((module) => {
                const isExpanded = expandedModule === module.name;
                const someEnabled = module.tools.some((t) => t.enabled);
                const noneEnabled = module.tools.every((t) => !t.enabled);
                const enabledInModule = module.tools.filter(t => t.enabled).length;
                const scopes = new Set(module.tools.map((t) => t.scope));
                const mixedScope = scopes.size > 1;
                const commonScope = mixedScope ? '' : (scopes.values().next().value ?? 'always');
                const isBusy = updating === module.name;

                return (
                  <Fragment key={module.name}>
                    <tr
                      onClick={() => setExpandedModule(isExpanded ? null : module.name)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedModule(isExpanded ? null : module.name); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        backgroundColor: isExpanded ? 'var(--glass-micro)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                            {isExpanded ? '\u25BC' : '\u25B6'}
                          </span>
                          <span style={{ fontWeight: 600 }}>{module.name}</span>
                          {noneEnabled && (
                            <span className="badge warn">Disabled</span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <span className="badge count">{module.toolCount}</span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <span style={{ fontSize: '12px', color: enabledInModule === module.toolCount ? 'var(--green)' : enabledInModule === 0 ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                          {enabledInModule}/{module.toolCount}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 14px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                          <Select
                            value={commonScope}
                            options={['', 'open', 'dm-only', 'group-only', 'admin-only', 'allowlist', 'disabled']}
                            labels={[mixedScope ? 'Mixed' : 'Scope', 'All', 'DM only', 'Group only', 'Admin only', 'Allowlist', 'Disabled']}
                            onChange={(v) => v && bulkScope(module, v as ToolInfo['scope'])}
                            style={{ minWidth: '100px' }}
                          />
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={someEnabled}
                              onChange={() => bulkToggle(module, !someEnabled)}
                              disabled={isBusy}
                            />
                            <span className="toggle-track" />
                            <span className="toggle-thumb" />
                          </label>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--glass-micro)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                          <div style={{ display: 'grid', gap: '6px', paddingTop: '6px' }}>
                            {module.tools.map((tool) => (
                              <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={toggleEnabled} onScope={updateScope} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
