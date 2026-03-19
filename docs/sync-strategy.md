# Fork Synchronization Strategy

## Overview

This document describes the strategy for keeping `xlabtg/teleton-agent` in sync with the upstream
`TONresistor/teleton-agent` repository while preserving all fork-specific features.

## Repository Relationship

| Repository | Role | Commits ahead |
|---|---|---|
| `TONresistor/teleton-agent` | True upstream (original) | Source of core improvements |
| `xlabtg/teleton-agent` | Fork | +175 commits (WebUI, analytics, dashboard, etc.) |

As of 2026-03-19, the fork is **9 commits behind** TONresistor upstream.

## Conflict Resolution Rules

### Always prefer TONresistor (upstream) for:
- Core agent runtime (`src/agent/runtime.ts`) — async/concurrency, robustness
- Security fixes — auth, exec scope, data retention
- Bug fixes in low-level infrastructure
- Dependency version bumps (prefer stable over alpha)
- CLI/startup logic

### Always prefer fork (`xlabtg`) for:
- WebUI (`web/`) — dashboard, analytics, sessions, security center
- `improvements/` directory — feature documentation
- Services (`src/services/`) — MetricsService, AnalyticsService
- All fork-specific pages/components not present in upstream

### Manual review required (hybrid merge):
- `src/agent/runtime.ts` — adopt upstream concurrency fixes but keep fork's metrics calls
- `src/agent/token-usage.ts` — keep fork's analytics integration
- `src/agent/hooks/user-hook-evaluator.ts` — keep fork's `evaluateWithTrace()` for HookTestPanel
- `.github/workflows/ci.yml` — keep fork's 4-job parallel CI structure

## Changes Merged in This Sync (2026-03-19)

The following TONresistor upstream changes were integrated:

### Security fix: exec `allowlist` scope (`src/agent/tools/exec/module.ts`)
- **Before**: `allowlist` fell through to `"always"` scope (too permissive)
- **After**: `allowlist` correctly maps to `"admin-only"` scope
- **Source commit**: `494b06f fix: security hardening, robustness guards, data retention`

### Plugin timeout safety (`src/agent/tools/plugin-watcher.ts`)
- Added `PLUGIN_START_TIMEOUT_MS = 30_000` and `PLUGIN_STOP_TIMEOUT_MS = 30_000` constants
- All `plugin.stop?.()` and `plugin.start?.()` calls are now wrapped in `Promise.race` with these
  timeouts to prevent indefinitely hanging plugins from blocking the agent
- **Source commit**: `2e47cd0 fix: robustness, async IO, concurrency limit`

### Async/concurrency improvements (`src/agent/runtime.ts`)
- `session:start` hook now fires concurrently (non-blocking) instead of `await`-blocking
- Embedding computation starts concurrently, awaited together with `session:start` via `Promise.all`
- `tool:error` and `tool:after` observing hooks now fire concurrently and are awaited together
  with `Promise.allSettled` after the loop, reducing per-tool-call hook overhead
- Additional server error patterns for retry: `overloaded`, `Internal server error`, `api_error`
- Rate-limit retry no longer decrements `iteration` (prevents double-counting)
- Fork's `getMetrics()?.recordToolCall()` and `getAnalytics()?.recordRequestMetric()` calls are
  preserved
- **Source commit**: `2e47cd0 fix: robustness, async IO, concurrency limit`

### Dependency version bumps (`package.json`)
- `@mariozechner/pi-ai`: `^0.58.1` → `^0.58.4`
- `@modelcontextprotocol/sdk`: `^1.26.0` → `^1.27.1`
- `@tavily/core`: `^0.7.1` → `^0.7.2`
- `better-sqlite3`: `^12.6.2` → `^12.8.0`
- `hono`: `^4.11.9` → `^4.12.8`
- `sqlite-vec`: `^0.1.7-alpha.2` → `^0.1.7` (stable release)
- **Note**: TypeScript and ESLint versions were NOT downgraded (upstream regressed these)
- **Source commits**: `bfff26d feat: agent perf, heartbeat fix, WebUI redesign, dep bumps`

### CLI update checker (`src/cli/update-check.ts`)
- New module that checks npm registry for newer versions of teleton once every 24 hours
- Skips check in Docker and dev/git-clone environments
- Shows a banner and optionally runs `npm i -g teleton@latest` if user confirms
- Not yet wired into startup (upstream reverted this as premature in `1dc7681`)
- **Source commit**: `c58aff6 feat(cli): add npm update checker`

## How to Perform Future Syncs

```bash
# Add TONresistor as a remote (first time only)
git remote add tonresistor https://github.com/TONresistor/teleton-agent.git
git fetch tonresistor

# See what's new in upstream
git log HEAD..tonresistor/main --oneline

# See which files differ
git diff --name-only HEAD tonresistor/main

# Cherry-pick specific commits (preferred over merge/rebase for selective adoption)
git cherry-pick <commit-sha>

# Or for a full controlled rebase (advanced — requires careful conflict resolution):
git fetch tonresistor
git rebase tonresistor/main
# Resolve conflicts using the rules in the "Conflict Resolution Rules" section above
```

## Architecture Direction

The fork is moving toward a `core (upstream) + extensions (fork)` model:

- **Core** (`src/agent/`, `src/config/`, `src/session/`, `src/memory/`) — track upstream closely
- **Extensions** (`src/services/`, `web/src/pages/Analytics*`, `web/src/pages/Security*`,
  `web/src/pages/Sessions*`) — fork-owned, not in upstream
- **Shared** (`web/src/components/`, `.github/workflows/`) — merge carefully, resolve per above rules
