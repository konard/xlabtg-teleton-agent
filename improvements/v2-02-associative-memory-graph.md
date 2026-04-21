# Associative Memory Graph

## Current State

Memory entries are stored as flat rows in SQLite. Relationships between entities (tasks, tools, conversations, outcomes) are implicit — buried in conversation text rather than explicitly modeled. There is no way to traverse connections like "which tools were used for task X?" or "what conversations led to outcome Y?"

## Problem

- No explicit relationships between memory entities
- Cannot answer "what tools were used when we discussed topic X?"
- Cannot trace decision chains: task → tool → outcome → follow-up
- Related context is scattered across separate memory entries with no links
- The agent cannot reason about connections between past interactions

## What to Implement

### 1. Graph Schema
- **Nodes**: Entities extracted from agent interactions
  - `conversations` — individual sessions/threads
  - `tasks` — user-requested tasks and their outcomes
  - `tools` — tool invocations with parameters and results
  - `topics` — extracted topics/themes from conversations
  - `entities` — named entities (people, projects, URLs, etc.)
- **Edges**: Typed relationships
  - `conversation → USED_TOOL → tool`
  - `task → PRODUCED → outcome`
  - `conversation → ABOUT → topic`
  - `task → RELATED_TO → task`
  - `entity → MENTIONED_IN → conversation`
- **Storage**: SQLite tables `graph_nodes (id, type, label, metadata JSON, created_at)` and `graph_edges (id, source_id, target_id, relation, weight, created_at)`

### 2. Entity Extraction Pipeline
- **On each agent turn**: Extract entities and relationships using LLM-based extraction
- **Extraction prompt**: Structured output requesting entities, types, and relationships
- **Fallback**: Regex-based extraction for common patterns (URLs, @mentions, dates)
- **Deduplication**: Fuzzy matching to avoid duplicate nodes for the same entity

### 3. Graph Query API
- `GET /api/memory/graph/nodes?type=tool&q=search` — list/search nodes
- `GET /api/memory/graph/node/:id/related?depth=2` — traverse relationships up to N hops
- `GET /api/memory/graph/path?from=:id&to=:id` — find shortest path between nodes
- `GET /api/memory/graph/context?task_id=:id` — get full context graph for a task

### 4. Agent Context Enrichment
- When processing a new message, query the graph for related context
- Combine with semantic vector search (v2-01) for hybrid retrieval
- Provide the agent with structured relationship context, not just raw text

### 5. Graph Visualization UI
- **Location**: New tab on `Memory.tsx` page — "Knowledge Graph"
- **Library**: [react-force-graph](https://github.com/vasturiano/react-force-graph) or D3.js force layout
- **Features**:
  - Interactive node-link diagram
  - Filter by node type and relationship type
  - Click node to see details and connected entities
  - Search and highlight paths

### Backend Architecture
- `src/memory/graph-store.ts` — CRUD for nodes and edges
- `src/memory/entity-extractor.ts` — LLM-based entity/relationship extraction
- `src/memory/graph-query.ts` — traversal and path-finding algorithms
- `src/webui/routes/graph.ts` — API endpoints

### Implementation Steps

1. Design and create `graph_nodes` and `graph_edges` SQLite tables
2. Implement `graph-store.ts` with node/edge CRUD operations
3. Implement `entity-extractor.ts` with LLM-based extraction
4. Hook extraction into `src/agent/runtime.ts` post-response pipeline
5. Implement graph query service with traversal algorithms
6. Add API endpoints for graph queries
7. Create graph visualization component in `web/src/components/`
8. Add "Knowledge Graph" tab to `Memory.tsx`

### Files to Modify
- `src/memory/` — new files for graph store, extraction, queries
- `src/agent/runtime.ts` — hook entity extraction into post-response pipeline
- `src/webui/routes/` — add graph API routes
- `web/src/pages/Memory.tsx` — add graph visualization tab
- `web/package.json` — add graph visualization library

### Notes
- **High complexity** — requires entity extraction pipeline and graph algorithms
- Entity extraction via LLM adds cost per message; consider batch extraction or extracting only on "interesting" turns
- Graph size will grow; implement pagination and limit traversal depth
- Consider using the graph to enhance the semantic search from v2-01 (hybrid retrieval)
- Start with simple relationship types; extend as patterns emerge from real usage
