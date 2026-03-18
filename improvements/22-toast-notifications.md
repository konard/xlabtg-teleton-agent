# Toast Notifications

## Current State

The web UI has no toast/snackbar notification system. After actions like saving configuration, the only feedback is the button re-enabling. Some pages show inline status text, but there is no consistent notification pattern.

## Problem

- Users don't get clear feedback when actions succeed or fail
- No visual confirmation of "Configuration saved" or "Tool enabled"
- Error messages are inconsistent across pages
- No warning notifications (rate limit approaching, etc.)

## What to Implement

### 1. Toast Notification System
- **Types**: Success (green), Error (red), Warning (orange), Info (blue)
- **Position**: Top-right corner of screen
- **Auto-dismiss**: Success/Info after 3s, Warning after 5s, Error stays until dismissed
- **Stacking**: Multiple toasts stack vertically
- **Animation**: Slide in from right, fade out

### 2. Toast Component
- **Component**: `<Toast />` and `<ToastContainer />`
- **API**: Global function `toast.success("Saved!")`, `toast.error("Failed")`, `toast.warn("...")`, `toast.info("...")`
- **State**: Use React context or a simple pub/sub store (like LogStore pattern)

### 3. Integration Points
- Soul Editor: "File saved successfully" / "Save failed: ..."
- Config: "Configuration updated" / "Invalid API key"
- Tools: "Tool enabled" / "Tool disabled"
- Hooks: "Hook saved" / "Hook deleted"
- Agent Control: "Agent started" / "Agent stopped" / "Restart failed"
- Workspace: "File saved" / "File deleted" / "Folder created"

### Implementation (No External Library)
```tsx
// web/src/lib/toast-store.ts
type Toast = { id: string; type: 'success'|'error'|'warn'|'info'; message: string };
// Simple pub/sub: toast.success("msg") adds to store, components subscribe

// web/src/components/ToastContainer.tsx
// Renders toasts from store, handles auto-dismiss timers
```

### Alternative: Use a Library
- [react-hot-toast](https://react-hot-toast.com/) — 5KB, popular, simple API
- [sonner](https://sonner.emilkowal.dev/) — 5KB, beautiful defaults

### Implementation Steps

1. Create toast store (`web/src/lib/toast-store.ts`)
2. Create `<ToastContainer />` component
3. Create `<Toast />` component with type-based styling
4. Add `<ToastContainer />` to `App.tsx` (renders at root level)
5. Replace inline status messages with toast calls across all pages
6. Style toasts using Liquid Glass design variables

### Files to Create
- `web/src/lib/toast-store.ts` — toast state management
- `web/src/components/ToastContainer.tsx` — container component
- `web/src/components/Toast.tsx` — individual toast

### Files to Modify
- `web/src/App.tsx` — add ToastContainer
- `web/src/pages/*.tsx` — replace inline messages with toast calls
- `web/src/index.css` — toast styles

### Notes
- Low complexity — can be done in a few hours
- This is a foundation that many other features will use
- Consider implementing this early as it benefits all other tasks
- Toasts should respect theme (dark/light)
