# Sessions — Chat History Page

## Current State

The Config page has a "Sessions" tab with basic session configuration:
- Daily reset policy
- Reset interval
- Idle expiry

The existing Memory page (`web/src/pages/Memory.tsx`) shows knowledge base chunks but NOT chat history. There is no UI to browse past conversations/sessions.

The backend has session management in `src/services/` but no chat history browsing API.

## Problem

- Cannot review past conversations with the agent
- Cannot search through message history
- Cannot export conversation logs
- Cannot tag or organize important conversations
- No conversation analytics (common questions, avg length)

## What to Implement

### 1. Sessions Page (`/sessions`)
- **Route**: Add to `App.tsx` router and `Layout.tsx` sidebar
- **Sections**: Session List, Session Detail View, Conversation Analytics

### 2. Session List
- **Display**: Table/list of all sessions with:
  - Session ID
  - Start time, end time (or "Active")
  - Message count
  - Chat type (DM / Group)
  - User/group identifier
- **Filters**: Date range, chat type, status (active/closed)
- **Search**: Full-text search across messages
- **Sorting**: By date, message count, duration

### 3. Session Detail View
- **Trigger**: Click on session row
- **Display**: Full conversation in chat bubble format
  - User messages (right-aligned)
  - Agent responses (left-aligned)
  - Tool usage indicators between messages
  - Timestamps on each message
- **Actions**:
  - "Export" → download as JSON or Markdown
  - "Delete" → remove session (with confirmation)
  - "Tag" → add labels (important, bug, feature-request)

### 4. Conversation Analytics (Optional)
- Most common questions/topics
- Average conversation length
- Messages per session distribution
- User satisfaction (if feedback mechanism exists)

### Backend Requirements

#### Data Source
- Chat messages are stored via grammy/gramjs bot handlers
- Need to ensure messages are persisted to SQLite with session association
- Table: `messages (id, session_id, role, content, tool_calls, created_at)`

#### API Endpoints
- `GET /api/sessions` — list sessions with pagination
- `GET /api/sessions/:id` — get session details with messages
- `GET /api/sessions/:id/messages` — paginated messages
- `DELETE /api/sessions/:id` — delete session
- `PATCH /api/sessions/:id/tags` — add/remove tags
- `GET /api/sessions/search?q=text` — full-text search
- `GET /api/sessions/export/:id?format=json|md` — export session

### Implementation Steps

1. Ensure messages are persisted to SQLite with session IDs
2. Create `src/services/sessions.ts` with query logic
3. Create `src/webui/routes/sessions.ts` with API endpoints
4. Create `web/src/pages/Sessions.tsx` page
5. Create `<SessionList />`, `<SessionDetail />`, `<ChatBubble />` components
6. Add search and filter UI
7. Add export functionality
8. Add route to `App.tsx` and nav item to `Layout.tsx`
9. Add API calls in `web/src/lib/api.ts`

### Files to Create
- `web/src/pages/Sessions.tsx` — new page
- `web/src/components/sessions/*.tsx` — session components
- `src/services/sessions.ts` — session service (if not already sufficient)
- `src/webui/routes/sessions.ts` — API routes

### Files to Modify
- `web/src/App.tsx` — add route
- `web/src/components/Layout.tsx` — add sidebar nav item
- `web/src/lib/api.ts` — add API calls
- `src/bot/` — ensure message persistence

### Notes
- High complexity — depends on how messages are currently stored
- Check `src/services/` for existing session/message storage
- Privacy: consider whether chat content should be encrypted at rest
- Pagination is essential — sessions could have hundreds of messages
- Full-text search may require SQLite FTS5 extension
