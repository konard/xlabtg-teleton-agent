---
title: "[AUDIT/V4] Pipeline step timeout/cancellation does not stop a \"primary\" agent run (and orphaned step can overwrite a failed run)"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "reliability"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-010"
severity: "high"
category: "reliability"
github-issue: ""
---

## Problem Description

`withStepControls` builds an `AbortController` and races a timeout/cancellation
promise, but for a step dispatched to the **primary** agent the controller is
never handed to `processMessage` (which takes no `AbortSignal`/timeout). The
timeout/cancel only rejects the race wrapper; the underlying agentic run keeps
executing detached. The orphaned `processMessage` may then call
`updateStep(..., "completed")` on an already-failed/cancelled run.

## Location

- `src/services/pipeline/executor.ts:316-327` (primary branch ignores
  `options.signal`/`timeoutSeconds`)
- `src/services/pipeline/executor.ts:444-495` (`withStepControls`)
- `src/services/pipeline/executor.ts:256-262` (`updateStep` to `"completed"`
  with no run-status guard)
- Contrast `:360-364` (managed-agent branch forwards `signal`/`timeoutSeconds`
  to `waitForMessageResult`)

## How To Reproduce

1. Define a 1-step pipeline with `agent: "primary"`, `timeoutSeconds: 1`, and
   an action that makes the agent run several slow tool calls (> 1s total).
2. Observe the run is marked timed-out at ~1s while the agent continues issuing
   tool calls afterward (visible in the audit log / tool side effects), and a
   late `updateStep` can flip the step back to `completed`.

## Impact

A pipeline step (or whole run) declared `timeout`/`cancelled` does not stop the
primary agent, which can keep executing tools — including financial tools like
`ton_send` — after the run is marked failed. Wasted tokens, runaway cost, side
effects after a user cancel, and inconsistent run records (failed run with
`completed` steps written after `completedAt`).

## Proposed Fix

- Thread an `AbortSignal` through `ProcessMessageOptions` and honor it inside
  the agentic `while` loop in `runtime.ts` (break when `signal.aborted`); pass
  `controller.signal` from `withStepControls` into the primary
  `processMessage` call.
- Make `updateStep`/`updateRun` a no-op when the run is already in a terminal
  status.

## Regression Test

```typescript
it("aborts the primary agent loop when a step times out", async () => {
  let toolCallsAfterTimeout = 0;
  const run = await runPipeline({
    steps: [{ agent: "primary", timeoutSeconds: 1, action: slowToolLoop(() => toolCallsAfterTimeout++) }],
  });
  await delay(2000);
  expect(run.status).toBe("timeout");
  expect(toolCallsAfterTimeout).toBe(0); // no tool calls after the abort
});
```

## Acceptance Criteria

- [ ] A timed-out/cancelled primary-agent step actually stops the agentic loop.
- [ ] Step/run writes are rejected after a run reaches a terminal status.
- [ ] Tests cover primary-agent timeout cancellation.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-010`
- Module: `src/services/pipeline/executor.ts`, `src/agent/runtime.ts`
