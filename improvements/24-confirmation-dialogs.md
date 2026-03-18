# Confirmation Dialogs

## Current State

Some destructive actions have confirmation:
- Tasks page has a delete confirmation modal
- Workspace has basic confirmation for file operations

But many destructive actions lack confirmation:
- Disabling tools
- Deleting hooks
- Restarting the agent
- Resetting configuration
- Overwriting soul files

## Problem

- Accidental clicks can cause data loss or service disruption
- No preview of what will change before confirming
- Inconsistent confirmation patterns across pages
- No "undo" for destructive actions

## What to Implement

### 1. Reusable Confirmation Dialog
- **Component**: `<ConfirmDialog />` — modal with title, description, confirm/cancel buttons
- **Variants**:
  - `danger` (red confirm button): delete, reset, overwrite
  - `warning` (orange confirm button): disable, restart
  - `info` (blue confirm button): general "are you sure?"
- **Features**:
  - Show what will change ("This will delete 3 tasks")
  - Require typing to confirm high-risk actions (e.g., type "DELETE" to confirm)
  - Keyboard support: Enter to confirm, Escape to cancel

### 2. Where to Add Confirmations
- **Agent restart**: "Are you sure? Active conversations will be interrupted."
- **Tool disable**: "Disable [tool]? The agent won't be able to use it."
- **Hook delete**: "Delete this hook rule? This cannot be undone."
- **Config reset**: "Reset to defaults? Current configuration will be lost."
- **Soul file overwrite**: "Load template? Current content will be replaced." (task #07)
- **Workspace delete**: "Delete [filename]? This cannot be undone."
- **Plugin uninstall**: "Uninstall [plugin]? Associated tools will be removed."

### 3. Global Confirm Hook
```tsx
// web/src/hooks/useConfirm.ts
const { confirm } = useConfirm();
const handleDelete = async () => {
  const ok = await confirm({
    title: "Delete file?",
    description: "This cannot be undone.",
    variant: "danger",
    confirmText: "Delete"
  });
  if (ok) { /* proceed */ }
};
```

### Implementation Steps

1. Create `<ConfirmDialog />` component
2. Create `useConfirm()` hook with promise-based API
3. Add `<ConfirmDialogProvider />` to App.tsx
4. Replace `window.confirm()` calls with `useConfirm()`
5. Add confirmation to all destructive actions listed above
6. Style dialog matching Liquid Glass design

### Files to Create
- `web/src/components/ConfirmDialog.tsx` — dialog component
- `web/src/hooks/useConfirm.ts` — hook with context provider

### Files to Modify
- `web/src/App.tsx` — add provider
- `web/src/pages/*.tsx` — add confirmations to destructive actions
- `web/src/index.css` — dialog styles

### Notes
- Low complexity — reusable pattern, straightforward implementation
- Tasks page already has a modal pattern — follow same approach
- Consider adding a "Don't ask again" checkbox for frequent non-destructive confirmations
- Accessible: trap focus inside dialog, support screen readers
