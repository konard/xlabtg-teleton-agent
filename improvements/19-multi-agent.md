# Multi-Agent Support

## Current State

The system runs a single agent instance. Configuration, tools, hooks, and soul are all for one agent. The `AgentControl` component starts/stops/restarts this single agent.

## Problem

- Cannot run multiple agents simultaneously (e.g., different Telegram bots)
- Cannot test configurations without affecting production
- Cannot specialize agents for different tasks/groups
- No A/B testing of different prompts

## What to Implement

### 1. Agent Registry
- **Concept**: Multiple named agent configurations, each with its own:
  - Soul files (system prompts)
  - Tool selection
  - Hook rules
  - Config (API keys, Telegram tokens)
- **Storage**: Each agent config stored in a separate directory or namespace in SQLite

### 2. Agent Management UI
- **Location**: Enhance existing Dashboard or new "Agents" page
- **Features**:
  - List all agents with status (running/stopped)
  - "Create Agent" → clone from existing or start blank
  - Per-agent start/stop/restart
  - Switch between agent dashboards
  - "Clone Agent" — duplicate config with new name

### 3. Agent Isolation
- Each agent runs in its own process or worker
- Separate WebSocket channels for each agent's logs
- Independent memory and session state
- Shared resource pools (LLM API keys can be shared)

### Backend Architecture
- Agent config namespace: `agents/{agent-id}/config.yaml`
- Agent process manager: start/stop/health per agent
- Shared services: LLM provider (with per-agent rate limiting)
- Independent services: session, memory, hooks per agent

### API Endpoints
- `GET /api/agents` — list agents
- `POST /api/agents` — create agent
- `DELETE /api/agents/:id` — remove agent
- `POST /api/agents/:id/start` — start agent
- `POST /api/agents/:id/stop` — stop agent
- `GET /api/agents/:id/status` — agent status
- `POST /api/agents/:id/clone` — clone agent config

### Implementation Steps

1. Design agent configuration namespace
2. Create agent process/worker manager
3. Refactor single-agent assumption in backend services
4. Create agent registry API endpoints
5. Create agent management UI
6. Add agent switcher to sidebar
7. Scope all existing APIs to agent context (`/api/agents/:id/*`)
8. Handle shared vs isolated resources

### Notes
- **Very High complexity** — requires significant architectural refactoring
- This is one of the largest changes proposed
- Consider starting with "configuration profiles" (simpler: save/load different configs for same agent)
- Process isolation is important for stability (one agent crash shouldn't affect others)
- Resource limits: consider max concurrent agents based on system resources
