# Agent Registry

## Current State

The existing `19-multi-agent.md` template describes multi-agent support at a high level. The system currently runs a single agent instance with one configuration. `AgentControl` in the WebUI starts/stops this single agent. The agent runtime (`src/agent/runtime.ts`) processes messages for one bot instance with one set of tools, hooks, and soul configuration.

## Problem

- Only one agent type exists — no specialization
- Cannot define different agent roles (research, code, content)
- No centralized catalog of agent capabilities
- Cannot compose teams of agents with different skill sets
- Adding a new agent type requires manual configuration duplication

## What to Implement

### 1. Agent Type Definitions
- **Built-in agent archetypes**:
  - `ResearchAgent` — web search, information gathering, summarization
  - `CodeAgent` — code generation, review, debugging, testing
  - `ContentAgent` — writing, editing, translation, formatting
  - `OrchestratorAgent` — delegates to other agents, aggregates results
  - `MonitorAgent` — system monitoring, health checks, alerting
- **Custom agent types**: Users can define their own via configuration

### 2. Agent Registry Service
- **Storage**: `agent_registry (id, name, type, description, config JSON, soul_template, tools JSON, status, created_at, updated_at)`
- **Config per agent**:
  - Soul/system prompt template
  - Allowed tools list
  - Hook rules
  - LLM provider and model
  - Temperature and other inference parameters
  - Resource limits (max tokens, max tool calls per turn)

### 3. Registry API
- `GET /api/agents` — list all registered agents with status
- `POST /api/agents` — register a new agent from archetype or custom config
- `GET /api/agents/:id` — get agent details and config
- `PUT /api/agents/:id` — update agent configuration
- `DELETE /api/agents/:id` — deregister agent
- `POST /api/agents/:id/clone` — duplicate agent with new name
- `GET /api/agents/archetypes` — list built-in archetypes with descriptions

### 4. Agent Lifecycle Management
- `POST /api/agents/:id/start` — start agent instance
- `POST /api/agents/:id/stop` — stop agent instance
- `GET /api/agents/:id/status` — health and runtime status
- **Process isolation**: Each agent runs in its own worker/subprocess
- **Resource limits**: Configurable per agent (memory, CPU time, concurrent requests)

### 5. Agent Management UI
- **Location**: New "Agents" page in WebUI navigation
- **Features**:
  - Agent catalog with archetype cards
  - "Create Agent" wizard — choose archetype → customize config → deploy
  - Per-agent dashboard: status, metrics, recent activity
  - Agent switcher in sidebar for quick navigation
  - Clone, edit, delete actions per agent

### Backend Architecture
- `src/agent/registry.ts` — agent type definitions and registry CRUD
- `src/agent/agent-manager.ts` — lifecycle management (start/stop/health)
- `src/agent/worker.ts` — isolated agent process wrapper
- `src/webui/routes/agents.ts` — API endpoints

### Implementation Steps

1. Define agent archetype schemas (soul templates, tool lists, default configs)
2. Create `agent_registry` table migration
3. Implement registry service with CRUD operations
4. Implement agent process manager with worker isolation
5. Create archetype templates for built-in agent types
6. Build agent management API endpoints
7. Create Agents page UI with catalog and management features
8. Add agent switcher to sidebar navigation
9. Refactor existing single-agent code to work through registry

### Files to Modify
- `src/agent/` — new registry, manager, and worker files
- `src/webui/routes/` — add agents endpoints
- `web/src/pages/` — new `Agents.tsx` page
- `web/src/components/` — agent cards, wizard, switcher components
- `web/src/App.tsx` — add agents route
- `config.example.yaml` — add agent registry config section

### Relationship to Existing Work
- Extends concepts from `19-multi-agent.md` with concrete archetype definitions
- The existing multi-agent template focused on running multiple instances; this focuses on defining and managing agent types

### Notes
- **Very High complexity** — requires significant architectural refactoring of single-agent assumption
- Start with the registry and archetypes (no process isolation) — let users configure different agent profiles
- Process isolation (step 4) can be deferred to a follow-up iteration
- Consider backward compatibility: existing single-agent config should auto-register as the default agent
- This is a prerequisite for v2-08 (Task Delegation) and v2-09 (Pipeline Execution)
