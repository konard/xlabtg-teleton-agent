# Dynamic Dashboard Engine

## Current State

The Dashboard (`Dashboard.tsx`) has customizable widgets (PR #36) with drag-and-drop layout powered by `react-grid-layout`. Widgets include stat cards, charts, quick actions, notifications, health check, and live logs. The widget set is fixed at compile time — adding a new widget requires code changes, a build, and deployment.

## Problem

- Widget catalog is static — new widgets require code changes
- Dashboard layout is the same for all use cases
- Cannot create task-specific or role-specific dashboards
- No ability to generate widgets from agent data dynamically
- Cannot share dashboard configurations between users
- Widgets cannot display arbitrary agent-generated content

## What to Implement

### 1. Widget Plugin System
- **Widget definition schema**:
  ```typescript
  interface WidgetDefinition {
    id: string;
    name: string;
    description: string;
    category: 'metrics' | 'status' | 'content' | 'action' | 'custom';
    dataSource: { type: 'api' | 'websocket' | 'static'; endpoint?: string; refreshInterval?: number };
    renderer: 'chart' | 'table' | 'text' | 'markdown' | 'custom';
    defaultSize: { w: number; h: number };
    configSchema: JSONSchema; // user-configurable parameters
  }
  ```
- **Dynamic loading**: Widgets defined as data, not hard-coded components
- **Built-in renderers**: Chart (Recharts), Table, Text/Markdown, KPI card, List

### 2. Dashboard Profiles
- **Multiple dashboards**: Users can create multiple named dashboards
- **Storage**: `dashboards (id, name, description, widgets JSON, layout JSON, is_default, created_at)`
- **Switching**: Dashboard selector in the top bar
- **Templates**: Pre-built dashboard profiles (Operations, Development, Security, Analytics)
- **Sharing**: Export/import dashboard configurations as JSON

### 3. AI-Generated Widgets
- **Agent-driven**: The agent can create widgets dynamically based on conversation
- **Example**: "Show me a chart of today's errors" → agent creates a widget with error data
- **Temporary widgets**: Session-scoped widgets that disappear when the session ends
- **Pinning**: User can pin a temporary widget to make it permanent

### 4. Dashboard API
- `GET /api/dashboards` — list all dashboard profiles
- `POST /api/dashboards` — create a new dashboard
- `PUT /api/dashboards/:id` — update dashboard (layout, widgets)
- `DELETE /api/dashboards/:id` — remove dashboard
- `GET /api/dashboards/:id/widgets` — list widgets in a dashboard
- `POST /api/dashboards/:id/widgets` — add widget to dashboard
- `PUT /api/dashboards/:id/widgets/:wid` — update widget config
- `DELETE /api/dashboards/:id/widgets/:wid` — remove widget
- `POST /api/dashboards/:id/export` — export dashboard config
- `POST /api/dashboards/import` — import dashboard config

### 5. Dashboard Builder UI
- **Location**: Enhanced Dashboard page with "Edit" mode
- **Features**:
  - Widget marketplace/catalog browser
  - Dashboard profile switcher and manager
  - Widget configuration panel (data source, refresh rate, appearance)
  - Dashboard templates gallery
  - Export/import buttons
  - "Create widget from conversation" action

### Backend Architecture
- `src/services/dashboard.ts` — dashboard CRUD and widget management
- `src/services/widget-registry.ts` — widget type registry and validation
- `src/webui/routes/dashboards.ts` — API endpoints

### Implementation Steps

1. Design dashboard and widget schemas
2. Refactor existing widget system to use data-driven definitions
3. Implement built-in widget renderers (chart, table, text, KPI)
4. Create dashboard profile management
5. Build widget plugin system with dynamic loading
6. Implement dashboard templates
7. Add AI-generated widget support
8. Create dashboard management API endpoints
9. Build dashboard builder UI with catalog and profiles

### Files to Modify
- `src/services/` — new dashboard and widget registry services
- `src/webui/routes/` — add dashboard endpoints
- `web/src/pages/Dashboard.tsx` — refactor to support dynamic widgets and profiles
- `web/src/components/widgets/` — refactor to data-driven rendering
- `web/src/components/` — dashboard builder, widget catalog components

### Notes
- **High complexity** — refactoring the existing widget system while maintaining backward compatibility
- Start by extracting existing widgets into the plugin format, then add new capabilities
- AI-generated widgets need careful sandboxing — user data should not be exposed in untrusted widgets
- Dashboard export/import reuses patterns from the existing config export (PR #82)
- Consider a max widget count per dashboard (e.g., 20) for performance
- Widget data sources must respect the same security policies as regular API endpoints
