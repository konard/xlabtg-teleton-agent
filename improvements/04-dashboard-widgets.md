# Dashboard — Customizable Widgets

## Current State

The Dashboard layout is fixed: stat cards at the top, live logs below, settings panels accessible via expand. All users see the same layout with no ability to customize.

## Problem

Different users have different priorities. Some care about logs, others about token costs, others about tool usage. A fixed layout doesn't serve diverse workflows. Users cannot:
- Rearrange dashboard sections
- Hide sections they don't use
- Add/remove widgets
- Save their preferred layout

## What to Implement

### 1. Widget System Architecture
- Each dashboard section becomes a "widget" component
- Widgets: Stat Cards, Live Logs, Quick Actions, Token Chart, Tool Chart, Activity Heatmap, Agent Control
- Each widget has a standard wrapper with drag handle, minimize/close, settings

### 2. Drag-and-Drop Grid Layout
- **Library**: [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) (~30KB)
- **Grid**: Responsive grid with configurable column count
- **Dragging**: Widgets can be dragged to reorder
- **Resizing**: Widgets can be resized within grid constraints
- **Persistence**: Save layout to `localStorage` key `dashboard-layout`

### 3. Widget Management
- "Edit Layout" toggle button to enable/disable drag mode
- "Add Widget" button → dropdown showing available widgets
- "Reset Layout" button to restore defaults
- Each widget has a close/minimize button (in edit mode)

### 4. Widget Components
```
web/src/components/widgets/
├── WidgetWrapper.tsx      # Standard wrapper with drag handle, title, controls
├── StatsWidget.tsx        # Stat cards
├── LogsWidget.tsx         # Live logs
├── QuickActionsWidget.tsx # Quick action buttons
├── AgentWidget.tsx        # Agent control
└── index.ts               # Widget registry
```

### Implementation Steps

1. Install `react-grid-layout`: `npm install react-grid-layout @types/react-grid-layout` in `web/`
2. Create `WidgetWrapper` component with standard chrome (title bar, controls)
3. Refactor each Dashboard section into a standalone widget component
4. Create widget registry (name → component mapping)
5. Implement `DashboardGrid` using `react-grid-layout`
6. Add layout persistence to localStorage
7. Add "Edit Layout" mode with add/remove/reset controls
8. Style to match Liquid Glass design system

### Files to Modify
- `web/package.json` — add react-grid-layout
- `web/src/pages/Dashboard.tsx` — replace fixed layout with grid
- `web/src/components/widgets/` — new widget directory
- `web/src/index.css` — grid and widget styles

### Dependencies
- Depends on: Charts (task #01), Quick Actions (task #02)
- Optional: Notification widget (task #03)

### Notes
- This is a high-complexity task — consider implementing it after simpler improvements
- react-grid-layout handles responsive breakpoints natively
- Default layout should match the current fixed layout for backward compatibility
- Mobile: collapse to single-column stacked layout
