# Global Search (Cmd+K)

## Current State

Each page has its own search when applicable (Tools page has tool search). There is no global search that spans across all sections of the UI.

## Problem

- Cannot search across configs, tools, logs, sessions from one place
- Must navigate to each page to find information
- No quick navigation (type page name to go there)
- No command palette for power users

## What to Implement

### 1. Command Palette / Global Search
- **Trigger**: `Ctrl+K` / `Cmd+K` keyboard shortcut
- **Component**: `<CommandPalette />` — centered modal overlay with search input
- **Behavior**:
  - Type to search across all sections
  - Arrow keys to navigate results
  - Enter to select
  - Escape to close

### 2. Search Sources
- **Navigation**: Page names ("Dashboard", "Tools", "Config", etc.)
- **Tools**: Search tool names and descriptions
- **Config**: Search config field names and values
- **Soul files**: Search content of soul files
- **Recent actions**: "Restart agent", "Save config", etc.
- **Commands**: "Toggle theme", "Export logs", "Clear cache"

### 3. Result Categories
- **Pages**: Navigate to a page
- **Tools**: Navigate to Tools page with tool highlighted
- **Config**: Navigate to Config page with field focused
- **Actions**: Execute command immediately

### 4. Implementation Architecture
```
CommandPalette
├── SearchInput (auto-focused)
├── ResultsList
│   ├── CategoryHeader ("Pages")
│   ├── ResultItem (page name, icon, keyboard shortcut hint)
│   ├── CategoryHeader ("Tools")
│   ├── ResultItem (tool name, module)
│   └── ...
└── Footer ("↑↓ Navigate  ↵ Select  Esc Close")
```

### 5. Search Index
- Build client-side search index from page data
- Use fuzzy matching (e.g., "dsh" matches "Dashboard")
- Library: [fuse.js](https://fusejs.io/) (~5KB) for fuzzy search
- Or implement simple `includes()` matching for MVP

### Implementation Steps

1. Create `<CommandPalette />` component
2. Register `Ctrl+K` keyboard shortcut in `useKeyboardShortcuts`
3. Build search index from navigation items, tools list, config fields
4. Implement fuzzy matching with Fuse.js
5. Handle result selection (navigate, execute, focus)
6. Style overlay matching Liquid Glass design
7. Add keyboard navigation (arrow keys, enter, escape)

### Files to Create
- `web/src/components/CommandPalette.tsx` — main component
- `web/src/lib/search-index.ts` — search index builder

### Files to Modify
- `web/src/App.tsx` — add CommandPalette + keyboard shortcut
- `web/src/index.css` — palette styles
- `web/package.json` — add fuse.js (optional)

### Notes
- Medium complexity — mainly frontend work
- This is a high-impact feature for power users
- Consider adding recently used items at top (no search needed)
- Command palette should render on top of everything (z-index)
- Accessible: ARIA combobox pattern, screen reader announcements
