import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { SplitView } from '../components/SplitView';

const SOUL_FILES = ['SOUL.md', 'SECURITY.md', 'STRATEGY.md', 'MEMORY.md', 'HEARTBEAT.md'] as const;

type ViewMode = 'edit' | 'preview' | 'split';

const VIEW_MODE_KEY = 'soul-editor-view-mode';

export function Soul() {
  const [activeTab, setActiveTab] = useState<string>(SOUL_FILES[0]);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'edit'
  );

  const dirty = content !== savedContent;

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const loadFile = useCallback(async (filename: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.getSoulFile(filename);
      setContent(res.data.content);
      setSavedContent(res.data.content);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  const saveFile = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.updateSoulFile(activeTab, content);
      setSavedContent(content);
      setMessage({ type: 'success', text: res.data.message });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [activeTab, content]);

  // Ctrl+S / Cmd+S to save
  useKeyboardShortcuts([
    { key: 's', ctrl: true, handler: () => { if (dirty && !saving) void saveFile(); } },
  ]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Confirm before switching tabs with unsaved changes
  const handleTabSwitch = (file: string) => {
    if (file === activeTab) return;
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setActiveTab(file);
  };

  useEffect(() => {
    void loadFile(activeTab);
  }, [activeTab, loadFile]);

  const editor = (
    <MarkdownEditor
      value={content}
      onChange={setContent}
      onSave={() => { if (dirty && !saving) void saveFile(); }}
      placeholder={`Edit ${activeTab}...`}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <div className="header" style={{ marginBottom: '16px' }}>
        <h1>Soul Editor</h1>
        <p>Edit system prompt files</p>
      </div>

      {message && (
        <div className={`alert ${message.type}`} style={{ marginBottom: '8px' }}>{message.text}</div>
      )}

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ flex: 1, marginBottom: 0 }}>
            {SOUL_FILES.map((file) => (
              <button
                key={file}
                className={`tab ${activeTab === file ? 'active' : ''}`}
                onClick={() => handleTabSwitch(file)}
              >
                {file}{activeTab === file && dirty ? ' *' : ''}
              </button>
            ))}
          </div>

          <div className="view-mode-toggle">
            {(['edit', 'split', 'preview'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`view-mode-btn ${viewMode === mode ? 'active' : ''}`}
                onClick={() => handleViewMode(mode)}
                title={mode.charAt(0).toUpperCase() + mode.slice(1) + ' mode'}
              >
                {mode === 'edit' ? '✏️ Edit' : mode === 'preview' ? '👁 Preview' : '⬛ Split'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <>
            {viewMode === 'edit' && editor}
            {viewMode === 'preview' && <MarkdownPreview content={content} />}
            {viewMode === 'split' && (
              <SplitView left={editor} right={<MarkdownPreview content={content} />} />
            )}

            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button onClick={() => void saveFile()} disabled={saving || !dirty} title="Save (Ctrl+S)">
                {saving ? 'Saving...' : 'Save'}
              </button>
              {dirty && <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Unsaved changes</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
