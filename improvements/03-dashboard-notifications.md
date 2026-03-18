# Dashboard — Notification Center

## Current State

The Dashboard shows live logs via WebSocket streaming, but there is no notification system. Users have no way to:
- See important events at a glance (errors, warnings)
- Get alerted about critical changes
- View a history of notable events

Errors and warnings are mixed into the general log stream.

## Problem

Critical events get lost in the log stream. Users must actively monitor logs to notice:
- API errors or rate limiting
- Agent failures or restarts
- Configuration changes
- Token budget approaching limits

## What to Implement

### 1. Notification Bell in Sidebar
- **Location**: Top-right of sidebar or header area in `Layout.tsx`
- **Component**: `<NotificationBell />` with unread badge count
- **Click action**: Opens dropdown/panel with recent notifications

### 2. Notification Types
- **Error**: Agent crash, API failure, tool execution error
- **Warning**: Rate limit approaching, token budget at 80%+, disk space low
- **Info**: Configuration saved, agent restarted, plugin installed
- **Achievement**: First 1000 messages, new tool integrated (optional, gamification)

### 3. Backend Notification Service
- **Service**: `src/services/notifications.ts`
- **Storage**: SQLite table `notifications` with columns: `id`, `type`, `title`, `message`, `read`, `created_at`
- **API Endpoints**:
  - `GET /api/notifications?unread=true` — list notifications
  - `PATCH /api/notifications/:id/read` — mark as read
  - `POST /api/notifications/read-all` — mark all as read
  - `DELETE /api/notifications/:id` — dismiss notification

### 4. Frontend Components
- `<NotificationBell />` — bell icon with badge
- `<NotificationPanel />` — dropdown list of notifications
- `<NotificationItem />` — single notification with icon, title, time, read/unread state

### 5. Real-time Delivery
- Extend existing WebSocket connection (used for logs) to also push notifications
- Or use SSE (Server-Sent Events) for notification delivery
- Show browser Notification API popup for critical errors (with user permission)

### Implementation Steps

1. Design SQLite `notifications` table schema
2. Create `src/services/notifications.ts` with CRUD operations
3. Add notification triggers in agent lifecycle hooks (errors, restarts)
4. Create API routes in `src/webui/routes/notifications.ts`
5. Create frontend components
6. Add notification bell to `Layout.tsx` sidebar
7. Extend WebSocket to push new notifications
8. Add API calls in `web/src/lib/api.ts`

### Files to Modify
- `src/services/notifications.ts` — new service
- `src/webui/routes/` — new notification routes
- `src/agent/` — add notification triggers on errors/events
- `web/src/components/Layout.tsx` — add bell to sidebar
- `web/src/components/NotificationBell.tsx` — new
- `web/src/components/NotificationPanel.tsx` — new
- `web/src/lib/api.ts` — add notification API calls
- `web/src/index.css` — notification styles

### Notes
- Notifications should respect theme (dark/light)
- Consider grouping similar notifications to avoid spam
- Max storage: keep last 500 notifications, auto-delete older ones
- Unread badge should update in real-time via WebSocket
