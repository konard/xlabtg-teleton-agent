# Soul Editor — Code Editor with Syntax Highlighting

## Current State

The Soul Editor page (`web/src/pages/Soul.tsx`) uses a plain `<textarea>` element for editing system prompt files (SOUL.md, SECURITY.md, STRATEGY.md, MEMORY.md, HEARTBEAT.md).

The textarea has:
- Basic text editing capabilities
- Ctrl+S / Cmd+S save shortcut (recently added)
- Unsaved changes detection
- Tab-based file switching

## Problem

A plain textarea lacks features expected in a modern code/text editor:
- No syntax highlighting for Markdown
- No line numbers
- No code folding
- No minimap for quick navigation
- No autocomplete for template variables (e.g., `{{user}}`, `{{agent}}`)
- No indentation helpers
- Hard to work with large files

## What to Implement

### Option A: Monaco Editor (VS Code engine)
- **Library**: `@monaco-editor/react` (~5MB total, lazy-loaded)
- **Pros**: Full VS Code editing experience, excellent Markdown support, built-in minimap
- **Cons**: Large bundle size, complex setup

### Option B: CodeMirror 6 (Recommended)
- **Library**: `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`
- **Pros**: Modular (only load what you need), lighter (~150KB core), fast, mobile-friendly
- **Cons**: More manual setup, fewer out-of-the-box features

### Recommended: CodeMirror 6

### Features to Add
1. **Markdown syntax highlighting** — headers, bold, italic, links, code blocks
2. **Line numbers** — visible in gutter
3. **Custom autocomplete** — suggest `{{user}}`, `{{agent}}`, `{{context}}` variables
4. **Bracket matching** — highlight matching brackets/parentheses
5. **Search & replace** — Ctrl+F within editor
6. **Minimap** (optional) — for large files
7. **Theme integration** — use dark/light theme CSS variables

### Implementation Steps

1. Install CodeMirror packages in `web/`:
   ```bash
   npm install @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/autocomplete @codemirror/search @codemirror/commands codemirror
   ```
2. Create `<MarkdownEditor />` component in `web/src/components/`
3. Configure extensions: markdown lang, line numbers, autocomplete, theme
4. Create custom theme matching Liquid Glass CSS variables
5. Add autocomplete provider for template variables
6. Replace `<textarea>` in `Soul.tsx` with `<MarkdownEditor />`
7. Preserve Ctrl+S save functionality (integrate with CodeMirror keybindings)
8. Handle dirty state detection from CodeMirror's change events

### Files to Modify
- `web/package.json` — add CodeMirror dependencies
- `web/src/pages/Soul.tsx` — replace textarea with CodeMirror
- `web/src/components/MarkdownEditor.tsx` — new component
- `web/src/index.css` — CodeMirror theme overrides

### Notes
- CodeMirror 6 uses its own DOM management — it does not use React's virtual DOM for the editor content
- Ensure Ctrl+S still triggers save (not browser's save dialog)
- Editor should auto-resize to fill available space
- Consider lazy-loading the editor component with `React.lazy()` to reduce initial bundle impact
