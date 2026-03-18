# Tools — Performance/Cost Indicators

## Current State

The Tools page shows tools as a flat list with enable/scope toggles. There is no indication of how each tool affects performance or cost.

## Problem

Users don't know:
- Which tools are expensive (token-heavy)
- Which tools are slow (high execution time)
- Which tools are rarely used (candidates for disabling)
- The overall cost impact of their tool selection

## What to Implement

### 1. Cost Indicator per Tool
- **Display**: Small badge next to tool name: `$` (cheap) / `$$` (moderate) / `$$$` (expensive)
- **Data source**: Calculated from average token usage per tool invocation
- **Fallback**: For tools without usage data, estimate from tool definition (e.g., tools that call external APIs = `$$`)

### 2. Speed Indicator
- **Display**: Colored dot: green (fast, <1s) / yellow (medium, 1-5s) / red (slow, >5s)
- **Data**: Average execution duration from usage tracking table
- **Tooltip**: "Average: 2.3s"

### 3. Usage Frequency
- **Display**: Small text "Used 42 times" or "Never used"
- **Highlight**: Tools unused for 30+ days get a subtle "inactive" styling
- **Recommendation badge**: "Rarely used — consider disabling" for tools with <5 uses in 30 days

### 4. Total Cost Summary
- At the top of Tools page: "Enabled tools estimated cost: $$$ per 1000 requests"
- Updates dynamically as tools are enabled/disabled

### Backend Requirements
- Depends on tool usage tracking (shared with task #10)
- `GET /api/tools/stats` → returns `{ [toolName]: { avgTokens, avgDuration, totalUses, lastUsed } }`

### Implementation Steps

1. Add cost/speed indicators to `ToolRow` component
2. Create `<CostBadge />` and `<SpeedDot />` components
3. Fetch tool stats from backend API
4. Add "inactive" styling for unused tools
5. Add total cost summary at page top

### Files to Modify
- `web/src/components/ToolRow.tsx` — add indicators
- `web/src/components/CostBadge.tsx` — new
- `web/src/pages/Tools.tsx` — add cost summary header
- `web/src/lib/api.ts` — add tool stats API call
- `src/webui/routes/` — add tool stats endpoint

### Dependencies
- Requires tool usage tracking from task #10

### Notes
- Static cost estimates can be implemented first (no backend needed)
- Dynamic stats require usage tracking to be in place
- Consider adding a "Cost Optimizer" suggestion panel that recommends which tools to disable
