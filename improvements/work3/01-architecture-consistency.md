# 01 - Architecture Consistency

## Scope

This report checks whether the V2 features share consistent ownership
boundaries: route exposure, configuration flow, task runtime handoff, and
feature-module contracts.

## Summary

Two architecture seams produced confirmed defects:

- V2 route factories are consistently mounted in the WebUI server, but the
  production Management API mount list did not evolve with the same contract.
  The detailed finding is [WORK3-H3](04-ui-api-parity.md#work3-h3-management-api-does-not-expose-most-v2-webui-routes).
- Agent-network ingress writes remote work into the generic scheduled-task
  table, but the executor for that table is Telegram-message driven. The
  detailed finding is [WORK3-H2](03-runtime-and-integrations.md#work3-h2-agent-network-ingress-creates-pending-tasks-that-never-execute).

No separate architecture-only defect was filed beyond those two concrete
runtime/API issues.

## Architecture Observations

### Route Ownership

`src/webui/server.ts` is now the complete V2 route registry for browser
features, while `src/api/server.ts` manually remounts only a subset under
`/v1`. This creates an avoidable drift point. Future V2 route additions should
declare whether the route is WebUI-only, Management API-supported, or an
internal browser helper.

### Task Ownership

The codebase has multiple task concepts:

- generic scheduled tasks in `src/memory/agent/tasks.ts`
- autonomous tasks in `src/memory/agent/autonomous-tasks.ts`
- delegation subtasks in `src/agent/delegation/*`
- remote network `task_request` messages in `src/services/network/*`

The generic scheduled-task executor in `src/index.ts` is activated by
Telegram messages with `[TASK:<id>]` prefixes. Network ingress should not rely
on that table unless it also schedules or dispatches the corresponding runtime
execution path.

### Configuration Flow

WebUI receives `networkConfig` from `src/index.ts`, but `ApiServerDeps` does
not carry the same field. That makes route parity fixes for agent network
impossible without first extending the API dependency adapter.

## Follow-up

Treat route parity as a code-level contract. A low-maintenance guard would be a
test that compares route group names and requires explicit allowlisting for
WebUI-only groups.
