import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api, ToolInfo, ModuleInfo, PluginManifest, MarketplacePlugin, MarketplaceSource, PluginSecretsInfo, SecretDeclaration } from '../lib/api';
import { ToolRow } from '../components/ToolRow';
import { Select } from '../components/Select';

type Tab = 'installed' | 'marketplace';
type DetailsTab = 'overview' | 'tools' | 'secrets';

// ── Author badge with GitHub avatar ─────────────────────────────────────────

function AuthorBadge({ author, verified = false }: { author: string; verified?: boolean }) {
  const isGitHub = author && !author.includes(' ') && author !== 'unknown';
  const avatarUrl = isGitHub ? `https://github.com/${author}.png?size=16` : null;
  const [avatarError, setAvatarError] = useState(false);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
      {avatarUrl && !avatarError ? (
        <img
          src={avatarUrl}
          alt={author}
          width={14}
          height={14}
          style={{ borderRadius: '50%', verticalAlign: 'middle' }}
          onError={() => setAvatarError(true)}
        />
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }} aria-hidden="true">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
        </svg>
      )}
      <span>@{author}</span>
      {verified && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--green)" aria-label="Verified author">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      )}
    </span>
  );
}

// ── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source, label }: { source: MarketplacePlugin['source']; label: string }) {
  const styles: React.CSSProperties =
    source === 'official'
      ? { background: 'rgba(80,200,120,0.12)', color: 'var(--green)', border: '1px solid rgba(80,200,120,0.25)' }
      : source === 'community'
      ? { background: 'rgba(110,168,254,0.10)', color: 'var(--blue, #6ea8fe)', border: '1px solid rgba(110,168,254,0.2)' }
      : { background: 'rgba(255,200,80,0.10)', color: '#f5c842', border: '1px solid rgba(255,200,80,0.2)' };

  return (
    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, ...styles }}>
      {label}
    </span>
  );
}

// ── Plugin Details Modal ──────────────────────────────────────────────────────

