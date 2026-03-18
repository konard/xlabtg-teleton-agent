# Dashboard — Charts & Visualizations

## Current State

The Dashboard page (`web/src/pages/Dashboard.tsx`) displays basic metrics as text:
- Uptime (formatted as days/hours/minutes)
- Total sessions count
- Available tools count
- Total tokens used
- Estimated cost

These are shown as simple stat cards with numbers. There are no visual charts or graphs.

Live logs are displayed as raw text in a scrollable container using `useSyncExternalStore` with `LogStore`.

## Problem

Users cannot quickly understand trends or patterns from raw numbers. Text-only metrics make it hard to:
- See token usage trends over time
- Identify which tools are used most
- Understand peak usage hours
- Spot anomalies in activity

## What to Implement

### 1. Token Usage Line Chart
- **Component**: `<TokenUsageChart />` in `web/src/components/charts/`
- **Data**: Track token usage over time (hourly/daily granularity)
- **Backend**: Add API endpoint `GET /api/metrics/tokens?period=24h|7d|30d`
- **Backend storage**: Add `metrics` table in SQLite to record token usage per request with timestamp
- **Library**: Use [Recharts](https://recharts.org/) (lightweight, React-native) or [Chart.js](https://www.chartjs.org/) via `react-chartjs-2`
- **Display**: Line chart with selectable time range (24h, 7d, 30d)

### 2. Tool Usage Pie/Bar Chart
- **Component**: `<ToolUsageChart />`
- **Data**: Count of tool invocations grouped by tool name
- **Backend**: Add `GET /api/metrics/tools?period=7d` — returns `[{ tool: string, count: number }]`
- **Display**: Horizontal bar chart or pie chart showing top 10 tools by usage

### 3. Activity Heatmap
- **Component**: `<ActivityHeatmap />`
- **Data**: Request counts per hour per day of week
- **Backend**: Add `GET /api/metrics/activity?period=30d` — returns matrix `[day][hour] = count`
- **Display**: GitHub-style heatmap grid (7 rows x 24 columns)
- **Library**: Custom SVG component or use `react-calendar-heatmap`

### Implementation Steps

1. Install charting library: `npm install recharts` in `web/`
2. Create `src/services/metrics.ts` backend service to aggregate data from SQLite
3. Create `src/webui/routes/metrics.ts` with API endpoints
4. Create chart components in `web/src/components/charts/`
5. Integrate charts into `Dashboard.tsx` below existing stat cards
6. Add CSS styles matching Liquid Glass design system

### Files to Modify
- `web/package.json` — add chart library dependency
- `web/src/pages/Dashboard.tsx` — add chart sections
- `web/src/lib/api.ts` — add metrics API calls
- `src/webui/` — add metrics routes
- `src/services/` — add metrics aggregation service
- SQLite schema — add metrics table

### Notes
- Charts should respect dark/light theme via CSS variables
- Consider lazy-loading chart components to avoid increasing initial bundle size
- Recharts is ~140KB gzipped, Chart.js is ~60KB — choose based on project needs
