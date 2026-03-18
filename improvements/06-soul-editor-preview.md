# Soul Editor — Live Markdown Preview

## Current State

The Soul Editor (`web/src/pages/Soul.tsx`) shows a raw textarea with Markdown content. Users write Markdown but cannot see how it renders until they save and check elsewhere.

## Problem

Writing Markdown without preview is error-prone:
- Users can't verify formatting (headers, lists, code blocks)
- Template variables aren't visually distinguished
- Long documents are hard to navigate without rendered headings
- Syntax errors in Markdown aren't visible

## What to Implement

### 1. Split View: Editor | Preview
- **Layout**: Horizontal split (editor left, preview right) with adjustable divider
- **Toggle**: Buttons to switch between "Edit", "Preview", "Split" modes
- **Default**: "Edit" mode (current behavior) to not change existing UX

### 2. Markdown Renderer
- **Library**: [react-markdown](https://github.com/remarkjs/react-markdown) (~20KB) with [remark-gfm](https://github.com/remarkjs/remark-gfm) for GitHub Flavored Markdown
- **Features**:
  - Render headings, lists, links, images, code blocks
  - GFM tables support
  - Syntax highlighting in code blocks (use `rehype-highlight` or `prism`)
  - Template variable highlighting: `{{var}}` rendered with distinct styling

### 3. Live Update
- Preview updates on every keystroke (debounced ~300ms for performance)
- Scroll sync between editor and preview (optional, complex)
- Preview matches the dark/light theme

### Implementation Steps

1. Install: `npm install react-markdown remark-gfm` in `web/`
2. Create `<MarkdownPreview />` component
3. Create `<SplitView />` container with resizable divider
4. Add view mode toggle buttons (Edit / Preview / Split) to Soul page header
5. Integrate with existing editor (textarea or CodeMirror from task #05)
6. Style preview to match Liquid Glass design
7. Persist user's preferred view mode in localStorage

### Files to Modify
- `web/package.json` — add react-markdown, remark-gfm
- `web/src/pages/Soul.tsx` — add split view and preview
- `web/src/components/MarkdownPreview.tsx` — new
- `web/src/components/SplitView.tsx` — new (resizable container)
- `web/src/index.css` — preview and split view styles

### Dependencies
- Independent of task #05 (CodeMirror), but works well together
- Can be implemented with the current textarea

### Notes
- Debounce preview rendering to avoid performance issues with large files
- Consider using `React.memo()` on the preview to avoid unnecessary re-renders
- Preview should be read-only (no editing in preview pane)
- Add a "Copy rendered HTML" button for users who want to export
