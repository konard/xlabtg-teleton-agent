# Task Delegation Engine

## Current State

The Tasks page (`web/src/pages/Tasks.tsx`) shows tasks with statuses (pending, in_progress, done, failed, cancelled) but tasks are processed by the single agent instance. There is no mechanism to split complex tasks into subtasks or route them to specialized agents. Task assignment is implicit — whatever the agent is asked, it handles directly.

## Problem

- Complex tasks are handled monolithically by one agent
- No task decomposition into smaller, manageable subtasks
- Cannot route specialized work to the best-suited agent
- No parallel task execution across multiple agents
- Failed subtasks require restarting the entire task
- No visibility into task decomposition and delegation flow

## What to Implement

### 1. Task Decomposition
- **Automatic splitting**: LLM-based analysis breaks complex tasks into subtasks
- **Decomposition prompt**: Structured output with subtask descriptions, dependencies, and required skills
- **Manual override**: Users can manually decompose tasks in the UI
- **Depth limit**: Maximum 3 levels of nesting (task → subtask → sub-subtask)

### 2. Agent Matching
- **Skill-based routing**: Match subtask requirements to agent capabilities (from v2-07 registry)
- **Matching criteria**:
  - Required tools (subtask needs web search → route to ResearchAgent)
  - Domain expertise (code review → CodeAgent)
  - Availability (agent not currently overloaded)
  - Historical performance (which agent type has best success rate for similar tasks?)
- **Fallback**: If no specialist matches, route to OrchestratorAgent or default agent

### 3. Delegation Execution
- **Flow**: Parent task → decompose → match agents → delegate subtasks → collect results → synthesize
- **Parallel execution**: Independent subtasks run concurrently on different agents
- **Sequential execution**: Dependent subtasks wait for prerequisites
- **Result aggregation**: Orchestrator agent collects and synthesizes subtask results into a coherent response
- **Error handling**: Failed subtask → retry with same agent → retry with different agent → escalate to user

### 4. Delegation API
- `POST /api/tasks/:id/decompose` — trigger decomposition of a task
- `GET /api/tasks/:id/subtasks` — list subtasks and their assignments
- `POST /api/tasks/:id/delegate` — manually assign a task to a specific agent
- `GET /api/tasks/:id/tree` — full task tree with status at each level
- `POST /api/tasks/:id/subtasks/:subtask_id/retry` — retry a failed subtask

### 5. Delegation UI
- **Location**: Enhance `Tasks.tsx` page
- **Features**:
  - Task tree visualization (collapsible hierarchy)
  - Agent assignment badges on each subtask
  - Status indicators: pending → delegated → in_progress → done/failed
  - Manual re-assignment drag-and-drop
  - Delegation timeline showing execution order

### Backend Architecture
- `src/agent/delegation/decomposer.ts` — LLM-based task decomposition
- `src/agent/delegation/matcher.ts` — agent-to-task matching
- `src/agent/delegation/executor.ts` — delegation orchestration and result collection
- `src/webui/routes/delegation.ts` — API endpoints

### Implementation Steps

1. Design subtask schema: `subtasks (id, parent_id, task_id, description, agent_id, status, result, created_at)`
2. Implement task decomposer using structured LLM output
3. Implement agent matching algorithm based on capabilities and availability
4. Build delegation executor with parallel/sequential support
5. Implement result aggregation and synthesis
6. Create delegation API endpoints
7. Build task tree UI components
8. Integrate with agent registry (v2-07) for agent selection
9. Add error handling and retry logic

### Files to Modify
- `src/agent/delegation/` — new directory for delegation engine
- `src/agent/runtime.ts` — hook delegation into task processing pipeline
- `src/webui/routes/` — add delegation endpoints
- `web/src/pages/Tasks.tsx` — add task tree and delegation UI
- `web/src/components/` — task tree, agent badge components

### Notes
- **Very High complexity** — multi-agent coordination is architecturally challenging
- Requires v2-07 (Agent Registry) to be implemented first
- Start simple: manual delegation before automatic decomposition
- LLM-based decomposition adds cost — consider caching decomposition patterns
- Race conditions: multiple agents writing results simultaneously need proper locking
- Consider a message queue (in-process or Redis) for reliable task distribution
