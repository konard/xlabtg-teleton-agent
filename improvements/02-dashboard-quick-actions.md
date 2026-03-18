# Dashboard — Quick Actions

## Current State

The Dashboard page (`web/src/pages/Dashboard.tsx`) has:
- Agent control panel (start/stop/restart via `AgentControl` component)
- Settings panels (Agent, Telegram configuration)
- Stat cards and live logs

There are no quick-action buttons for common operations. Users must navigate to different pages to perform routine tasks.

## Problem

Frequent operations require multiple navigation steps:
- To clear cache, user must go to Config or use backend directly
- To export logs, there is no UI option at all
- To run a quick test, user must interact with Telegram
- To switch configuration profiles, user must edit config files manually

## What to Implement

### 1. Quick Action Button Bar
- **Location**: Below stat cards, above live logs in Dashboard
- **Component**: `<QuickActions />` in `web/src/components/`
- **Buttons**:
  - "Export Logs" — download current logs as `.txt` file
  - "Clear Cache" — call `POST /api/cache/clear` endpoint
  - "Restart Agent" — already exists in `AgentControl`, but add a prominent shortcut
  - "Send Test Message" — send a test message via Telegram bot

### 2. Implementation Details

#### Export Logs Button
- Use `LogStore` to get current log entries
- Create a `Blob` with log text and trigger browser download
- No backend changes needed — all client-side

#### Clear Cache Button
- **Backend**: Add `POST /api/cache/clear` endpoint in `src/webui/routes/`
- **Action**: Clear any in-memory caches, vector store temp data
- Show success/failure toast (see task #22 for toast notifications)

#### Send Test Message
- **Backend**: Add `POST /api/test/message` endpoint
- **Action**: Send "Test message from Web UI" to the configured Telegram chat
- Useful for verifying bot connectivity

### Implementation Steps

1. Create `<QuickActions />` component with styled button row
2. Implement client-side log export (Blob + download)
3. Add backend endpoints for cache clear and test message
4. Add API calls in `web/src/lib/api.ts`
5. Integrate into `Dashboard.tsx`

### Files to Modify
- `web/src/pages/Dashboard.tsx` — add QuickActions section
- `web/src/components/QuickActions.tsx` — new component
- `web/src/lib/api.ts` — add API calls
- `src/webui/routes/` — add cache/test endpoints

### Notes
- Buttons should use existing CSS classes (`.glass-btn`, `.btn-primary`)
- Consider adding confirmation for destructive actions (clear cache)
- This is a low-complexity task that provides high user value
