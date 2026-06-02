import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/utils';
import { Loading } from '../components/Loading';
import { useResource } from '../hooks/useResource';
import { Alert } from '../components/Alert';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';

interface TriggerEntry {
  id: string;
  keyword: string;
  context: string;
  enabled: boolean;
}

interface BlocklistData {
  enabled: boolean;
  keywords: string[];
  message: string;
}

interface HooksData {
  blocklist: BlocklistData;
  triggers: TriggerEntry[];
}

// ── BlocklistCard ──────────────────────────────────────────────────────────

interface BlocklistCardProps {
  initialData: BlocklistData;
  onError: (msg: string | null) => void;
}

function BlocklistCard({ initialData, onError }: BlocklistCardProps) {
  const [blockEnabled, setBlockEnabled] = useState(initialData.enabled);
  const [keywords, setKeywords] = useState<string[]>(initialData.keywords);
  const [blockMessage, setBlockMessage] = useState(initialData.message);
  const [keywordInput, setKeywordInput] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocklistRef = useRef<BlocklistData>(initialData);

  // Keep ref in sync with latest state values for debounce closure
  blocklistRef.current = { enabled: blockEnabled, keywords, message: blockMessage };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const saveBlocklist = useCallback((config: BlocklistData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updateBlocklist(config);
      } catch (err) {
        onError(errMsg(err));
        toast.error(errMsg(err));
      }
    }, 400);
  }, [onError]);

  const handleToggleBlocklist = () => {
    const next = !blockEnabled;
    setBlockEnabled(next);
    saveBlocklist({ ...blocklistRef.current, enabled: next });
  };

  const handleAddKeyword = () => {
    const kw = keywordInput.trim();
    if (kw.length < 2) return;
    if (keywords.includes(kw)) { setKeywordInput(''); return; }
    const next = [...keywords, kw];
    setKeywords(next);
    setKeywordInput('');
    saveBlocklist({ ...blocklistRef.current, keywords: next });
  };

  const handleRemoveKeyword = (kw: string) => {
    const next = keywords.filter((k) => k !== kw);
    setKeywords(next);
    saveBlocklist({ ...blocklistRef.current, keywords: next });
  };

  const handleBlockMessageChange = (msg: string) => {
    setBlockMessage(msg);
    saveBlocklist({ ...blocklistRef.current, message: msg });
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>Keyword Blocklist</h2>
        <label className="toggle">
          <input type="checkbox" checked={blockEnabled} onChange={handleToggleBlocklist} />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>
        Messages containing these keywords will be blocked. Word-boundary matching (no substring matches).
      </p>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Keywords</label>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '8px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          minHeight: '36px',
          alignItems: 'center',
        }}>
          {keywords.map((kw) => (
            <span
              key={kw}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'var(--accent-subtle)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            >
              {kw}
              <button
                onClick={() => handleRemoveKeyword(kw)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  lineHeight: 1,
                  height: 'auto',
                  borderRadius: 0,
                }}
              >
                &#x2715;
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add keyword..."
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword(); }
              if (e.key === 'Backspace' && !keywordInput && keywords.length > 0) {
                handleRemoveKeyword(keywords[keywords.length - 1]);
              }
            }}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '13px',
              flex: 1,
              minWidth: '100px',
              padding: '2px 0',
            }}
          />
        </div>
      </div>

      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Block reply (optional)
        </label>
        <input
          type="text"
          placeholder="Message sent when a message is blocked..."
          value={blockMessage}
          onChange={(e) => handleBlockMessageChange(e.target.value)}
          maxLength={500}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

// ── TriggersCard ───────────────────────────────────────────────────────────

interface TriggersCardProps {
  initialTriggers: TriggerEntry[];
  onError: (msg: string | null) => void;
}

