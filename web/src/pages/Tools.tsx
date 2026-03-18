import { useEffect, useRef, useState } from 'react';
import { api, ToolInfo, ModuleInfo } from '../lib/api';
import { ToolRow } from '../components/ToolRow';
import { ToolDetailsModal } from '../components/ToolDetailsModal';
import { BulkActionBar } from '../components/BulkActionBar';
import { Select } from '../components/Select';
import { PillBar } from '../components/PillBar';

type StateFilter = 'all' | 'enabled' | 'disabled';
type SortBy = 'name-asc' | 'name-desc' | 'module';

function highlight(text: string, query: string): JSX.Element {
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

export function Tools() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('module');

  // Multi-selection state
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);

  const loadTools = () => {
    setLoading(true);
    return api.getTools()
      .then((toolsRes) => {
        setModules(toolsRes.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTools();
  }, []);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const updateScope = async (toolName: string, newScope: ToolInfo['scope']) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { scope: newScope });
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkToggle = async (module: ModuleInfo, enabled: boolean) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.enabled !== enabled) {
          await api.updateToolConfig(tool.name, { enabled });
        }
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkScope = async (module: ModuleInfo, scope: ToolInfo['scope']) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.scope !== scope) {
          await api.updateToolConfig(tool.name, { scope });
        }
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────

  const handleSelectTool = (toolName: string, checked: boolean) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (checked) next.add(toolName);
      else next.delete(toolName);
      return next;
    });
  };

  // All visible tools (from currently filtered + sorted view)
  const allVisibleTools = (): string[] => {
    const builtIn = modules.filter((m) => !m.isPlugin);
    const trimmedSearch = search.trim().toLowerCase();
    const result: string[] = [];
    for (const m of builtIn) {
      for (const t of m.tools) {
        const matchesSearch = !trimmedSearch
          || t.name.toLowerCase().includes(trimmedSearch)
          || t.description.toLowerCase().includes(trimmedSearch)
          || m.name.toLowerCase().includes(trimmedSearch);
        const matchesState = stateFilter === 'all'
          || (stateFilter === 'enabled' && t.enabled)
          || (stateFilter === 'disabled' && !t.enabled);
        if (matchesSearch && matchesState) result.push(t.name);
      }
    }
    return result;
  };

  const handleSelectAll = () => {
    setSelectedTools(new Set(allVisibleTools()));
  };

  const handleDeselectAll = () => {
    setSelectedTools(new Set());
  };

  // ── Bulk action operations ───────────────────────────────────────────

  const allTools = (): ToolInfo[] =>
    modules.filter((m) => !m.isPlugin).flatMap((m) => m.tools);

  const bulkEnableSelected = async () => {
    setBulkBusy(true);
    try {
      for (const name of selectedTools) {
        const tool = allTools().find((t) => t.name === name);
        if (tool && !tool.enabled) {
          await api.updateToolConfig(name, { enabled: true });
        }
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDisableSelected = async () => {
    setBulkBusy(true);
    try {
      for (const name of selectedTools) {
        const tool = allTools().find((t) => t.name === name);
        if (tool && tool.enabled) {
          await api.updateToolConfig(name, { enabled: false });
        }
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSetScope = async (scope: ToolInfo['scope']) => {
    setBulkBusy(true);
    try {
      for (const name of selectedTools) {
        await api.updateToolConfig(name, { scope });
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDisableUnused = async () => {
    setBulkBusy(true);
    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const tools = allTools().filter((t) => t.enabled);
      for (const tool of tools) {
        try {
          const details = await api.getToolDetails(tool.name);
          const lastUsed = details.data.stats?.lastUsedAt;
          const isUnused = lastUsed === null || lastUsed === undefined || lastUsed < thirtyDaysAgo;
          if (isUnused) {
            await api.updateToolConfig(tool.name, { enabled: false });
          }
        } catch {
          // Skip tools whose details can't be fetched
        }
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Export / Import ──────────────────────────────────────────────────

  const handleExport = () => {
    const tools = allTools();
    const config = tools.map((t) => ({ name: t.name, enabled: t.enabled, scope: t.scope }));
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tools-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setBulkBusy(true);
    try {
      const text = await file.text();
      const config = JSON.parse(text) as { name: string; enabled: boolean; scope: ToolInfo['scope'] }[];
      if (!Array.isArray(config)) throw new Error('Invalid config format: expected an array');
      for (const entry of config) {
        if (typeof entry.name !== 'string') continue;
        await api.updateToolConfig(entry.name, {
          enabled: Boolean(entry.enabled),
          scope: entry.scope,
        });
      }
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  if (loading) return <div className="loading">Loading...</div>;

  const builtIn = modules.filter((m) => !m.isPlugin);
  const builtInCount = builtIn.reduce((sum, m) => sum + m.toolCount, 0);
  const enabledCount = builtIn.reduce((sum, m) => sum + m.tools.filter(t => t.enabled).length, 0);

  const trimmedSearch = search.trim().toLowerCase();

  // Filter modules by search and state
  const filtered = builtIn
    .map((m) => {
      const matchingTools = m.tools.filter((t) => {
        const matchesSearch = !trimmedSearch
          || t.name.toLowerCase().includes(trimmedSearch)
          || t.description.toLowerCase().includes(trimmedSearch)
          || m.name.toLowerCase().includes(trimmedSearch);
        const matchesState = stateFilter === 'all'
          || (stateFilter === 'enabled' && t.enabled)
          || (stateFilter === 'disabled' && !t.enabled);
        return matchesSearch && matchesState;
      });
      return { module: m, matchingTools };
    })
    .filter(({ matchingTools }) => matchingTools.length > 0);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name-asc') return a.module.name.localeCompare(b.module.name);
    if (sortBy === 'name-desc') return b.module.name.localeCompare(a.module.name);
    return 0; // 'module' keeps original order
  });

  const totalMatchingTools = sorted.reduce((sum, { matchingTools }) => sum + matchingTools.length, 0);
  const isFiltered = trimmedSearch || stateFilter !== 'all';

  const statePills = [
    { id: 'all', label: 'All' },
    { id: 'enabled', label: `Enabled (${enabledCount})` },
    { id: 'disabled', label: `Disabled (${builtInCount - enabledCount})` },
  ];

  const sortOptions: SortBy[] = ['module', 'name-asc', 'name-desc'];
  const sortLabels = ['Module', 'Name A–Z', 'Name Z–A'];

  const visibleToolNames = allVisibleTools();

  return (
    <div style={{ position: 'relative' }}>
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
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 2 }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>{enabledCount}</span> enabled
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{builtInCount - enabledCount}</span> disabled
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
              style={{
                padding: '4px 24px 4px 12px',
                fontSize: '13px',
                border: '1px solid var(--separator)',
                borderRadius: '14px',
                backgroundColor: 'transparent',
                color: 'var(--text)',
                width: '180px',
                outline: 'none',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: '14px',
                  lineHeight: 1,
                }}
              >
                &#x2715;
              </button>
            )}
          </div>
          <Select
            value={sortBy}
            options={sortOptions}
            labels={sortLabels}
            onChange={(v) => setSortBy(v as SortBy)}
            style={{ minWidth: '110px' }}
          />
          {isFiltered && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {totalMatchingTools} of {builtInCount} tools
            </span>
          )}
          <button
            style={{ padding: '4px 12px', fontSize: '12px', opacity: 0.7 }}
            onClick={loadTools}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* State filter pill bar */}
      <div style={{ marginBottom: '14px' }}>
        <PillBar tabs={statePills} activeTab={stateFilter} onTabChange={(id) => setStateFilter(id as StateFilter)} />
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedTools.size}
        totalCount={visibleToolNames.length}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onEnableSelected={bulkEnableSelected}
        onDisableSelected={bulkDisableSelected}
        onSetScope={bulkSetScope}
        onDisableUnused={handleDisableUnused}
        onExport={handleExport}
        onImport={handleImport}
        busy={bulkBusy}
      />

      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
        }}
      />

      {/* Module table */}
      <div className="card" style={{ padding: 0 }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {isFiltered ? 'No tools match your filters' : 'No modules found'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Module</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 70 }}>Enabled</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: 200 }}>Controls</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ module, matchingTools }) => {
                const isExpanded = expandedModule === module.name;
                const someEnabled = module.tools.some((t) => t.enabled);
                const noneEnabled = module.tools.every((t) => !t.enabled);
                const enabledInModule = module.tools.filter(t => t.enabled).length;
                const scopes = new Set(module.tools.map((t) => t.scope));
                const mixedScope = scopes.size > 1;
                const commonScope = mixedScope ? '' : (scopes.values().next().value ?? 'always');
                const isBusy = updating === module.name;

                return (
                  <>
                    <tr
                      key={module.name}
                      onClick={() => setExpandedModule(isExpanded ? null : module.name)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedModule(isExpanded ? null : module.name); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--separator)',
                        backgroundColor: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                            {isExpanded ? '\u25BC' : '\u25B6'}
                          </span>
                          <span style={{ fontWeight: 600 }}>{highlight(module.name, trimmedSearch)}</span>
                          {noneEnabled && (
                            <span className="badge warn">Disabled</span>
                          )}
                          {isFiltered && matchingTools.length !== module.toolCount && (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              ({matchingTools.length} matching)
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <span className="badge count">{module.toolCount}</span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <span style={{ fontSize: '12px', color: enabledInModule === module.toolCount ? 'var(--green)' : enabledInModule === 0 ? 'var(--text-secondary)' : 'var(--text)' }}>
                          {enabledInModule}/{module.toolCount}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 14px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                          <Select
                            value={commonScope}
                            options={['', 'always', 'dm-only', 'group-only', 'admin-only']}
                            labels={[mixedScope ? 'Mixed' : 'Scope', 'All', 'DM only', 'Group only', 'Admin only']}
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
                      <tr key={`${module.name}-detail`} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                        <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                          <div style={{ display: 'grid', gap: '6px', paddingTop: '6px' }}>
                            {(isFiltered ? matchingTools : module.tools).map((tool) => (
                              <ToolRow
                                key={tool.name}
                                tool={tool}
                                updating={updating}
                                onToggle={toggleEnabled}
                                onScope={updateScope}
                                onInfo={setSelectedTool}
                                search={trimmedSearch}
                                selected={selectedTools.has(tool.name)}
                                onSelect={handleSelectTool}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedTool && (
        <ToolDetailsModal toolName={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </div>
  );
}
