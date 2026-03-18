import { useEffect, useRef, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';

// Template variable autocomplete for {{user}}, {{agent}}, {{context}}, etc.
function templateAutocomplete(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\{\{[\w]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [
      { label: '{{user}}', type: 'variable', detail: 'current user' },
      { label: '{{agent}}', type: 'variable', detail: 'agent name' },
      { label: '{{context}}', type: 'variable', detail: 'current context' },
      { label: '{{date}}', type: 'variable', detail: 'current date' },
      { label: '{{time}}', type: 'variable', detail: 'current time' },
    ],
  };
}

// Custom theme that reads CSS variables from the document
const liquidGlassTheme = EditorView.theme({
  '&': {
    flex: '1',
    minHeight: '200px',
    fontSize: '13px',
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--glass-border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  '&.cm-focused': {
    outline: '2px solid var(--accent)',
    outlineOffset: '-1px',
  },
  '.cm-scroller': {
    flex: '1',
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '10px 4px',
    caretColor: 'var(--accent)',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-gutters': {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-tertiary)',
    borderRight: '1px solid var(--glass-border)',
  },
  '.cm-gutter': {
    minWidth: '40px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    fontSize: '11px',
  },
  '.cm-activeLine': {
    background: 'var(--surface-hover)',
  },
  '.cm-activeLineGutter': {
    background: 'var(--surface-active)',
    color: 'var(--text)',
  },
  '.cm-selectionBackground': {
    background: 'var(--accent-dim) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'rgba(10, 132, 255, 0.25) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  // Markdown syntax colors
  '.tok-heading': { color: 'var(--accent)', fontWeight: 'bold' },
  '.tok-strong': { fontWeight: 'bold', color: 'var(--text)' },
  '.tok-emphasis': { fontStyle: 'italic', color: 'var(--text-secondary)' },
  '.tok-link': { color: 'var(--cyan)' },
  '.tok-url': { color: 'var(--cyan)', textDecoration: 'underline' },
  '.tok-monospace': { color: 'var(--green)', fontFamily: 'inherit' },
  '.tok-strikethrough': { textDecoration: 'line-through', color: 'var(--text-secondary)' },
  '.tok-comment': { color: 'var(--text-secondary)', fontStyle: 'italic' },
  '.tok-meta': { color: 'var(--purple)' },
  '.tok-keyword': { color: 'var(--purple)' },
  '.tok-string': { color: 'var(--green)' },
  // Search highlight
  '.cm-searchMatch': {
    background: 'rgba(255, 213, 0, 0.25)',
    border: '1px solid rgba(255, 213, 0, 0.5)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'rgba(255, 213, 0, 0.5)',
  },
  // Bracket matching
  '.cm-matchingBracket': {
    background: 'var(--accent-dim)',
    outline: '1px solid var(--accent)',
    borderRadius: '2px',
  },
  // Autocomplete
  '.cm-tooltip': {
    background: 'var(--surface)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    color: 'var(--text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    fontSize: '13px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
  },
  '.cm-completionIcon': {
    color: 'var(--text-secondary)',
  },
});

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  placeholder?: string;
}

export function MarkdownEditor({ value, onChange, onSave, placeholder }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  // Keep refs up to date without recreating editor
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const handleSave = useCallback(() => {
    onSaveRef.current?.();
    return true;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        markdown(),
        autocompletion({ override: [templateAutocomplete] }),
        keymap.of([
          { key: 'Ctrl-s', run: handleSave, preventDefault: true },
          { key: 'Mod-s', run: handleSave, preventDefault: true },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        liquidGlassTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.contentAttributes.of({ 'aria-placeholder': placeholder ?? '' }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only create editor once

  // Sync external value changes (e.g. when loading a different file)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}
    />
  );
}
