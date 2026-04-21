# AI Widget Generator

## Current State

Dashboard widgets are pre-defined components built at development time. The existing widget registry (`web/src/components/widgets/`) contains fixed implementations for stats, charts, logs, and actions. Users cannot create custom visualizations without modifying the source code.

## Problem

- Creating new widgets requires developer effort
- Users cannot visualize arbitrary data from agent interactions
- No way to quickly prototype a visualization for ad-hoc analysis
- Custom reporting needs are unmet without code changes
- Agent-generated insights have no dedicated display mechanism

## What to Implement

### 1. Natural Language Widget Creation
- **User flow**: "Create a widget showing tool usage by hour" → AI generates widget definition
- **AI pipeline**:
  1. Parse natural language request
  2. Identify data source (which API endpoint, which metrics)
  3. Choose appropriate visualization (chart type, layout)
  4. Generate widget configuration
  5. Preview and refine
- **Supported outputs**: Line chart, bar chart, pie chart, table, KPI card, list, markdown text

### 2. Widget Configuration Generator
- **Input**: Natural language description + optional data sample
- **Output**: Complete widget definition (data source, renderer, styling, refresh interval)
- **Templates**: Pre-built generation templates for common patterns:
  - "Show me X over time" → line chart
  - "Compare X across categories" → bar chart
  - "What percentage of X is Y" → pie chart
  - "List recent X" → table with sorting
  - "Current value of X" → KPI card

### 3. Data Source Auto-Detection
- **API catalog**: The generator knows all available API endpoints and their response schemas
- **Schema matching**: Match user's data request to the best API endpoint
- **Data transformation**: Generate data mapping functions (JSON path, aggregations, filters)
- **Fallback**: If no existing API matches, suggest creating a custom endpoint

### 4. Interactive Refinement
- **Preview**: Show generated widget with real data before saving
- **Refinement prompts**: "Make it a bar chart instead", "Add the last 30 days", "Group by week"
- **Style adjustment**: "Use blue colors", "Make it larger", "Add a title"
- **Undo/redo**: Step back through refinement history

### 5. Widget Generator UI
- **Location**: Accessible from Dashboard edit mode and via command palette (Cmd+K)
- **Features**:
  - Natural language input field with autocomplete suggestions
  - Live preview panel showing generated widget
  - Refinement chat (conversational widget editing)
  - Save to dashboard with one click
  - Template gallery for common widget types
  - Recently generated widgets list

### 6. Widget Generator API
- `POST /api/widgets/generate` — generate widget from natural language description
- `POST /api/widgets/refine` — refine an existing generated widget
- `GET /api/widgets/templates` — list generation templates
- `GET /api/widgets/data-sources` — list available data sources with schemas
- `POST /api/widgets/preview` — preview widget with real data

### Backend Architecture
- `src/services/widget-generator.ts` — AI-powered widget generation
- `src/services/data-source-catalog.ts` — API endpoint catalog and schema registry
- `src/webui/routes/widget-generator.ts` — API endpoints

### Implementation Steps

1. Build API endpoint catalog with response schemas
2. Implement widget generation prompt templates
3. Build natural language → widget definition pipeline
4. Create data source auto-detection and matching
5. Implement interactive refinement loop
6. Build live preview with real data fetching
7. Create widget generator API endpoints
8. Build generator UI with input, preview, and refinement
9. Integrate with dashboard profiles (v2-17)

### Files to Modify
- `src/services/` — new widget generator and data source catalog
- `src/webui/routes/` — add generator endpoints
- `web/src/components/` — widget generator UI, preview panel, refinement chat
- `web/src/pages/Dashboard.tsx` — add "Generate Widget" action button

### Notes
- **High complexity** — reliable natural language → visualization pipeline requires careful prompting
- Depends on v2-17 (Dynamic Dashboard) for the widget plugin system
- Widget generation uses LLM calls — adds cost per generation request
- Generated widgets should be validated against the widget schema before saving
- Consider caching generated definitions for similar requests
- Start with simple chart types; expand renderer support over time
- Privacy: generated widgets should only access data the user is authorized to see
