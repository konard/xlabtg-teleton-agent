# Semantic Vector Memory

## Current State

The agent uses a SQLite-backed memory system (`src/memory/`) for storing conversation context. The existing `Memory.tsx` page provides basic memory browsing. Embeddings support exists via `sqlite-vec` (upgraded to `^0.1.7` stable in PR #86), but there is no semantic search API exposed to users or to the agent itself for retrieval-augmented generation.

## Problem

- Memory retrieval is keyword-based or by exact ID — no "search by meaning"
- The agent cannot recall contextually similar past conversations or tool results
- Users cannot search memory using natural language queries
- Relevant past context is lost unless explicitly referenced
- No way to surface related tasks or outcomes from prior sessions

## What to Implement

### 1. Vector Storage Layer
- **Backend**: Extend SQLite with `sqlite-vec` to store embedding vectors alongside memory entries
- **Schema**: `memory_vectors (id, memory_id FK, embedding BLOB, model TEXT, created_at)`
- **Embedding models**: Support OpenAI `text-embedding-3-small` and local alternatives (e.g., `@xenova/transformers`)
- **Storage targets**:
  - Conversation messages (user + assistant turns)
  - Task descriptions and outcomes
  - Tool invocation results (summarized)

### 2. Semantic Search API
- **Endpoint**: `GET /api/memory/search?q=<natural language query>&limit=10&threshold=0.7`
- **Flow**:
  1. Embed the query string
  2. Perform cosine similarity search against stored vectors
  3. Return ranked results with similarity scores
- **Endpoint**: `GET /api/memory/related/:id` — find memories semantically related to a given memory entry

### 3. Agent Context Integration
- **Auto-retrieval**: Before each LLM call, retrieve top-K relevant memories based on the current conversation context
- **Injection**: Append retrieved memories as a "relevant context" section in the system prompt
- **Configurable**: Enable/disable via `config.yaml` → `memory.semantic_search.enabled: true`
- **Token budget**: Configurable max tokens for injected context (default: 1000)

### 4. Memory Indexing Pipeline
- **On-write**: When a new memory entry is created, compute and store its embedding asynchronously
- **Batch reindex**: `POST /api/memory/reindex` — recompute all embeddings (for model changes)
- **Progress tracking**: Reindex job with status endpoint `GET /api/memory/reindex/status`

### 5. Web UI Enhancements
- **Location**: Enhance existing `Memory.tsx` page
- **Features**:
  - Semantic search bar with natural language input
  - "Similar memories" sidebar when viewing a memory entry
  - Visual similarity scores on search results

### Backend Architecture
- `src/memory/vector-store.ts` — vector storage and retrieval using `sqlite-vec`
- `src/memory/embeddings.ts` — embedding computation (provider-agnostic)
- `src/memory/semantic-search.ts` — search orchestration, ranking, filtering
- `src/webui/routes/memory.ts` — extend with search endpoints

### Implementation Steps

1. Create `vector-store.ts` with `sqlite-vec` integration for insert/query
2. Create `embeddings.ts` with provider abstraction (OpenAI, local)
3. Add `memory_vectors` table migration
4. Create semantic search service with cosine similarity ranking
5. Add `/api/memory/search` and `/api/memory/related/:id` endpoints
6. Integrate auto-retrieval into `src/agent/runtime.ts` before LLM calls
7. Add reindex pipeline with job status tracking
8. Enhance `Memory.tsx` with semantic search UI
9. Add configuration options to `config.yaml`

### Files to Modify
- `src/memory/` — new files for vector store, embeddings, semantic search
- `src/webui/routes/memory.ts` — add search endpoints
- `src/agent/runtime.ts` — integrate semantic context retrieval
- `web/src/pages/Memory.tsx` — add search UI
- `web/src/lib/api.ts` — add memory search API calls
- `config.example.yaml` — add semantic search config section

### Acceptance Criteria
- Search by meaning, not keywords — "what did we discuss about performance?" returns relevant results
- API: `/api/memory/search?q=...` returns ranked results with similarity scores
- Works with existing agent context pipeline
- Configurable embedding provider and token budget

### Notes
- **Medium complexity** — `sqlite-vec` is already a dependency, main work is the search/indexing pipeline
- Embedding computation adds latency; run asynchronously and cache aggressively
- Consider chunking long texts before embedding (max ~512 tokens per chunk)
- Rate-limit embedding API calls to avoid cost spikes during bulk reindex