function PluginDetailsModal({
  plugin,
  onClose,
  onInstall,
  onUninstall,
  onUpdate,
  operating,
}: {
  plugin: MarketplacePlugin;
  onClose: () => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  operating: string | null;
}) {
  const [detailsTab, setDetailsTab] = useState<DetailsTab>('overview');
  const [secretsInfo, setSecretsInfo] = useState<PluginSecretsInfo | null>(null);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const isOp = operating === plugin.id;
  const busy = !!operating;

  useEffect(() => {
    if (detailsTab === 'secrets' && plugin.secrets && Object.keys(plugin.secrets).length > 0) {
      setLoadingSecrets(true);
      api.getPluginSecrets(plugin.id)
        .then(res => setSecretsInfo(res.data))
        .catch(() => {})
        .finally(() => setLoadingSecrets(false));
    }
  }, [detailsTab, plugin.id, plugin.secrets]);

  const hasSecrets = plugin.secrets && Object.keys(plugin.secrets).length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 style={{ marginBottom: 0 }}>{plugin.name}</h2>
                <SourceBadge source={plugin.source} label={plugin.sourceLabel} />
                {plugin.status === 'installed' && (
                  <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(80,200,120,0.12)', color: 'var(--green)', border: '1px solid rgba(80,200,120,0.25)' }}>
                    Installed
                  </span>
                )}
                {plugin.status === 'updatable' && (
                  <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,200,80,0.10)', color: '#f5c842', border: '1px solid rgba(255,200,80,0.2)' }}>
                    Update available
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                {plugin.author && plugin.author !== 'unknown' && (
                  <AuthorBadge author={plugin.author} verified={plugin.source === 'official'} />
                )}
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>v{plugin.remoteVersion}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{plugin.toolCount} tools</span>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px', fontSize: '18px', lineHeight: 1, flexShrink: 0 }}
            >
              &#x2715;
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="tabs" style={{ marginBottom: '12px', borderBottom: '1px solid var(--separator)', paddingBottom: '0' }}>
          <button className={`tab ${detailsTab === 'overview' ? 'active' : ''}`} onClick={() => setDetailsTab('overview')}>Overview</button>
          <button className={`tab ${detailsTab === 'tools' ? 'active' : ''}`} onClick={() => setDetailsTab('tools')}>
            Tools
            {plugin.tools && plugin.tools.length > 0 && (
              <span className="tab-count">{plugin.tools.length}</span>
            )}
          </button>
          {hasSecrets && (
            <button className={`tab ${detailsTab === 'secrets' ? 'active' : ''}`} onClick={() => setDetailsTab('secrets')}>
              Secrets
              <span className="tab-count">{Object.keys(plugin.secrets!).length}</span>
            </button>
          )}
        </div>

        {/* Tab content */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {detailsTab === 'overview' && (
            <div>
              {plugin.description && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px', lineHeight: '1.6' }}>
                  {plugin.description}
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: '12px', marginBottom: '16px' }}>
                {plugin.author && plugin.author !== 'unknown' && (
                  <>
                    <span style={{ color: 'var(--text-secondary)' }}>Author</span>
                    <AuthorBadge author={plugin.author} verified={plugin.source === 'official'} />
                  </>
                )}
                <span style={{ color: 'var(--text-secondary)' }}>Source</span>
                <span><SourceBadge source={plugin.source} label={plugin.sourceLabel} /></span>
                <span style={{ color: 'var(--text-secondary)' }}>Version</span>
                <span>v{plugin.remoteVersion}</span>
                {plugin.installedVersion && (
                  <>
                    <span style={{ color: 'var(--text-secondary)' }}>Installed</span>
                    <span>v{plugin.installedVersion}</span>
                  </>
                )}
                <span style={{ color: 'var(--text-secondary)' }}>Tools</span>
                <span>{plugin.toolCount}</span>
              </div>
              {plugin.tags && plugin.tags.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>Tags</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {plugin.tags.map((t) => (
                      <span key={t} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--separator)' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {plugin.secrets && Object.keys(plugin.secrets).some(k => plugin.secrets![k].required) && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,200,80,0.06)', border: '1px solid rgba(255,200,80,0.15)', fontSize: '12px' }}>
                  <strong style={{ color: '#f5c842' }}>API Keys Required</strong>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '3px' }}>
                    This plugin requires API keys to function. You'll be prompted to configure them after installation.
                  </p>
                </div>
              )}
            </div>
          )}

          {detailsTab === 'tools' && (
            <div>
              {plugin.tools && plugin.tools.length > 0 ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {plugin.tools.map((tool) => (
                    <div key={tool.name} className="tool-row" style={{ padding: '8px 12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <code style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>{tool.name}</code>
                        {tool.description && (
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>{tool.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No tool details available.</p>
              )}
            </div>
          )}

          {detailsTab === 'secrets' && hasSecrets && (
            <div>
              {loadingSecrets ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading secrets info...</p>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {Object.entries(plugin.secrets!).map(([key, decl]) => {
                    const isConfigured = secretsInfo?.configured.includes(key);
                    return (
                      <div key={key} className="tool-row" style={{ padding: '10px 12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <code style={{ fontSize: '12px', fontWeight: 600 }}>{key}</code>
                            {decl.required && <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>required</span>}
                            <span className={`badge ${isConfigured ? 'always' : 'warn'}`} style={{ fontSize: '10px' }}>
                              {isConfigured ? 'Set' : 'Not set'}
                            </span>
                          </div>
                          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '3px 0 0 0' }}>{decl.description}</p>
                          {decl.env && (
                            <code style={{ fontSize: '10px', color: 'var(--text-tertiary)', opacity: 0.7, display: 'block', marginTop: '2px' }}>
                              Env: {decl.env}
                            </code>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    Configure secrets from the Installed tab after installation.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--separator)' }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {plugin.status === 'available' && (
            <button className="btn-sm" onClick={() => { onInstall(plugin.id); onClose(); }} disabled={busy}>
              {isOp ? 'Installing...' : 'Install'}
            </button>
          )}
          {plugin.status === 'updatable' && (
            <>
              <button className="btn-sm" onClick={() => { onUpdate(plugin.id); onClose(); }} disabled={busy}>
                {isOp ? 'Updating...' : `Update to v${plugin.remoteVersion}`}
              </button>
              <button className="btn-danger btn-sm" onClick={() => { onUninstall(plugin.id); onClose(); }} disabled={busy}>
                Uninstall
              </button>
            </>
          )}
          {plugin.status === 'installed' && (
            <button className="btn-danger btn-sm" onClick={() => { onUninstall(plugin.id); onClose(); }} disabled={busy}>
              Uninstall
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Plugins page ─────────────────────────────────────────────────────────

export function Plugins() {
  const [tab, setTab] = useState<Tab>('installed');
  const [manifests, setManifests] = useState<PluginManifest[]>([]);
  const [pluginModules, setPluginModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Plugin priorities state
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [priorityChanged, setPriorityChanged] = useState(false);
  const priorityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Marketplace state
  const [marketplace, setMarketplace] = useState<MarketplacePlugin[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [operating, setOperating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Secrets wizard state (post-install modal)
  const [secretsWizard, setSecretsWizard] = useState<{ pluginId: string; pluginName: string; secrets: Record<string, SecretDeclaration> } | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [savingSecrets, setSavingSecrets] = useState(false);

  // Installed tab accordion
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  // Source management state
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceLabel, setNewSourceLabel] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Active source filters (checkboxes — replaces the legacy dropdown filter)
  const [activeSourceFilters, setActiveSourceFilters] = useState<Set<string>>(new Set());

  // Inline secrets state (installed tab)
  const [expandedSecrets, setExpandedSecrets] = useState<string | null>(null);
  const [secretsInfo, setSecretsInfo] = useState<PluginSecretsInfo | null>(null);
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');

  // Plugin details modal state
  const [detailsPlugin, setDetailsPlugin] = useState<MarketplacePlugin | null>(null);

  const loadData = () => {
    setLoading(true);
    return Promise.all([api.getPlugins(), api.getTools(), api.getPluginPriorities()])
      .then(([pluginsRes, toolsRes, prioritiesRes]) => {
        setManifests(pluginsRes.data);
        setPluginModules(toolsRes.data.filter((m) => m.isPlugin));
        setPriorities(prioritiesRes.data ?? {});
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  const loadMarketplace = (refresh = false) => {
    setMarketLoading(true);
    return Promise.all([api.getMarketplace(refresh), api.getMarketplaceSources().catch(() => ({ data: [] }))])
      .then(([mpRes, srcRes]) => {
        setMarketplace(mpRes.data);
        setSources(srcRes.data);
        setMarketLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setMarketLoading(false);
      });
  };

  useEffect(() => {
    loadData();
    loadMarketplace();
    return () => {
      // Cleanup debounced priority timers on unmount
      Object.values(priorityTimers.current).forEach(clearTimeout);
    };
  }, []);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await loadData();
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
      await loadData();
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
      await loadData();
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
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const handlePriorityChange = useCallback((pluginName: string, value: number) => {
    const clamped = Math.max(-1000, Math.min(1000, Math.round(value)));
    setPriorities((prev) => ({ ...prev, [pluginName]: clamped }));

    // Debounce the API call
    if (priorityTimers.current[pluginName]) {
      clearTimeout(priorityTimers.current[pluginName]);
    }
    priorityTimers.current[pluginName] = setTimeout(async () => {
      try {
        if (clamped === 0) {
          await api.resetPluginPriority(pluginName);
        } else {
          await api.setPluginPriority(pluginName, clamped);
        }
        setPriorityChanged(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 500);
  }, []);

  const handleInstall = async (id: string) => {
    const plugin = marketplace.find(p => p.id === id);
    setOperating(id);
    try {
      await api.installPlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
      if (plugin?.secrets && Object.keys(plugin.secrets).length > 0) {
        try {
          const existing = await api.getPluginSecrets(id);
          const requiredKeys = Object.entries(plugin.secrets)
            .filter(([, d]) => d.required)
            .map(([k]) => k);
          const allRequiredSet = requiredKeys.every(k => existing.data.configured.includes(k));
          if (allRequiredSet && requiredKeys.length > 0) return;
        } catch { /* show wizard as fallback */ }
        setSecretsWizard({ pluginId: id, pluginName: plugin.name, secrets: plugin.secrets });
        setSecretValues({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!confirm(`Uninstall plugin "${id}"? This will remove its files.`)) return;
    setOperating(id);
    try {
      await api.uninstallPlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdate = async (id: string) => {
    setOperating(id);
    try {
      await api.updatePlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdateAll = async () => {
    const toUpdate = marketplace.filter((p) => p.status === 'updatable');
    for (const plugin of toUpdate) {
      setOperating(plugin.id);
      try {
        await api.updatePlugin(plugin.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        break;
      }
    }
    setOperating(null);
    await Promise.all([loadMarketplace(), loadData()]);
  };

  // Inline secrets helpers
  const toggleSecrets = async (pluginId: string) => {
    if (expandedSecrets === pluginId) {
      setExpandedSecrets(null);
      setEditingSecret(null);
      return;
    }
    try {
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
      setExpandedSecrets(pluginId);
      setEditingSecret(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveSecret = async (pluginId: string, key: string) => {
    if (!secretInput.trim()) return;
    try {
      await api.setPluginSecret(pluginId, key, secretInput.trim());
      setEditingSecret(null);
      setSecretInput('');
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeSecret = async (pluginId: string, key: string) => {
    try {
      await api.unsetPluginSecret(pluginId, key);
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Parse search query: supports `author:name`, `source:official|community|custom`, plain text
  const parseSearch = (raw: string) => {
    const authorMatch = raw.match(/(?:^|\s)author:(\S+)/i);
    const sourceMatch = raw.match(/(?:^|\s)source:(\S+)/i);
    const plain = raw
      .replace(/(?:^|\s)author:\S+/gi, '')
      .replace(/(?:^|\s)source:\S+/gi, '')
      .trim()
      .toLowerCase();
    return {
      author: authorMatch?.[1]?.toLowerCase() ?? '',
      source: sourceMatch?.[1]?.toLowerCase() ?? '',
      text: plain,
    };
  };

  // Toggle a source label in the active source filters
  const toggleSourceFilter = (label: string) => {
    setActiveSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  // Filter marketplace plugins
  const parsed = parseSearch(search);
  const filteredMarketplace = marketplace.filter((p) => {
    if (parsed.text && !p.name.toLowerCase().includes(parsed.text) && !p.description.toLowerCase().includes(parsed.text)) {
      return false;
    }
    if (parsed.author && !p.author.toLowerCase().includes(parsed.author)) {
      return false;
    }
    if (parsed.source && p.source !== parsed.source) {
      return false;
    }
    if (tagFilter && !p.tags.includes(tagFilter)) {
      return false;
    }
    // Checkbox source filter
    if (activeSourceFilters.size > 0 && !activeSourceFilters.has(p.sourceLabel)) {
      return false;
    }
    return true;
  });

  const allTags = Array.from(new Set(marketplace.flatMap((p) => p.tags))).sort();
  const allSourceLabels = Array.from(new Set(marketplace.map((p) => p.sourceLabel))).sort();
  const updatableCount = marketplace.filter((p) => p.status === 'updatable').length;

  const handleAddSource = async () => {
    setSourceError(null);
    if (!newSourceUrl.trim()) { setSourceError('URL is required'); return; }
    try {
      new URL(newSourceUrl.trim());
    } catch { setSourceError('Invalid URL'); return; }
    try {
      await api.addMarketplaceSource(newSourceUrl.trim(), newSourceLabel.trim() || undefined);
      setNewSourceUrl('');
      setNewSourceLabel('');
      setShowAddSource(false);
      await loadMarketplace(true);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveSource = async (url: string) => {
    if (!confirm(`Remove source "${url}"?`)) return;
    try {
      await api.removeMarketplaceSource(url);
      await loadMarketplace(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleSource = async (url: string, enabled: boolean) => {
    try {
      await api.toggleMarketplaceSource(url, enabled);
      await loadMarketplace(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  // Filter installed plugins
  const filteredInstalled = manifests.filter((plugin) => {
    if (search) {
      const q = search.toLowerCase();
      if (!plugin.name.toLowerCase().includes(q) && !(plugin.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (tagFilter) {
      const entry = marketplace.find(p => p.name === plugin.name);
      if (!entry || !entry.tags.includes(tagFilter)) return false;
    }
    return true;
  });

  const installedToolCount = pluginModules.reduce((sum, m) => sum + m.toolCount, 0);
  const installedEnabledCount = pluginModules.reduce((sum, m) => sum + m.tools.filter(t => t.enabled).length, 0);

  return (
    <div>
      <div className="header">
        <h1>Plugins</h1>
        <p>Manage installed plugins and browse the marketplace</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
            <button className="btn-sm" onClick={() => { setError(null); loadData(); }}>Retry</button>
          </div>
        </div>
      )}

      {priorityChanged && (
        <div className="alert" style={{ marginBottom: '14px', fontSize: '13px', color: 'var(--text-secondary)', background: 'rgba(110,168,254,0.08)', border: '1px solid rgba(110,168,254,0.2)' }}>
          Priority updated — changes take effect on next agent restart
        </div>
      )}

      {/* Stats bar */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 2 }}>
        <div className="tabs" style={{ marginBottom: 0, flexShrink: 0 }}>
          <button
            className={`tab ${tab === 'installed' ? 'active' : ''}`}
            onClick={() => setTab('installed')}
          >
            Installed
            <span className="tab-count">{manifests.length}</span>
          </button>
          <button
            className={`tab ${tab === 'marketplace' ? 'active' : ''}`}
            onClick={() => setTab('marketplace')}
          >
            Marketplace
            {updatableCount > 0 && (
              <span className="tab-count" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                {updatableCount}
              </span>
            )}
          </button>
        </div>

        {tab === 'installed' && manifests.length > 0 && (
          <>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{installedEnabledCount}</span> enabled
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{installedToolCount}</span> tools
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search plugins..."
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
          {allTags.length > 0 && (
            <Select
              value={tagFilter}
              options={['', ...allTags]}
              labels={['All tags', ...allTags]}
              onChange={(v) => setTagFilter(v)}
              style={{ minWidth: '120px' }}
            />
          )}
          {tab === 'installed' && updatableCount > 0 && (
            <button
              className="btn-sm"
              onClick={handleUpdateAll}
              disabled={!!operating || marketLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {operating ? 'Updating...' : `Update All (${updatableCount})`}
            </button>
          )}
          {tab === 'marketplace' && (
            <>
              {updatableCount > 0 ? (
                <button
                  className="btn-sm"
                  onClick={handleUpdateAll}
                  disabled={!!operating || marketLoading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {operating ? 'Updating...' : `Update All (${updatableCount})`}
                </button>
              ) : marketplace.length > 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>All up to date</span>
              ) : null}
              <button
                className="btn-ghost"
                onClick={() => loadMarketplace(true)}
                disabled={marketLoading}
                style={{ whiteSpace: 'nowrap' }}
              >
                {marketLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => setShowAddSource((v) => !v)}
                style={{ whiteSpace: 'nowrap' }}
                title="Manage plugin registry sources"
              >
                Sources
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Sources panel (marketplace tab) ── */}
      {tab === 'marketplace' && showAddSource && (
        <div className="card" style={{ padding: '14px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontWeight: 600, fontSize: '13px' }}>Plugin Registry Sources</span>
            <button className="btn-ghost btn-sm" onClick={() => { setShowAddSource(false); setSourceError(null); }}>Close</button>
          </div>
          {sourceError && (
            <div className="alert error" style={{ marginBottom: '8px', fontSize: '12px' }}>{sourceError}</div>
          )}
          {/* Existing sources */}
          <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
            {sources.map((src) => (
              <div key={src.url} className="tool-row" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600,
                    ...(src.isOfficial
                      ? { background: 'rgba(80,200,120,0.12)', color: 'var(--green)', border: '1px solid rgba(80,200,120,0.25)' }
                      : { background: 'rgba(255,200,80,0.10)', color: '#f5c842', border: '1px solid rgba(255,200,80,0.2)' }),
                  }}
                >
                  {src.isOfficial ? 'Official' : 'Custom'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{src.label}</span>
                  {src.label !== src.url && (
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: '6px' }}>{src.url}</span>
                  )}
                </span>
                {!src.isOfficial && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                    <label className="toggle" title={src.enabled ? 'Disable' : 'Enable'}>
                      <input type="checkbox" checked={src.enabled} onChange={() => handleToggleSource(src.url, !src.enabled)} />
                      <span className="toggle-track" />
                      <span className="toggle-thumb" />
                    </label>
                    <button
                      className="btn-danger btn-sm"
                      onClick={() => handleRemoveSource(src.url)}
                      style={{ fontSize: '11px' }}
                    >
                      Remove
                    </button>
                  </div>
                )}
                {src.isOfficial && (
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>built-in</span>
                )}
              </div>
            ))}
          </div>
          {/* Add new source */}
          <div style={{ borderTop: '1px solid var(--separator)', paddingTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 200px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>Registry URL</label>
              <input
                type="url"
                placeholder="https://raw.githubusercontent.com/owner/repo/main/registry.json"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSource(); }}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>Label (optional)</label>
              <input
                type="text"
                placeholder="My registry"
                value={newSourceLabel}
                onChange={(e) => setNewSourceLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSource(); }}
                style={{ width: '100%' }}
              />
            </div>
            <button className="btn-sm" onClick={handleAddSource} style={{ flexShrink: 0, alignSelf: 'flex-end', marginBottom: '0px' }}>
              Add Source
            </button>
          </div>
        </div>
      )}

      {/* ── Source filter checkboxes (marketplace tab, when multiple sources) ── */}
      {tab === 'marketplace' && allSourceLabels.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginRight: '2px' }}>Filter by source:</span>
          {allSourceLabels.map((label) => {
            const isActive = activeSourceFilters.has(label);
            const srcEntry = sources.find(s => s.label === label);
            const isOfficial = srcEntry?.isOfficial;
            return (
              <button
                key={label}
                onClick={() => toggleSourceFilter(label)}
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  border: isActive
                    ? (isOfficial ? '1px solid rgba(80,200,120,0.5)' : '1px solid rgba(255,200,80,0.5)')
                    : '1px solid var(--separator)',
                  background: isActive
                    ? (isOfficial ? 'rgba(80,200,120,0.15)' : 'rgba(255,200,80,0.12)')
                    : 'transparent',
                  color: isActive
                    ? (isOfficial ? 'var(--green)' : '#f5c842')
                    : 'var(--text-secondary)',
                }}
              >
                {label}
              </button>
            );
          })}
          {activeSourceFilters.size > 0 && (
            <button
              onClick={() => setActiveSourceFilters(new Set())}
              style={{ fontSize: '11px', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Installed tab ── */}
      {tab === 'installed' && (
        <div className="card" style={{ padding: 0 }}>
          {manifests.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No plugins installed yet</p>
              <button className="btn-sm" onClick={() => setTab('marketplace')}>
                Browse Marketplace
              </button>
            </div>
          ) : filteredInstalled.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No installed plugins match your search
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '8px 14px' }}>Plugin</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Version</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', width: 90 }} title="Hook execution order: lower values run first">Priority</th>
                  <th style={{ textAlign: 'right', padding: '8px 14px', width: 200 }}>Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstalled.map((plugin) => {
                  const module = pluginModules.find((m) => m.name === plugin.name);
                  const marketEntry = marketplace.find(p => p.name === plugin.name);
                  const hasSecrets = marketEntry?.secrets && Object.keys(marketEntry.secrets).length > 0;
                  const isExpanded = expandedPlugin === plugin.name;
                  const someEnabled = module ? module.tools.some((t) => t.enabled) : false;
                  const noneEnabled = module ? module.tools.every((t) => !t.enabled) : true;
                  const scopes = module ? new Set(module.tools.map((t) => t.scope)) : new Set<string>();
                  const mixedScope = scopes.size > 1;
                  const commonScope = mixedScope ? '' : (scopes.values().next().value ?? 'always');
                  const isBusy = updating === plugin.name;
                  const isUpdatable = marketEntry?.status === 'updatable';

                  return (
                    <React.Fragment key={plugin.name}>
                      <tr
                        onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPlugin(isExpanded ? null : plugin.name); } }}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                              {isExpanded ? '\u25BC' : '\u25B6'}
                            </span>
                            <span style={{ fontWeight: 600 }}>{plugin.name}</span>
                            {marketEntry?.source && (
                              <SourceBadge source={marketEntry.source} label={marketEntry.sourceLabel} />
                            )}
                            {noneEnabled && module && module.tools.length > 0 && (
                              <span className="badge warn">Disabled</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', paddingLeft: '22px', flexWrap: 'wrap' }}>
                            {plugin.description && (
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {plugin.description}
                              </span>
                            )}
                            {marketEntry?.author && marketEntry.author !== 'unknown' && (
                              <AuthorBadge author={marketEntry.author} verified={marketEntry.source === 'official'} />
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                          {module ? <span className="badge count">{module.toolCount}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                          {isUpdatable && marketEntry ? (
                            <button
                              className="btn-sm"
                              onClick={() => handleUpdate(marketEntry.id)}
                              disabled={!!operating}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {operating === marketEntry.id ? '...' : `v${marketEntry.remoteVersion}`}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>v{plugin.version}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const prio = priorities[plugin.name] ?? 0;
                            const color = prio < 0 ? 'var(--red)' : prio > 0 ? 'var(--blue, #6ea8fe)' : 'var(--text-secondary)';
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  value={prio}
                                  onChange={(e) => handlePriorityChange(plugin.name, Number(e.target.value))}
                                  min={-1000}
                                  max={1000}
                                  step={10}
                                  title="Hook execution order: lower values run first"
                                  style={{
                                    width: '56px',
                                    padding: '2px 4px',
                                    fontSize: '12px',
                                    textAlign: 'center',
                                    border: '1px solid var(--separator)',
                                    borderRadius: '4px',
                                    backgroundColor: 'transparent',
                                    color,
                                    fontWeight: prio !== 0 ? 600 : 400,
                                  }}
                                />
                                {prio !== 0 && (
                                  <button
                                    onClick={() => handlePriorityChange(plugin.name, 0)}
                                    title="Reset to default"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-tertiary)', fontSize: '12px', lineHeight: 1 }}
                                  >
                                    &#x2715;
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 14px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            {module && module.tools.length > 0 && (
                              <>
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
                              </>
                            )}
                            <button
                              onClick={() => handleUninstall(marketEntry?.id ?? plugin.name)}
                              title="Uninstall"
                              disabled={!!operating}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--red)', opacity: 0.35, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center' }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.35'; }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                          <td colSpan={5} style={{ padding: '0 14px 14px 14px' }}>
                            {/* Tool rows */}
                            {module && module.tools.length > 0 && (
                              <div style={{ display: 'grid', gap: '6px', paddingTop: '6px' }}>
                                {module.tools.map((tool) => (
                                  <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={toggleEnabled} onScope={updateScope} />
                                ))}
                              </div>
                            )}

                            {/* Actions row */}
                            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--separator)' }}>
                              {hasSecrets && marketEntry && (
                                <button
                                  className="btn-ghost btn-sm"
                                  onClick={() => toggleSecrets(marketEntry.id)}
                                >
                                  {expandedSecrets === marketEntry.id ? 'Hide Secrets' : 'Manage Secrets'}
                                </button>
                              )}
                              {marketEntry && (
                                <button
                                  className="btn-ghost btn-sm"
                                  onClick={() => setDetailsPlugin(marketEntry)}
                                >
                                  View Details
                                </button>
                              )}
                              {isUpdatable && marketEntry && (
                                <button
                                  className="btn-sm"
                                  onClick={() => handleUpdate(marketEntry.id)}
                                  disabled={!!operating}
                                >
                                  {operating === marketEntry.id ? 'Updating...' : `Update to v${marketEntry.remoteVersion}`}
                                </button>
                              )}
                              {marketEntry && (
                                <button
                                  className="btn-danger btn-sm"
                                  onClick={() => handleUninstall(marketEntry.id)}
                                  disabled={!!operating}
                                  style={{ marginLeft: 'auto' }}
                                >
                                  Uninstall
                                </button>
                              )}
                            </div>

                            {/* Secrets section */}
                            {hasSecrets && marketEntry && expandedSecrets === marketEntry.id && secretsInfo && (
                              <div style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                                {Object.entries(secretsInfo.declared).map(([key, decl]) => {
                                  const isSet = secretsInfo.configured.includes(key);
                                  return (
                                    <div key={key} className="tool-row" style={{ padding: '8px 12px', flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{key}</span>
                                        {decl.required && <span style={{ color: 'var(--text-secondary)', marginLeft: '4px', fontSize: '11px' }}>required</span>}
                                        <span className={`badge ${isSet ? 'always' : 'warn'}`} style={{ marginLeft: '8px', fontSize: '10px' }}>
                                          {isSet ? 'Set' : 'Not set'}
                                        </span>
                                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '2px 0 0 0' }}>{decl.description}</p>
                                        {decl.env && (
                                          <code style={{ fontSize: '11px', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                                            Env: {decl.env}
                                          </code>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        {editingSecret === key ? (
                                          <>
                                            <input type="password" value={secretInput} onChange={e => setSecretInput(e.target.value)} placeholder="Enter value..." style={{ width: '200px' }} />
                                            <button className="btn-sm" onClick={() => saveSecret(marketEntry.id, key)}>Save</button>
                                            <button className="btn-ghost btn-sm" onClick={() => setEditingSecret(null)}>Cancel</button>
                                          </>
                                        ) : (
                                          <>
                                            <button className="btn-ghost btn-sm" onClick={() => { setEditingSecret(key); setSecretInput(''); }}>
                                              {isSet ? 'Change' : 'Set'}
                                            </button>
                                            {isSet && (
                                              <button className="btn-danger btn-sm" onClick={() => removeSecret(marketEntry.id, key)}>Remove</button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
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
      )}

      {/* ── Secrets wizard modal ── */}
      {secretsWizard && (
        <div className="modal-overlay" onClick={() => !savingSecrets && setSecretsWizard(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '4px' }}>Configure {secretsWizard.pluginName}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              This plugin needs API keys to work. You can configure them now or later.
            </p>
            {Object.entries(secretsWizard.secrets).map(([key, decl]) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  {key} {decl.required && <span style={{ color: 'var(--text-secondary)' }}>*</span>}
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 4px 0' }}>{decl.description}</p>
                {decl.env && (
                  <code style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', opacity: 0.7, marginBottom: '6px' }}>
                    Env: {decl.env}
                  </code>
                )}
                <input
                  type="password"
                  placeholder={`Enter ${key}...`}
                  value={secretValues[key] || ''}
                  onChange={e => setSecretValues(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn-ghost" onClick={() => setSecretsWizard(null)}>Skip</button>
              <button
                className="btn-sm"
                disabled={savingSecrets}
                onClick={async () => {
                  setSavingSecrets(true);
                  try {
                    for (const [key, value] of Object.entries(secretValues)) {
                      if (value.trim()) {
                        await api.setPluginSecret(secretsWizard.pluginId, key, value.trim());
                      }
                    }
                    setSecretsWizard(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSavingSecrets(false);
                  }
                }}
              >
                {savingSecrets ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Plugin Details Modal ── */}
      {detailsPlugin && (
        <PluginDetailsModal
          plugin={detailsPlugin}
          onClose={() => setDetailsPlugin(null)}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onUpdate={handleUpdate}
          operating={operating}
        />
      )}

      {/* ── Marketplace tab ── */}
      {tab === 'marketplace' && (
        <div className="card" style={{ padding: 0 }}>
          {marketLoading && marketplace.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Loading marketplace...</div>
          ) : filteredMarketplace.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {search || tagFilter || activeSourceFilters.size > 0 ? 'No plugins match your search' : 'Marketplace is empty'}
            </div>
          ) : (() => {
            const sorted = [...filteredMarketplace].sort((a, b) => {
              const order = { updatable: 0, installed: 1, available: 2 };
              return order[a.status] - order[b.status];
            });
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '8px 14px' }}>Plugin</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Version</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px', width: 170 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((plugin) => {
                    const isOp = operating === plugin.id;
                    const busy = !!operating;
                    const hasRequiredSecrets = plugin.secrets && Object.values(plugin.secrets).some(s => s.required);
                    const isExpanded = expandedPlugin === `market-${plugin.id}`;

                    return (
                      <React.Fragment key={plugin.id}>
                        <tr
                          onClick={() => setExpandedPlugin(isExpanded ? null : `market-${plugin.id}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPlugin(isExpanded ? null : `market-${plugin.id}`); } }}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                {isExpanded ? '\u25BC' : '\u25B6'}
                              </span>
                              <span style={{ fontWeight: 600 }}>{plugin.name}</span>
                              {plugin.source && (
                                <SourceBadge source={plugin.source} label={plugin.sourceLabel} />
                              )}
                              {hasRequiredSecrets && plugin.status === 'available' && (
                                <span className="badge warn">API Key</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', paddingLeft: '22px', flexWrap: 'wrap' }}>
                              {plugin.description && (
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  {plugin.description}
                                </span>
                              )}
                              {plugin.author && plugin.author !== 'unknown' && (
                                <AuthorBadge author={plugin.author} verified={plugin.source === 'official'} />
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                            <span className="badge count">{plugin.toolCount}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                            v{plugin.remoteVersion}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px 14px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                              <button
                                className="btn-ghost btn-sm"
                                onClick={(e) => { e.stopPropagation(); setDetailsPlugin(plugin); }}
                                style={{ fontSize: '11px' }}
                              >
                                Details
                              </button>
                              {plugin.status === 'available' && (
                                <button className="btn-sm" onClick={() => handleInstall(plugin.id)} disabled={busy}>
                                  {isOp ? 'Installing...' : 'Install'}
                                </button>
                              )}
                              {plugin.status === 'installed' && (
                                <button className="btn-danger btn-sm" onClick={() => handleUninstall(plugin.id)} disabled={busy}>
                                  {isOp ? 'Removing...' : 'Uninstall'}
                                </button>
                              )}
                              {plugin.status === 'updatable' && (
                                <>
                                  <button className="btn-sm" onClick={() => handleUpdate(plugin.id)} disabled={busy}>
                                    {isOp ? 'Updating...' : 'Update'}
                                  </button>
                                  <button className="btn-danger btn-sm" onClick={() => handleUninstall(plugin.id)} disabled={busy}>
                                    Uninstall
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                            <td colSpan={5} style={{ padding: '0 14px 14px 14px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 12px', fontSize: '12px', padding: '8px 0' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Author</span>
                                <span>
                                  {plugin.author && plugin.author !== 'unknown' ? (
                                    <AuthorBadge author={plugin.author} verified={plugin.source === 'official'} />
                                  ) : (
                                    <span style={{ color: 'var(--text-tertiary)' }}>Unknown</span>
                                  )}
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>Source</span>
                                <span>
                                  <SourceBadge source={plugin.source} label={plugin.sourceLabel} />
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>Description</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{plugin.description}</span>
                                {plugin.tags.length > 0 && (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)' }}>Tags</span>
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {plugin.tags.map((t) => (
                                        <span key={t} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                )}
                                {plugin.tools && plugin.tools.length > 0 && (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)' }}>Tools</span>
                                    <span style={{ color: 'var(--text-tertiary)' }}>
                                      {plugin.tools.map(t => t.name).join(', ')}
                                    </span>
                                  </>
                                )}
                              </div>
                              <div style={{ marginTop: '8px' }}>
                                <button className="btn-ghost btn-sm" onClick={() => setDetailsPlugin(plugin)}>
                                  View Full Details
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}
    </div>
  );
}
