# Analytics — New Page

## Current State

The Dashboard shows basic metrics (uptime, sessions, tokens, cost) as text stat cards. There is no dedicated analytics page. Usage patterns, cost trends, and performance metrics are not visualized.

The backend already tracks some data: token usage in memory, session counts, tool availability. However, historical data is not persisted for analysis.

## Problem

- No way to understand usage trends over time
- Cannot identify cost optimization opportunities
- No performance monitoring (response times, error rates)
- No way to set budget alerts
- Cannot generate reports for stakeholders

## What to Implement

### 1. Analytics Page (`/analytics`)
- **Route**: Add to `App.tsx` router and `Layout.tsx` sidebar
- **Icon**: Chart/graph icon in sidebar navigation
- **Sections**: Usage, Performance, Cost Analysis

### 2. Usage Statistics Section
- **Top Used Tools**: Horizontal bar chart — top 10 tools by invocation count
- **Token Consumption by Module**: Pie/donut chart showing token distribution
- **Cost Over Time**: Line chart with daily/weekly/monthly granularity
- **Peak Usage Hours**: Heatmap (7x24 grid, hours vs days of week)
- **Time range selector**: Last 24h, 7d, 30d, custom range

### 3. Performance Metrics Section
- **Average Response Time**: Large number + trend arrow (up/down vs previous period)
- **Success/Failure Rate**: Donut chart + percentage
- **Tool Execution Time Distribution**: Box plot or histogram
- **Error Frequency**: Bar chart of errors per day
- **P95/P99 latency**: Table with percentile breakdowns

### 4. Cost Analysis Section
- **Daily/Weekly/Monthly Cost**: Switchable bar chart
- **Cost per Tool**: Table sorted by cost (most expensive first)
- **Budget Alert Configuration**: Set monthly limit, get notification at 80%/90%/100%
- **Projection**: "At current rate, monthly cost will be $X" with trend line

### Backend Requirements

#### New SQLite Tables
```sql
CREATE TABLE request_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cost_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,  -- YYYY-MM-DD
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  request_count INTEGER DEFAULT 0
);
```

#### API Endpoints
- `GET /api/analytics/usage?period=7d` — token usage over time
- `GET /api/analytics/tools?period=7d` — tool usage breakdown
- `GET /api/analytics/performance?period=7d` — response time, success rate
- `GET /api/analytics/cost?period=30d` — cost breakdown
- `GET /api/analytics/heatmap?period=30d` — activity heatmap data
- `GET /api/analytics/budget` — current budget config and status
- `PUT /api/analytics/budget` — set budget limit

### Implementation Steps

1. Design and create SQLite tables for metrics
2. Add metrics recording to agent's request pipeline
3. Create `src/services/analytics.ts` with aggregation queries
4. Create `src/webui/routes/analytics.ts` with API endpoints
5. Install charting library in `web/` (Recharts recommended)
6. Create `web/src/pages/Analytics.tsx` page
7. Create chart components: `UsageChart`, `ToolBreakdown`, `CostChart`, `Heatmap`, `PerformancePanel`
8. Add route to `App.tsx` and nav item to `Layout.tsx`
9. Add budget alert logic and notification integration
10. Add API calls in `web/src/lib/api.ts`

### Files to Create
- `web/src/pages/Analytics.tsx` — new page
- `web/src/components/analytics/*.tsx` — chart components
- `src/services/analytics.ts` — analytics service
- `src/webui/routes/analytics.ts` — API routes

### Files to Modify
- `web/src/App.tsx` — add route
- `web/src/components/Layout.tsx` — add sidebar nav item
- `web/src/lib/api.ts` — add API calls
- `web/package.json` — add recharts
- `src/agent/` — add metrics recording

### Dependencies
- Charts library (task #01 shares this dependency)
- Tool usage tracking (shared with tasks #10, #12)

### Notes
- High complexity — significant backend and frontend work
- Start with basic token/cost tracking, add performance metrics later
- Historical data migration: for existing installations, metrics start from the day this is deployed
- Consider data retention policy: auto-delete metrics older than 90 days