function TriggersCard({ initialTriggers, onError }: TriggersCardProps) {
  const confirm = useConfirm();
  const [triggers, setTriggers] = useState<TriggerEntry[]>(initialTriggers);
  const [newKeyword, setNewKeyword] = useState('');
  const [newContext, setNewContext] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState('');
  const [editContext, setEditContext] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddTrigger = async () => {
    const kw = newKeyword.trim();
    const ctx = newContext.trim();
    if (kw.length < 2 || ctx.length < 1) return;
    setSaving(true);
    try {
      const res = await api.createTrigger({ keyword: kw, context: ctx });
      setTriggers((prev) => [...prev, res.data]);
      setNewKeyword('');
      setNewContext('');
      toast.success('Trigger created');
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrigger = async (id: string) => {
    if (!(await confirm({ message: 'Delete this trigger?', destructive: true, confirmLabel: 'Delete' }))) return;
    try {
      await api.deleteTrigger(id);
      setTriggers((prev) => prev.filter((t) => t.id !== id));
      toast.success('Trigger deleted');
    } catch (err) {
      onError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const handleToggleTrigger = async (id: string, enabled: boolean) => {
    try {
      await api.toggleTrigger(id, !enabled);
      setTriggers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, enabled: !enabled } : t))
      );
      toast.success('Trigger updated');
    } catch (err) {
      onError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const startEdit = (t: TriggerEntry) => {
    setEditingId(t.id);
    setEditKeyword(t.keyword);
    setEditContext(t.context);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const kw = editKeyword.trim();
    const ctx = editContext.trim();
    if (kw.length < 2 || ctx.length < 1) return;
    setSaving(true);
    try {
      const res = await api.updateTrigger(editingId, { keyword: kw, context: ctx });
      setTriggers((prev) =>
        prev.map((t) => (t.id === editingId ? res.data : t))
      );
      setEditingId(null);
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>Context Triggers</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{triggers.length}/50</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>
        When a keyword is detected, the associated context is injected into the LLM prompt.
      </p>

      {/* Existing triggers */}
      {triggers.length > 0 && (
        <div style={{ display: 'grid', gap: '8px', marginBottom: '14px' }}>
          {triggers.map((t) => (
            <div
              key={t.id}
              className="tool-row"
              style={{
                padding: '10px 12px',
                opacity: t.enabled ? 1 : 0.5,
                transition: 'opacity 0.15s',
              }}
            >
              {editingId === t.id ? (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                    <input
                      type="text"
                      value={editKeyword}
                      onChange={(e) => setEditKeyword(e.target.value)}
                      placeholder="Keyword"
                      style={{ flex: '0 0 200px' }}
                    />
                    <button className="btn-sm" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                  <textarea
                    value={editContext}
                    onChange={(e) => setEditContext(e.target.value)}
                    placeholder="Context to inject..."
                    maxLength={2000}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>"{t.keyword}"</span>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '80px',
                      overflow: 'hidden',
                    }}>
                      {t.context}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => startEdit(t)}
                      style={{ fontSize: '12px' }}
                    >
                      Edit
                    </button>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={() => handleToggleTrigger(t.id, t.enabled)}
                      />
                      <span className="toggle-track" />
                      <span className="toggle-thumb" />
                    </label>
                    <button
                      onClick={() => handleDeleteTrigger(t.id)}
                      className="hover-fade-half"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        color: 'var(--red)',
                        height: 'auto',
                        borderRadius: 0,
                      }}
                    >
                      &#x2715;
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New trigger form */}
      <div style={{
        padding: '12px',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        background: 'var(--glass-ultrathin)',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
          New Trigger
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="Keyword (min 2 chars)"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            maxLength={100}
            style={{ flex: '0 0 200px' }}
          />
        </div>
        <textarea
          placeholder="Context to inject when keyword is detected..."
          value={newContext}
          onChange={(e) => setNewContext(e.target.value)}
          maxLength={2000}
          rows={3}
          style={{ width: '100%', resize: 'vertical', marginBottom: '8px' }}
        />
        <button
          className="btn-sm"
          onClick={handleAddTrigger}
          disabled={saving || newKeyword.trim().length < 2 || newContext.trim().length < 1}
        >
          {saving ? 'Adding...' : 'Add Trigger'}
        </button>
      </div>
    </div>
  );
}

// ── Hooks page ─────────────────────────────────────────────────────────────

export function Hooks() {
  const { data: hooksData, loading, error, setError } = useResource<HooksData>(
    async () => {
      const [blockRes, trigRes] = await Promise.all([api.getBlocklist(), api.getTriggers()]);
      return { blocklist: blockRes.data, triggers: trigRes.data };
    },
    [],
  );

  if (loading) return <Loading />;

  return (
    <div>
      <div className="header">
        <h1>Hooks</h1>
        <p>Keyword blocklist and context injection triggers</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      {hooksData && (
        <>
          <BlocklistCard initialData={hooksData.blocklist} onError={setError} />
          <TriggersCard initialTriggers={hooksData.triggers} onError={setError} />
        </>
      )}
    </div>
  );
}
