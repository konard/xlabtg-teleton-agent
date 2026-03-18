# Tools — Bulk Operations

## Current State

The Tools page (`web/src/pages/Tools.tsx`) allows toggling tools one at a time via individual `ToolRow` toggle switches. Module-level "Enable All" already exists at the module header level.

## Problem

Managing many tools individually is tedious:
- No checkbox selection for multiple tools across modules
- No "Disable All" at page level
- No "Disable Unused" to clean up rarely-used tools
- No way to export the current tool configuration

## What to Implement

### 1. Checkbox Selection
- Add checkboxes to each `ToolRow`
- "Select All" / "Deselect All" at top of page
- Selection count display: "5 selected"

### 2. Bulk Action Bar
- Appears when 1+ tools are selected
- Actions:
  - "Enable Selected" — enable all checked tools
  - "Disable Selected" — disable all checked tools
  - "Set Scope" → dropdown to set scope for all selected
  - "Disable Unused" — disable tools not used in last 30 days (requires usage tracking)

### 3. Export Configuration
- "Export" button → downloads JSON file with tool enable/scope state
- "Import" button → upload JSON to restore tool configuration
- Useful for backup/migration between instances

### Implementation Steps

1. Add checkbox state to `ToolRow` component
2. Create selection management (useState with Set of tool names)
3. Add bulk action bar component (sticky at bottom when selection active)
4. Implement bulk API calls (batch enable/disable/scope)
5. Add export/import functionality
6. Add "Disable Unused" logic (requires usage data)

### Files to Modify
- `web/src/pages/Tools.tsx` — add selection state, bulk bar
- `web/src/components/ToolRow.tsx` — add checkbox
- `web/src/components/BulkActionBar.tsx` — new
- `web/src/lib/api.ts` — add bulk tool operations

### Notes
- Low complexity for basic bulk enable/disable
- "Disable Unused" depends on usage tracking (see task #10)
- Export/import is purely client-side if tool config is stored in config.yaml
