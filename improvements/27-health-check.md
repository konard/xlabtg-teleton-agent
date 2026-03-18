# Health Check Dashboard

## Current State

The Dashboard shows uptime and basic agent status (running/stopped). The `AgentControl` component polls `/api/agent/status` every 10 seconds. There is no comprehensive health check system.

## Problem

- Cannot see if external services are reachable (LLM API, Telegram API)
- No database health monitoring
- No memory/disk usage visibility
- No proactive alerting when something is degraded

## What to Implement

### 1. Health Check Widget
- **Location**: Dashboard or dedicated section
- **Component**: `<HealthCheck />`
- **Checks**:
  - Agent process: running/stopped (already exists)
  - LLM API: connectivity + response time
  - Telegram API: bot token valid, webhook active
  - SQLite database: file accessible, size
  - Disk space: available storage
  - Memory usage: Node.js heap size
  - MCP servers: each server connected/disconnected
  - TON proxy: if configured, connectivity check

### 2. Health Status Display
- **Format**: List of items with status indicators:
  - Green circle: healthy
  - Yellow circle: degraded (slow but working)
  - Red circle: unhealthy (unreachable/error)
  - Grey circle: not configured
- **Details**: Click item → expand to show latency, last check time, error message

### 3. API Endpoint
- `GET /api/health` — returns health check results:
  ```json
  {
    "status": "healthy|degraded|unhealthy",
    "checks": {
      "agent": { "status": "healthy", "uptime": 3600 },
      "llm_api": { "status": "healthy", "latency_ms": 234 },
      "telegram": { "status": "healthy", "latency_ms": 89 },
      "database": { "status": "healthy", "size_mb": 45 },
      "disk": { "status": "healthy", "free_gb": 12.5 },
      "memory": { "status": "healthy", "used_mb": 256, "total_mb": 512 }
    },
    "checked_at": "2026-03-18T12:00:00Z"
  }
  ```
- Check frequency: on-demand (button click) + periodic (every 60s if page is open)

### Implementation Steps

1. Create `src/services/health.ts` with health check functions
2. Create `GET /api/health` endpoint
3. Create `<HealthCheck />` frontend component
4. Add to Dashboard page
5. Add periodic polling when component is mounted
6. Style with status indicator colors

### Files to Create
- `src/services/health.ts` — health check service
- `src/webui/routes/health.ts` — API route
- `web/src/components/HealthCheck.tsx` — UI component

### Files to Modify
- `web/src/pages/Dashboard.tsx` — add health check section
- `web/src/lib/api.ts` — add health API call

### Notes
- Medium complexity — each health check is simple, but there are many
- LLM API check: use a minimal prompt to test connectivity (or just test authentication)
- Telegram check: call `getMe()` bot API
- Don't block page render on health checks — load async
- Consider caching health results for 30s to avoid hammering external APIs
