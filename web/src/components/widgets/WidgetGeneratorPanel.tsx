import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  GeneratedWidgetDefinition,
  WidgetDataSourceDefinition,
  WidgetGenerationTemplate,
} from '../../lib/api';
import { GeneratedWidgetRenderer } from './GeneratedWidgetRenderer';

interface WidgetGeneratorPanelProps {
  open: boolean;
  onClose: () => void;
  onSave: (definition: GeneratedWidgetDefinition) => void | Promise<void>;
}

const RECENT_KEY = 'dashboard-generated-widget-recent';

function loadRecent(): GeneratedWidgetDefinition[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(definition: GeneratedWidgetDefinition) {
  const next = [definition, ...loadRecent().filter((item) => item.id !== definition.id)].slice(
    0,
    5
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function WidgetGeneratorPanel({ open, onClose, onSave }: WidgetGeneratorPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [refinement, setRefinement] = useState('');
  const [templates, setTemplates] = useState<WidgetGenerationTemplate[]>([]);
  const [sources, setSources] = useState<WidgetDataSourceDefinition[]>([]);
  const [definition, setDefinition] = useState<GeneratedWidgetDefinition | null>(null);
  const [recent, setRecent] = useState<GeneratedWidgetDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
    api
      .getWidgetTemplates()
      .then((res) => setTemplates(res.data ?? []))
      .catch(() => {});
    api
      .getWidgetDataSources()
      .then((res) => setSources(res.data ?? []))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await api.generateWidget(text);
      if (!res.success || !res.data) throw new Error(res.error ?? 'Generation failed');
      setDefinition(res.data.definition);
      saveRecent(res.data.definition);
      setRecent(loadRecent());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefine(event: FormEvent) {
    event.preventDefault();
    if (!definition || !refinement.trim()) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await api.refineWidget(refinement.trim(), definition);
      if (!res.success || !res.data) throw new Error(res.error ?? 'Refinement failed');
      setDefinition(res.data.definition);
      setRefinement('');
      saveRecent(res.data.definition);
      setRecent(loadRecent());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!definition) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      await onSave(definition);
      saveRecent(definition);
      setRecent(loadRecent());
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  const source = definition ? sources.find((entry) => entry.id === definition.dataSource.id) : null;

  return (
    <div
      className="widget-generator-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Generate widget"
    >
      <div className="widget-generator-panel">
        <div className="widget-generator-header">
          <div>
            <h2>Generate Widget</h2>
            <span>{definition ? definition.title : 'Dashboard widget'}</span>
          </div>
          <button className="btn-ghost btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="widget-generator-body">
          <div className="widget-generator-column">
            <form className="widget-generator-form" onSubmit={handleGenerate}>
              <label htmlFor="widget-generator-prompt">Prompt</label>
              <textarea
                id="widget-generator-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Compare tool usage across categories for the last 7 days"
                rows={4}
              />
              <button type="submit" disabled={loading || !prompt.trim()}>
                {loading ? 'Generating...' : 'Generate'}
              </button>
            </form>

            {templates.length > 0 && (
              <div className="widget-generator-section">
                <div className="widget-generator-section-title">Templates</div>
                <div className="widget-generator-template-list">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setPrompt(template.prompt)}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <div className="widget-generator-section">
                <div className="widget-generator-section-title">Recent</div>
                <div className="widget-generator-recent-list">
                  {recent.map((item) => (
                    <button
                      key={`${item.id}:${item.updatedAt}`}
                      type="button"
                      className="widget-generator-recent"
                      onClick={() => {
                        setDefinition(item);
                        setPrompt(item.generatedFrom);
                      }}
                    >
                      <span>{item.title}</span>
                      <small>{item.dataSource.id}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="widget-generator-column widget-generator-preview-column">
            <div className="widget-generator-preview-header">
              <div>
                <div className="widget-generator-section-title">Preview</div>
                {source && <span>{source.name}</span>}
              </div>
              <button type="button" onClick={handleSave} disabled={!definition || loading}>
                {loading ? 'Working...' : 'Save to Dashboard'}
              </button>
            </div>

            <div className="widget-generator-preview">
              {definition ? (
                <GeneratedWidgetRenderer definition={definition} />
              ) : (
                <div className="generated-widget-empty">No preview</div>
              )}
            </div>

            {definition && (
              <form className="widget-generator-refine" onSubmit={handleRefine}>
                <input
                  value={refinement}
                  onChange={(event) => setRefinement(event.target.value)}
                  placeholder="Make it a pie chart"
                />
                <button type="submit" disabled={loading || !refinement.trim()}>
                  Refine
                </button>
              </form>
            )}

            {definition && definition.refinementHistory.length > 0 && (
              <div className="widget-generator-history">
                {definition.refinementHistory.map((entry) => (
                  <span key={`${entry.prompt}:${entry.appliedAt}`}>{entry.prompt}</span>
                ))}
              </div>
            )}

            {error && <div className="alert error">{error}</div>}
            {status && <div className="alert success">{status}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
