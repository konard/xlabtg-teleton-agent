# Tools — Extended Filter & Search

## Current State

The Tools page (`web/src/pages/Tools.tsx`) has:
- A search input that filters tools by name
- Expandable module groups with enable/scope toggles per tool
- Module-level stats (X enabled / Y total)

Filtering is basic — text search only, matching tool names.

## Problem

As the number of tools grows, users need more ways to find and organize tools:
- Cannot filter by enabled/disabled state
- Cannot sort tools by different criteria
- Cannot group tools by category (only by module)
- No way to see which tools are most/least used

## What to Implement

### 1. Enhanced Filter Bar
- **Filter by state**: "All" | "Enabled" | "Disabled" pills (like Tasks page `PillBar`)
- **Sort by**: Name (A-Z, Z-A), Usage count, Module
- **Group by**: Module (current default), Category, Flat list

### 2. Search Improvements
- Highlight matching text in results
- Search in tool descriptions (not just names)
- Show result count: "Showing 12 of 45 tools"

### Implementation Steps

1. Add `PillBar` filter component below search input (reuse existing `PillBar` from Tasks page)
2. Add sort dropdown using existing `Select` component
3. Extend filter logic to check enabled/disabled state
4. Add description search (requires tool descriptions from backend)
5. Add result count display

### Files to Modify
- `web/src/pages/Tools.tsx` — add filter bar, sort, enhanced search
- `web/src/lib/api.ts` — may need tool usage data endpoint

### Notes
- Low complexity — mostly frontend state management and filtering logic
- Reuse existing `PillBar` and `Select` components
- Tool descriptions may need to come from backend if not already included in tool data
