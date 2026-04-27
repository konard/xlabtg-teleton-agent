---
title: "[AUDIT/V2] Workflow call_api actions have no timeout"
labels: ["bug", "audit-finding-v2", "medium", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
audit-source: "#445"
finding-id: "V2-005"
severity: "medium"
category: "performance"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/451"
---

## Problem Description

Workflow `call_api` actions await raw `fetch(action.url, init)` with no
`AbortController`, `AbortSignal.timeout`, or per-action timeout. A slow or
never-responding endpoint can hang workflow execution indefinitely.

## Location

- `src/services/workflow-executor.ts:51`
- `src/services/workflow-executor.ts:59`
- `src/services/workflow-scheduler.ts`

## How To Reproduce

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

Manual unit scenario:

1. Create a workflow with one `call_api` action.
2. Stub global `fetch` to return a promise that never resolves.
3. Run `WorkflowExecutor.execute(workflow)`.
4. Observe that the executor never records `last_error` or `last_run_at`
   because it remains stuck awaiting `fetch()`.

## Impact

Webhook, event, and cron workflows can stall behind one unresponsive endpoint.
The scheduler awaits the executor, so a hung call can delay later actions and
leave the workflow with no terminal error state for operators to diagnose.

## Proposed Fix

Add a default timeout and optional action-level override:

```typescript
const timeoutMs = action.timeoutMs ?? DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try {
  const res = await fetch(action.url, { ...init, signal: controller.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${action.url}`);
} finally {
  clearTimeout(timer);
}
```

Consider reusing integration-layer HTTP execution for shared timeout, SSRF, and
credential handling instead of maintaining separate raw `fetch()` behavior.

## Regression Test

```typescript
it("records an error when a call_api action exceeds the default timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined))
  );

  const promise = executor.execute(workflowWithCallApi("https://example.com/slow"));
  await vi.advanceTimersByTimeAsync(DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS + 1);
  await promise;

  const updated = store.get(workflow.id)!;
  expect(updated.runCount).toBe(1);
  expect(updated.lastError).toContain("timed out");
});
```

## Acceptance Criteria

- [ ] `call_api` actions have a bounded default timeout.
- [ ] Optional per-action timeout configuration is validated.
- [ ] Timed-out calls record workflow errors and do not leave execution pending.
- [ ] Tests cover success, HTTP error, and timeout paths.

## Related Artifacts

- GitHub issue: https://github.com/xlabtg/teleton-agent/issues/451
- Report: `improvements/work3/AUDIT_V2_REPORT.md#v2-005---workflow-call_api-actions-have-no-timeout`
- Module: `src/services/workflow-executor.ts`
- Related V2 spec: `improvements/v2-16-webhooks-event-bus.md`
