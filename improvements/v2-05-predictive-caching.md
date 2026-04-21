# Predictive Caching Layer

## Current State

The agent loads tools, prompts, and resources on-demand. Each request goes through the full initialization pipeline: load configuration, initialize tools, prepare context. There is no caching layer for frequently accessed resources, and no pre-loading based on predicted needs.

## Problem

- Cold-start latency for tool initialization on each request
- Repeated loading of the same resources across sessions
- No benefit from predictable usage patterns
- LLM prompt construction happens from scratch each time
- Response time suffers under load or with many tools enabled

## What to Implement

### 1. Resource Cache Layer
- **Cached resources**:
  - Tool configurations and schemas
  - Compiled prompt templates (soul files)
  - Embedding vectors for common queries
  - API responses with TTL (external service results)
- **Cache backend**: In-memory LRU cache with configurable max size
- **Cache key**: Hash of resource identifier + relevant configuration
- **TTL**: Configurable per resource type (default: tools 5min, prompts 1min, embeddings 30min)

### 2. Predictive Pre-loading
- **Integration with prediction engine** (v2-04): Pre-load tools and prompts predicted to be needed
- **Session-start pre-load**: When a session starts, pre-load resources based on:
  - User's most frequently used tools
  - Time-of-day patterns
  - Current conversation context
- **Background loading**: Pre-load happens asynchronously, never blocks the main request path

### 3. Cache Management API
- `GET /api/cache/stats` — cache hit/miss rates, size, entries
- `POST /api/cache/invalidate?key=...` — invalidate specific entries
- `POST /api/cache/warm` — trigger pre-loading for current context
- `DELETE /api/cache` — clear entire cache

### 4. Smart Invalidation
- **Config change detection**: Invalidate cached tools/prompts when config or soul files change
- **File watcher**: Use existing `plugin-watcher.ts` pattern for change detection
- **Version stamping**: Each cache entry carries a version; stale versions auto-invalidate

### 5. Performance Monitoring
- **Metrics**: Cache hit rate, average latency reduction, memory usage
- **Integration**: Feed metrics into existing analytics service (`src/services/analytics.ts`)
- **Dashboard widget**: Cache performance stats on the Dashboard

### Backend Architecture
- `src/services/cache.ts` — generic LRU cache with TTL support
- `src/services/preloader.ts` — predictive pre-loading orchestration
- `src/webui/routes/cache.ts` — cache management endpoints

### Implementation Steps

1. Implement generic LRU cache with TTL in `src/services/cache.ts`
2. Wrap tool loading with cache layer
3. Wrap prompt/soul file loading with cache layer
4. Add cache invalidation on file/config changes
5. Integrate with prediction engine for pre-loading
6. Add session-start pre-loading based on usage patterns
7. Create cache management API endpoints
8. Add cache metrics to analytics dashboard

### Files to Modify
- `src/services/` — new cache and preloader services
- `src/agent/tools/` — wrap tool loading with cache
- `src/soul/` — wrap soul file loading with cache
- `src/agent/runtime.ts` — integrate pre-loading on session start
- `src/webui/routes/` — add cache management endpoints
- `web/src/pages/Dashboard.tsx` — add cache stats widget

### Notes
- **Medium complexity** — LRU cache is straightforward; predictive pre-loading requires v2-04
- Memory limits are important — unbounded caching on a resource-constrained system is dangerous
- Start with simple TTL-based caching before adding predictive pre-loading
- Cache invalidation is the hard part — err on the side of invalidating too often
- Monitor memory usage and adjust cache size dynamically based on available resources
