---
title: "[AUDIT/V5] Agent runtime retry backoff sleeps are not abort-interruptible, and iteration accounting differs across error classes"
labels: ["bug", "audit-finding-v5", "medium", "v3.0-blocker", "reliability"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-007"
severity: "medium"
category: "reliability"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/591"
---

## Problem Description

The agent runtime retries provider failures (rate-limit, 5xx/overloaded, network,
empty response) with exponential backoff implemented as a bare
`await new Promise((r) => setTimeout(r, delay))`. None of these waits race the
run's abort/cancel signal, so a user (or a shutdown / timeout) that cancels the
run during a multi-second backoff — up to `RATE_LIMIT_MAX_BACKOFF_MS` — cannot
interrupt it; the process keeps the turn alive until the timer fires.

Separately, the retry paths handle the iteration budget inconsistently: the
server-error, network-error, and empty-response paths do `iteration--` before
`continue` (so the retry does not consume a loop iteration), while the
rate-limit path does **not**. The effective number of model calls under
sustained errors therefore depends on which error class is hit, which makes the
`maxIterations` bound non-uniform and hard to reason about.

## Location

- `src/agent/runtime.ts:1035` (rate-limit), `:1057` (server error, with
  `iteration--` at `:1058`), `:1072` (network, `iteration--` at `:1073`),
  `:1107` (empty response, `iteration--` at `:1108`) — each
  `await new Promise((r) => setTimeout(r, delay))` with no signal race.
- The rate-limit branch (`:1022-1037`) has no `iteration--`, unlike the others.

## How To Reproduce

1. Make the provider return `429` so the runtime enters a long backoff.
2. Abort the run during the wait.
3. Observe the run does not return until the full backoff elapses.

## Impact

Cancellation and graceful shutdown are delayed by up to the maximum backoff,
holding resources and worsening responsiveness under provider degradation. The
inconsistent `iteration--` makes the iteration cap behave differently per error
class, complicating budget guarantees.

## Proposed Fix

- Replace the raw timeouts with an abortable sleep that rejects/returns on the
  run's `AbortSignal` (`Promise.race([timer, abortPromise])`), and clear the
  timer on abort.
- Make iteration accounting uniform across retry classes (decide once whether a
  transport retry consumes an iteration and apply it everywhere).

## Regression Test

```typescript
it("aborts immediately during a retry backoff", async () => {
  const controller = new AbortController();
  const p = runtime.run(input, { signal: controller.signal });
  queueRateLimitThenAbort(controller); // 429, then abort during backoff
  await expect(p).rejects.toThrow(/abort/i);
});
```

## Acceptance Criteria

- [ ] Aborting during a backoff returns promptly, not after the full delay.
- [ ] Retry iteration accounting is consistent across all error classes.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-007`
- Module: `src/agent/runtime.ts`
