import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  type PromptExperiment,
  type PromptOptimizationSuggestion,
  type PromptSectionId,
  type PromptSectionState,
  type PromptVariant,
} from '../lib/api';
import { useConfirm } from '../components/ConfirmDialog';
import { toast } from '../lib/toast-store';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { SplitView } from '../components/SplitView';
import { TemplateSelector } from '../components/TemplateSelector';
import { VersionHistory } from '../components/VersionHistory';
import { DiffView } from '../components/DiffView';

const SOUL_FILES = ['SOUL.md', 'SECURITY.md', 'STRATEGY.md', 'MEMORY.md', 'HEARTBEAT.md'] as const;

type ViewMode = 'edit' | 'preview' | 'split';

const VIEW_MODE_KEY = 'soul-editor-view-mode';
const DRAFT_KEY_PREFIX = 'soul-draft:';
const AUTO_SAVE_INTERVAL_MS = 30_000;

function draftKey(filename: string) {
  return `${DRAFT_KEY_PREFIX}${filename}`;
}

interface SaveVersionDialogProps {
  onSave: (comment: string) => void;
  onCancel: () => void;
}

function SaveVersionDialog({ onSave, onCancel }: SaveVersionDialogProps) {
  const [comment, setComment] = useState('');
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: 'var(--bg-card, #1e1e1e)',
          borderRadius: '8px',
          padding: '24px',
          width: '400px',
          border: '1px solid var(--border, #333)',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: '15px' }}>Save Version</h3>
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
          Version comment (optional)
        </label>
        <input
          autoFocus
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(comment);
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. Added trading rules"
          style={{ width: '100%', marginBottom: '16px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>Cancel</button>
          <button onClick={() => onSave(comment)}>Save Version</button>
        </div>
      </div>
    </div>
  );
}

function metricPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value * 100)}%`;
}

function ratingText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(1);
}

function variantLabel(variant: PromptVariant): string {
  return `v${variant.version}${variant.active ? ' active' : ''}`;
}

interface AdaptivePromptPanelProps {
  editorContent: string;
  onDiff: (oldContent: string, label: string) => void;
}

function AdaptivePromptPanel({ editorContent, onDiff }: AdaptivePromptPanelProps) {
  const [sections, setSections] = useState<PromptSectionState[]>([]);
  const [activeSection, setActiveSection] = useState<PromptSectionId>('persona');
  const [variants, setVariants] = useState<PromptVariant[]>([]);
  const [experiments, setExperiments] = useState<PromptExperiment[]>([]);
  const [draft, setDraft] = useState('');
  const [suggestion, setSuggestion] = useState<PromptOptimizationSuggestion | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeVariant = variants.find((variant) => variant.active) ?? null;
  const candidate = variants.find((variant) => variant.id === candidateId) ?? null;

  const load = useCallback(async (section: PromptSectionId = activeSection) => {
    setError(null);
    try {
      const [sectionsRes, variantsRes, experimentsRes] = await Promise.all([
        api.getPromptSections(),
        api.listPromptVariants(section),
        api.getPromptExperiments(section),
      ]);
      setSections(sectionsRes.data ?? []);
      const loadedVariants = variantsRes.data ?? [];
      setVariants(loadedVariants);
      setExperiments(experimentsRes.data ?? []);
      const firstCandidate = loadedVariants.find((variant) => !variant.active) ?? loadedVariants[0] ?? null;
      setCandidateId(firstCandidate?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeSection]);

  useEffect(() => {
    void load(activeSection);
  }, [activeSection, load]);

  const createVariant = async (activate: boolean) => {
    const content = draft.trim() || editorContent.trim();
    if (!content) {
      setError('Variant content is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPromptVariant(activeSection, content, activate);
      setDraft('');
      setSuggestion(null);
      toast.success(activate ? 'Variant created and activated' : 'Variant created');
      await load(activeSection);
      if (res.data) setCandidateId(res.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activateVariant = async (variant: PromptVariant) => {
    setBusy(true);
    setError(null);
    try {
      await api.activatePromptVariant(activeSection, variant.id);
      toast.success(`Activated ${variantLabel(variant)}`);
      await load(activeSection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestImprovement = async (createVariantAfterSuggest: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.optimizePrompt({
        section: activeSection,
        variantId: activeVariant?.id,
        createVariant: createVariantAfterSuggest,
      });
      setSuggestion(res.data ?? null);
      if (res.data?.content) setDraft(res.data.content);
      if (res.data?.createdVariant) {
        toast.success('Optimizer variant created');
        await load(activeSection);
        setCandidateId(res.data.createdVariant.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createExperiment = async () => {
    if (!activeVariant || !candidate || activeVariant.id === candidate.id) {
      setError('Select an active control variant and a different candidate');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createPromptExperiment({
        section: activeSection,
        name: `${sections.find((section) => section.id === activeSection)?.label ?? activeSection} test`,
        controlVariantId: activeVariant.id,
        candidateVariantId: candidate.id,
        trafficPercentage: 20,
        minSamples: 30,
        autoPromote: true,
        start: true,
      });
      toast.success('Experiment started');
      await load(activeSection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--separator)',
        marginTop: '10px',
        paddingTop: '12px',
        display: 'grid',
        gridTemplateColumns: 'minmax(170px, 220px) minmax(0, 1fr)',
        gap: '12px',
        minHeight: '240px',
      }}
    >
      <div style={{ display: 'grid', gap: '6px', alignContent: 'start' }}>
        {sections.map((section) => (
          <button
            key={section.id}
            className={activeSection === section.id ? '' : 'btn-ghost'}
            onClick={() => setActiveSection(section.id)}
            style={{ justifyContent: 'space-between', textAlign: 'left', fontSize: '12px' }}
          >
            <span>{section.label}</span>
            <span style={{ opacity: 0.65 }}>{section.variantCount}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
        {error && <div className="alert error">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 280px)', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '14px', margin: 0 }}>Variants</h3>
              <button className="btn-ghost" onClick={() => void load(activeSection)} disabled={busy}>
                Refresh
              </button>
            </div>
            <div style={{ display: 'grid', gap: '6px', maxHeight: '190px', overflow: 'auto' }}>
              {variants.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>No variants</div>
              ) : (
                variants.map((variant) => (
                  <div
                    key={variant.id}
                    style={{
                      border: '1px solid var(--separator)',
                      borderRadius: '8px',
                      padding: '8px',
                      display: 'grid',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '12px' }}>{variantLabel(variant)}</strong>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn-ghost" onClick={() => onDiff(variant.content, `Prompt ${variantLabel(variant)}`)}>
                          Diff
                        </button>
                        <button disabled={busy || variant.active} onClick={() => void activateVariant(variant)}>
                          Activate
                        </button>
                      </div>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                      rating {ratingText(variant.metrics.averageRating)} · success {metricPercent(variant.metrics.taskSuccessRate)} · quality {metricPercent(variant.metrics.responseQualityScore)} · n={variant.metrics.interactions}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 8px' }}>Create</h3>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Variant content, or leave blank to use the current editor content"
              style={{ width: '100%', minHeight: '126px', resize: 'vertical', fontFamily: 'var(--font-mono)' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              <button onClick={() => void createVariant(false)} disabled={busy}>Create</button>
              <button onClick={() => void createVariant(true)} disabled={busy}>Create + Activate</button>
              <button className="btn-ghost" onClick={() => void suggestImprovement(false)} disabled={busy}>
                Suggest
              </button>
              <button className="btn-ghost" onClick={() => void suggestImprovement(true)} disabled={busy}>
                Suggest + Save
              </button>
            </div>
            {suggestion && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '8px' }}>
                {suggestion.validation.passed ? 'Validation passed' : suggestion.validation.issues.join(', ')}
              </div>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--separator)', paddingTop: '10px', display: 'grid', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '14px', margin: 0 }}>A/B Tests</h3>
            <select
              value={candidateId ?? ''}
              onChange={(event) => setCandidateId(Number(event.target.value) || null)}
              style={{ minWidth: '180px' }}
            >
              {variants.filter((variant) => !variant.active).map((variant) => (
                <option key={variant.id} value={variant.id}>
                  Candidate v{variant.version}
                </option>
              ))}
            </select>
            <button onClick={() => void createExperiment()} disabled={busy || !activeVariant || !candidate}>
              Start 80/20
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto' }}>
            {experiments.length === 0 ? (
              <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>No experiments</span>
            ) : (
              experiments.map((experiment) => (
                <div key={experiment.id} style={{ border: '1px solid var(--separator)', borderRadius: '8px', padding: '8px', minWidth: '190px' }}>
                  <strong style={{ fontSize: '12px' }}>{experiment.name}</strong>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                    {experiment.status} · {experiment.trafficPercentage}% candidate · n {experiment.metrics.sampleCounts[String(experiment.controlVariantId)] ?? 0}/{experiment.metrics.sampleCounts[String(experiment.candidateVariantId)] ?? 0}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Soul() {
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<string>(SOUL_FILES[0]);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'edit'
  );

  // Version history UI state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSaveVersionDialog, setShowSaveVersionDialog] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [showAdaptivePrompting, setShowAdaptivePrompting] = useState(false);

  // Diff view state
  const [diffState, setDiffState] = useState<{ versionContent: string; label: string } | null>(null);

  // Auto-save draft ref
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dirty = content !== savedContent;

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  // Save draft to localStorage
  const saveDraft = useCallback((filename: string, draftContent: string) => {
    try {
      localStorage.setItem(draftKey(filename), JSON.stringify({ content: draftContent, ts: Date.now() }));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const clearDraft = useCallback((filename: string) => {
    try {
      localStorage.removeItem(draftKey(filename));
    } catch {}
  }, []);

  const loadFile = useCallback(async (filename: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.getSoulFile(filename);
      const serverContent = res.data.content;

      // Check for a newer draft in localStorage
      try {
        const raw = localStorage.getItem(draftKey(filename));
        if (raw) {
          const draft = JSON.parse(raw) as { content: string; ts: number };
          if (draft.content !== serverContent) {
            const restore = await confirm({
              title: "Restore draft?",
              description: `You have an unsaved draft for ${filename} from ${new Date(draft.ts).toLocaleString()}.`,
              variant: "warning",
              confirmText: "Restore",
            });
            if (restore) {
              setContent(draft.content);
              setSavedContent(serverContent);
              return;
            } else {
              clearDraft(filename);
            }
          } else {
            clearDraft(filename);
          }
        }
      } catch {
        // Ignore draft errors
      }

      setContent(serverContent);
      setSavedContent(serverContent);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [clearDraft]);

  const saveFile = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.updateSoulFile(activeTab, content);
      setSavedContent(content);
      clearDraft(activeTab);
      setMessage({ type: 'success', text: res.data.message });
      toast.success(res.data.message ?? 'File saved successfully');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activeTab, content, clearDraft]);

  const handleSaveVersion = useCallback(async (comment: string) => {
    setShowSaveVersionDialog(false);
    setSavingVersion(true);
    setMessage(null);
    try {
      await api.saveSoulVersion(activeTab, content, comment || undefined);
      setMessage({ type: 'success', text: 'Version saved' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingVersion(false);
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

  // Auto-save draft every 30 seconds while there are unsaved changes
  useEffect(() => {
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);

    autoSaveRef.current = setInterval(() => {
      if (dirty) {
        saveDraft(activeTab, content);
      }
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    };
  }, [dirty, activeTab, content, saveDraft]);

  // Confirm before switching tabs with unsaved changes
  const handleTabSwitch = async (file: string) => {
    if (file === activeTab) return;
    if (dirty && !(await confirm({ title: "Discard changes?", description: "You have unsaved changes.", variant: "warning", confirmText: "Discard" }))) return;
    setActiveTab(file);
    setShowVersionHistory(false);
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

      <div
        className="card"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: showAdaptivePrompting ? 'auto' : 'hidden',
          padding: '12px',
        }}
      >
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

          <TemplateSelector
            activeFile={activeTab}
            onLoad={setContent}
            hasUnsavedChanges={dirty}
          />

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

            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => void saveFile()} disabled={saving || !dirty} title="Save (Ctrl+S)">
                {saving ? 'Saving...' : 'Save'}
              </button>

              <button
                onClick={() => setShowSaveVersionDialog(true)}
                disabled={savingVersion}
                title="Save a named snapshot to version history"
              >
                {savingVersion ? 'Saving...' : 'Save Version'}
              </button>

              <button
                onClick={() => setShowVersionHistory((v) => !v)}
                className={showVersionHistory ? 'active' : ''}
                title="View version history"
              >
                History
              </button>

              <button
                onClick={() => setShowAdaptivePrompting((v) => !v)}
                className={showAdaptivePrompting ? 'active' : ''}
                title="Manage adaptive prompt variants and experiments"
              >
                Adaptive
              </button>

              {dirty && <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Unsaved changes</span>}
            </div>

            {showAdaptivePrompting && (
              <AdaptivePromptPanel
                editorContent={content}
                onDiff={(versionContent, label) => setDiffState({ versionContent, label })}
              />
            )}
          </>
        )}
      </div>

      {showVersionHistory && (
        <VersionHistory
          filename={activeTab}
          onRestore={(restoredContent) => setContent(restoredContent)}
          onDiff={(versionContent, label) => setDiffState({ versionContent, label })}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {showSaveVersionDialog && (
        <SaveVersionDialog
          onSave={(comment) => void handleSaveVersion(comment)}
          onCancel={() => setShowSaveVersionDialog(false)}
        />
      )}

      {diffState && (
        <DiffView
          oldContent={diffState.versionContent}
          newContent={content}
          oldLabel={diffState.label}
          newLabel="Current editor"
          onClose={() => setDiffState(null)}
        />
      )}
    </div>
  );
}
