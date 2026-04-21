# Memory Prioritization Engine

## Current State

All memory entries have equal weight. There is no mechanism to determine which memories are important and should be retained vs. which are stale or irrelevant. Over time, the memory store grows unboundedly, making retrieval slower and context injection noisier.

## Problem

- All memories are treated equally regardless of relevance or freshness
- No automatic cleanup of stale or low-value data
- Context injection (v2-01) has no quality signal for ranking
- Storage grows without bounds, degrading search performance
- No way to distinguish between a critical decision and a casual remark

## What to Implement

### 1. Importance Scoring Model
- **Scoring dimensions**:
  - **Recency**: Exponential decay — recent memories score higher
  - **Frequency**: How often a memory or its entities are referenced
  - **Impact**: Did this memory lead to a successful task outcome?
  - **Explicit markers**: User-flagged memories ("remember this")
  - **Semantic centrality**: How connected is this node in the knowledge graph (v2-02)?
- **Composite score**: Weighted combination of all dimensions, normalized to 0.0–1.0
- **Formula**: `score = w1*recency + w2*frequency + w3*impact + w4*explicit + w5*centrality`
- **Configurable weights**: Via `config.yaml` → `memory.prioritization.weights`

### 2. Scoring Pipeline
- **On-access**: Bump frequency counter when a memory is retrieved or referenced
- **On-outcome**: When a task completes successfully, boost scores of memories used in its context
- **Periodic**: Background job (configurable interval, default: 1 hour) recalculates composite scores
- **Storage**: `memory_scores (memory_id, score, recency, frequency, impact, explicit, centrality, updated_at)`

### 3. Auto-Cleanup Service
- **Retention policy**: Configurable in `config.yaml`
  - `memory.retention.min_score: 0.1` — memories below this threshold are candidates for cleanup
  - `memory.retention.max_age_days: 90` — hard limit regardless of score
  - `memory.retention.max_entries: 10000` — cap total entries
- **Cleanup flow**: Score → rank → archive (move to `memory_archive` table) → delete after archive period
- **Protection**: Never delete user-flagged or explicitly marked memories
- **Endpoint**: `POST /api/memory/cleanup` — trigger manual cleanup with dry-run option

### 4. Priority-Aware Retrieval
- Integrate scores into semantic search (v2-01) as a ranking boost
- `GET /api/memory/search?q=...&min_score=0.3` — filter by minimum importance
- Context injection uses score to allocate token budget: high-score memories get more space

### 5. Memory Dashboard
- **Location**: Enhance `Memory.tsx` page
- **Features**:
  - Score distribution chart (histogram)
  - "At risk" memories list (approaching cleanup threshold)
  - Manual score adjustment (pin / unpin)
  - Cleanup history log
  - Storage usage stats

### Backend Architecture
- `src/memory/scoring.ts` — score calculation and update logic
- `src/memory/retention.ts` — cleanup policy evaluation and execution
- `src/memory/scheduler.ts` — periodic scoring and cleanup jobs

### Implementation Steps

1. Design `memory_scores` and `memory_archive` tables
2. Implement scoring model with configurable weights
3. Create scoring pipeline (on-access, on-outcome, periodic)
4. Implement retention policy engine with dry-run support
5. Integrate scores into semantic search ranking
6. Add API endpoints for cleanup and score management
7. Build memory dashboard UI components
8. Add configuration options to `config.yaml`

### Files to Modify
- `src/memory/` — new files for scoring, retention, scheduler
- `src/memory/semantic-search.ts` — integrate score-based ranking
- `src/webui/routes/memory.ts` — add score/cleanup endpoints
- `web/src/pages/Memory.tsx` — add score visualization and management
- `config.example.yaml` — add prioritization and retention config

### Notes
- **Medium complexity** — scoring model is straightforward; scheduling and retention need careful testing
- Cleanup is destructive — archive before deleting, and always support dry-run
- Score recalculation on large memory stores may be slow; use incremental updates where possible
- The scoring weights will need tuning based on real usage patterns
- This feature depends on v2-01 (semantic search) and benefits from v2-02 (graph centrality)
