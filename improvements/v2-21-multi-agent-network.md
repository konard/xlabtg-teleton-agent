# Multi-Agent Network Protocol

## Current State

The agent operates as an isolated instance. Even with the proposed multi-agent support (v2-07), agents within the same deployment would communicate through shared databases and in-process messaging. There is no protocol for agents running on different machines or in different deployments to discover each other, negotiate capabilities, and collaborate on tasks.

## Problem

- Agents are isolated — no cross-instance communication
- Cannot distribute work across multiple deployments
- No agent discovery mechanism for distributed environments
- No standardized protocol for agent-to-agent messaging
- Cannot form agent teams across organizational boundaries
- No trust model for inter-agent communication

## What to Implement

### 1. Agent Discovery Protocol
- **Registry service**: Central or distributed agent registry
- **Agent advertisement**: Each agent publishes its capabilities, availability, and endpoint
  ```json
  {
    "agentId": "agent-001",
    "name": "ResearchBot",
    "capabilities": ["web-search", "summarization", "translation"],
    "endpoint": "https://agent-001.example.com/api/agent-network",
    "status": "available",
    "load": 0.3,
    "publicKey": "..."
  }
  ```
- **Discovery modes**:
  - **Central registry**: All agents register with a known registry server
  - **Peer-to-peer**: Agents discover each other via broadcast or known peer lists
  - **DNS-based**: Agent endpoints published as DNS SRV records

### 2. Inter-Agent Messaging Protocol
- **Message format** (JSON over HTTPS):
  ```json
  {
    "type": "task_request | task_response | capability_query | heartbeat",
    "from": "agent-001",
    "to": "agent-002",
    "correlationId": "uuid",
    "payload": { ... },
    "signature": "...",
    "timestamp": "ISO-8601"
  }
  ```
- **Message types**:
  - `capability_query` — "Can you handle task type X?"
  - `task_request` — "Please execute this task"
  - `task_response` — "Here are the results"
  - `heartbeat` — "I'm alive and available"
  - `negotiation` — capability and terms negotiation
- **Transport**: HTTPS REST + optional WebSocket for streaming

### 3. Trust and Security
- **Authentication**: Mutual TLS or signed messages (Ed25519)
- **Authorization**: Capability-based — agents only accept tasks matching their published capabilities
- **Trust levels**:
  - `trusted` — full access, share all results
  - `verified` — authenticated but limited data sharing
  - `untrusted` — minimal interaction, sandboxed execution
- **Allowlist/blocklist**: Configurable per-agent access control
- **Audit**: All inter-agent messages logged in audit trail (v2-14)

### 4. Task Coordination
- **Distributed task delegation**: Orchestrator agent delegates subtasks to remote agents
- **Load balancing**: Route tasks to least-loaded capable agent
- **Failover**: If an agent goes offline, reassign its pending tasks
- **Result aggregation**: Collect and merge results from multiple remote agents
- **Timeout**: Per-task timeout with configurable escalation

### 5. Network Management UI
- **Location**: New "Network" page in WebUI
- **Features**:
  - Network topology visualization (connected agents graph)
  - Agent status dashboard (online/offline, load, capabilities)
  - Message flow monitor (real-time inter-agent traffic)
  - Trust management (configure per-agent trust levels)
  - Network health indicators (latency, error rates)
  - Manual agent registration and removal

### 6. Network API
- `GET /api/network/agents` — list known agents in the network
- `POST /api/network/agents` — register a remote agent
- `DELETE /api/network/agents/:id` — remove agent from network
- `GET /api/network/agents/:id/capabilities` — query agent capabilities
- `POST /api/network/agents/:id/tasks` — send task to remote agent
- `GET /api/network/status` — network health overview
- `PUT /api/network/agents/:id/trust` — set trust level for an agent
- `GET /api/network/messages?from=...&to=...` — message log

### Backend Architecture
- `src/services/network/discovery.ts` — agent discovery and registration
- `src/services/network/messenger.ts` — inter-agent messaging with signing
- `src/services/network/trust.ts` — trust model and access control
- `src/services/network/coordinator.ts` — distributed task coordination
- `src/webui/routes/network.ts` — API endpoints

### Implementation Steps

1. Define agent network protocol specification (message formats, discovery, auth)
2. Implement agent discovery service with central registry mode
3. Build inter-agent messenger with message signing
4. Implement trust model with authentication and authorization
5. Build distributed task coordinator with load balancing
6. Implement failover and task reassignment
7. Create network management API endpoints
8. Build network topology UI with monitoring
9. Add peer-to-peer discovery mode
10. Write protocol documentation

### Files to Modify
- `src/services/network/` — new directory for network protocol
- `src/agent/runtime.ts` — integrate with network for remote task handling
- `src/webui/routes/` — add network endpoints
- `web/src/pages/` — new `Network.tsx` page
- `web/src/App.tsx` — add network route
- `config.example.yaml` — add network config (registry URL, keys, trust defaults)

### Notes
- **Very High complexity** — distributed systems with security is the most challenging feature in this epic
- This is an **advanced/optional** feature — implement only after the single-instance multi-agent system is stable
- Start with the central registry mode; add P2P later
- Security is critical — inter-agent communication over the internet must be encrypted and authenticated
- Consider using an existing protocol (e.g., ActivityPub, Matrix) as a foundation rather than building from scratch
- Network partition handling: agents must function independently when disconnected
- Rate limiting: prevent a rogue agent from flooding the network
- Depends on v2-07 (Agent Registry), v2-08 (Task Delegation), and v2-14 (Audit Trail)
