# Pipeline Execution

## Current State

The workflow automation template (`20-workflow-automation.md`) describes visual workflow building with triggers, conditions, and actions. The current agent processes tasks as isolated units — there is no concept of chained execution where the output of one step feeds into the next, and no dependency resolution between steps.

## Problem

- Cannot chain multiple agent actions into a sequential pipeline
- No dependency resolution between tasks
- Output of one tool cannot automatically feed into another
- Complex workflows require manual intervention at each step
- No way to define reusable multi-step processes

## What to Implement

### 1. Pipeline Definition
- **Pipeline schema**:
  ```yaml
  name: "research-and-summarize"
  steps:
    - id: search
      agent: ResearchAgent
      action: "Search for {topic}"
      output: search_results
    - id: analyze
      agent: CodeAgent
      action: "Analyze {search_results}"
      depends_on: [search]
      output: analysis
    - id: summarize
      agent: ContentAgent
      action: "Create summary from {analysis}"
      depends_on: [analyze]
      output: final_report
  ```
- **Storage**: `pipelines (id, name, description, steps JSON, enabled, created_at, updated_at)`
- **Variable passing**: Step outputs are available as `{variable_name}` in subsequent steps

### 2. Dependency Resolution
- **DAG validation**: Steps form a Directed Acyclic Graph — detect cycles at definition time
- **Topological sort**: Determine execution order based on `depends_on` declarations
- **Parallel branches**: Steps with no dependencies between them execute concurrently
- **Fan-in**: Steps can depend on multiple predecessors (wait for all to complete)

### 3. Pipeline Execution Engine
- **Executor**: Walk the DAG, dispatching steps to appropriate agents
- **State machine per step**: `pending → running → completed | failed | skipped`
- **Context propagation**: Each step receives the accumulated context from all predecessor outputs
- **Error strategies**:
  - `fail_fast` — stop pipeline on first failure (default)
  - `continue` — skip failed step, continue with available data
  - `retry` — retry failed step N times before failing
- **Timeout**: Per-step and per-pipeline configurable timeouts

### 4. Pipeline API
- `GET /api/pipelines` — list all pipeline definitions
- `POST /api/pipelines` — create a new pipeline
- `PUT /api/pipelines/:id` — update pipeline definition
- `DELETE /api/pipelines/:id` — delete pipeline
- `POST /api/pipelines/:id/run` — trigger a pipeline execution
- `GET /api/pipelines/:id/runs` — list execution history
- `GET /api/pipelines/:id/runs/:runId` — detailed run status with per-step results
- `POST /api/pipelines/:id/runs/:runId/cancel` — cancel a running pipeline

### 5. Pipeline Builder UI
- **Location**: New "Pipelines" page or tab within existing Workflows
- **Features**:
  - Visual pipeline builder with step cards connected by arrows
  - Drag-and-drop step ordering
  - Step configuration panel (agent, action, variables, error strategy)
  - Dependency line drawing between steps
  - Pipeline run history with per-step status timeline
  - Real-time execution monitoring with live step status updates

### Backend Architecture
- `src/services/pipeline/definition.ts` — pipeline CRUD and validation
- `src/services/pipeline/resolver.ts` — DAG validation and topological sort
- `src/services/pipeline/executor.ts` — execution engine with state machine
- `src/webui/routes/pipelines.ts` — API endpoints

### Implementation Steps

1. Design pipeline and pipeline_runs table schemas
2. Implement pipeline definition service with DAG validation
3. Implement dependency resolver with topological sort
4. Build pipeline executor with state machine per step
5. Implement variable passing and context propagation
6. Add error handling strategies (fail_fast, continue, retry)
7. Create pipeline API endpoints
8. Build pipeline builder UI with visual editor
9. Add real-time execution monitoring via WebSocket

### Files to Modify
- `src/services/pipeline/` — new directory for pipeline engine
- `src/webui/routes/` — add pipeline endpoints
- `web/src/pages/` — new `Pipelines.tsx` page
- `web/src/components/` — pipeline builder, step cards, run viewer
- `web/src/App.tsx` — add pipelines route

### Relationship to Existing Work
- Extends the workflow automation concept from `20-workflow-automation.md`
- Depends on v2-07 (Agent Registry) for agent routing
- Complements v2-08 (Task Delegation) — delegation is automatic, pipelines are user-defined

### Notes
- **Very High complexity** — DAG execution engine with state management is non-trivial
- Start with linear (sequential-only) pipelines before adding parallel branches
- Visual builder can use react-flow (already proposed in `20-workflow-automation.md`)
- Pipeline runs should be durable — survive agent restarts
- Consider max pipeline size (e.g., 20 steps) to prevent abuse
- Log all step inputs/outputs for debugging and audit
