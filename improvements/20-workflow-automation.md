# Workflow Automation

## Current State

The Tasks page (`web/src/pages/Tasks.tsx`) shows tasks with statuses (pending, in_progress, done, failed, cancelled) but tasks appear to be backend-created. There is no UI for creating automated workflows with triggers and conditions.

The HEARTBEAT.md soul file suggests periodic behavior, but there is no visual workflow builder.

## Problem

- Cannot create time-based automations (e.g., "send report every Monday at 9am")
- Cannot chain tool executions into workflows
- Cannot set up webhook-triggered actions
- Cannot create event-driven automations
- Manual repetitive tasks waste user time

## What to Implement

### 1. Workflow Builder Page (`/workflows`)
- **Concept**: Visual builder similar to Zapier or n8n
- **Components**: Triggers → Conditions → Actions (linear pipeline)

### 2. Trigger Types
- **Time-based**: Cron schedule ("Every Monday at 9:00 UTC")
- **Message-based**: When agent receives message matching pattern
- **Webhook**: When external HTTP request received at `/api/webhooks/:id`
- **Event-based**: When agent starts, stops, errors, tool completes

### 3. Condition Types
- **Message content**: Contains/matches keyword or regex
- **Time**: Only during business hours, only weekdays
- **State**: Only if agent is running, only if variable equals X

### 4. Action Types
- **Send message**: Send text to specified Telegram chat
- **Execute tool**: Run a specific tool with parameters
- **Call API**: HTTP request to external URL
- **Set variable**: Store a value for use in other workflows
- **Chain workflow**: Trigger another workflow

### 5. Visual Builder
- **Library**: [react-flow](https://reactflow.dev/) for node-based visual editor
- **Nodes**: Colored blocks for triggers (blue), conditions (yellow), actions (green)
- **Connections**: Lines between nodes showing data flow
- **Forms**: Click node to configure in side panel

### Backend Requirements
- Workflow storage in SQLite: `workflows (id, name, config JSON, enabled, created_at)`
- Workflow engine: evaluate triggers, check conditions, execute actions
- Cron scheduler for time-based triggers
- Webhook receiver for external triggers

### Implementation Steps

1. Design workflow data model (JSON schema for trigger → condition → action chains)
2. Install react-flow in `web/`
3. Create workflow engine in `src/services/workflows.ts`
4. Create cron scheduler integration
5. Create webhook receiver endpoint
6. Create `web/src/pages/Workflows.tsx` page
7. Create visual builder components
8. Add workflow CRUD API endpoints
9. Add route to `App.tsx` and nav to `Layout.tsx`

### Notes
- **Very High complexity** — this is a major feature addition
- Consider starting with simple cron-based task scheduling (no visual builder)
- react-flow is ~200KB but provides a complete node editor
- Workflow execution should be sandboxed to prevent infinite loops
- Max workflow depth: 10 actions per chain
- Workflow logging: record each execution with results
