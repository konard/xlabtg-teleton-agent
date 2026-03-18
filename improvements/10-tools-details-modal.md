# Tools — Tool Details Modal

## Current State

The Tools page (`web/src/pages/Tools.tsx`) shows tools in a list with:
- Tool name
- Enable/disable toggle
- Scope selector (always, dm-only, group-only, admin-only)

Each tool is a single row (`ToolRow` component) with minimal information.

## Problem

Users cannot see detailed information about a tool without reading source code:
- No description of what the tool does
- No parameter schema
- No example usage
- No last-used timestamp
- No success/failure statistics

## What to Implement

### 1. Tool Details Modal
- **Trigger**: Click on tool name or an "info" icon in `ToolRow`
- **Component**: `<ToolDetailsModal />`
- **Content**:
  - Tool name and module
  - Description (from tool definition)
  - Parameters schema (formatted JSON or table)
  - Example usage (hardcoded or from tool definition)
  - Enabled state and scope
  - Last used timestamp (if tracked)
  - Success/failure count (if tracked)

### 2. "Test Tool" Button
- In the modal, a "Test Tool" button opens a simple form
- User fills in parameters → executes tool → shows result
- Useful for debugging and verifying tool functionality
- **Backend**: Add `POST /api/tools/:name/test` endpoint

### 3. Backend Data
- **Tool descriptions**: Already in tool definitions (`src/agent/tools/`)
- **Usage stats**: Need new tracking in `src/services/`
  - Table: `tool_usage (tool_name, success BOOLEAN, duration_ms, created_at)`
  - On each tool execution, log to this table
- **API**: `GET /api/tools/:name/details` — returns description, schema, stats

### Implementation Steps

1. Create `<ToolDetailsModal />` component
2. Add "info" button to `ToolRow` component
3. Create backend endpoint for tool details
4. Add tool usage tracking to agent's tool execution pipeline
5. Create test tool form in modal
6. Add API calls in `web/src/lib/api.ts`

### Files to Modify
- `web/src/components/ToolRow.tsx` — add info button
- `web/src/components/ToolDetailsModal.tsx` — new
- `web/src/lib/api.ts` — add tool details/test API calls
- `src/webui/routes/` — add tool details route
- `src/agent/` — add usage tracking on tool execution

### Notes
- Medium complexity — the modal UI is straightforward, but usage tracking requires backend changes
- Tool definitions are in `src/agent/tools/` — examine how tool metadata is structured
- "Test Tool" feature should be admin-only to prevent abuse
