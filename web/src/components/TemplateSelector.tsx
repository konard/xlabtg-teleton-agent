import { useRef, useState } from 'react';
import { TEMPLATES, FILE_EXAMPLES, Template } from '../data/templates';
import { useConfirm } from './ConfirmDialog';

interface TemplateSelectorProps {
  activeFile: string;
  onLoad: (content: string) => void;
  hasUnsavedChanges: boolean;
}

export function TemplateSelector({ activeFile, onLoad, hasUnsavedChanges }: TemplateSelectorProps) {
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  const example = FILE_EXAMPLES[activeFile];

  const handleTemplateChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;

    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;

    if (hasUnsavedChanges && !(await confirm({ title: "Load template?", description: "Loading a template will replace your current content.", variant: "warning", confirmText: "Continue" }))) {
      // Reset the select to blank without loading
      e.target.value = '';
      return;
    }

    onLoad(tpl.content);
    e.target.value = '';
    setOpen(false);
  };

  const handleLoadExample = async () => {
    if (!example) return;
    if (hasUnsavedChanges && !(await confirm({ title: "Load example?", description: "Loading an example will replace your current content.", variant: "warning", confirmText: "Continue" }))) return;
    onLoad(example.content);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {/* Template dropdown */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <select
          ref={selectRef}
          defaultValue=""
          onChange={handleTemplateChange}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          title="Load a built-in prompt template"
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'var(--surface)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontSize: 'var(--font-sm)',
            padding: '4px 28px 4px 10px',
            cursor: 'pointer',
            height: '30px',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLSelectElement).style.borderColor = 'var(--glass-border-strong)';
          }}
          onMouseLeave={(e) => {
            if (!open) (e.currentTarget as HTMLSelectElement).style.borderColor = 'var(--glass-border)';
          }}
        >
          <option value="" disabled>Load template…</option>
          {TEMPLATES.map((tpl: Template) => (
            <option key={tpl.id} value={tpl.id} title={tpl.description}>
              {tpl.name}
            </option>
          ))}
        </select>
        {/* Custom dropdown arrow */}
        <span
          style={{
            position: 'absolute',
            right: '8px',
            pointerEvents: 'none',
            color: 'var(--text-secondary)',
            fontSize: '10px',
          }}
        >
          ▾
        </span>
      </div>

      {/* Load Example button */}
      {example && (
        <button
          onClick={handleLoadExample}
          title={`Load a minimal working example for ${activeFile}`}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-sm)',
            padding: '4px 10px',
            cursor: 'pointer',
            height: '30px',
            whiteSpace: 'nowrap',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.borderColor = 'var(--glass-border-strong)';
            btn.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.borderColor = 'var(--glass-border)';
            btn.style.color = 'var(--text-secondary)';
          }}
        >
          Load Example
        </button>
      )}
    </div>
  );
}
