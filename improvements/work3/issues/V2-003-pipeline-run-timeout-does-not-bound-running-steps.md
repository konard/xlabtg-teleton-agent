---
title: "[AUDIT/V2] Pipeline run timeout does not bound already-running steps"
labels: ["bug", "audit-finding-v2", "high", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
audit-source: "#445"
finding-id: "V2-003"
severity: "high"
category: "performance"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/449"
---

## Problem Description

`PipelineDefinition.timeoutSeconds` is intended to cap the whole run. The
executor calculates a deadline, but checks it only before starting each
dependency level. Once a level starts, `Promise.all(...)` waits for every step
in that level. If a step has no explicit `step.timeoutSeconds` and its
`processMessage()` call never resolves, the pipeline-level timeout cannot fail
the run.

## Location

- `src/services/pipeline/executor.ts:117`
- `src/services/pipeline/executor.ts:125`
- `src/services/pipeline/executor.ts:136`
- `src/services/pipeline/executor.ts:281`

## How To Reproduce

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

Manual minimal scenario:

1. Create a pipeline with `timeoutSeconds: 1`.
2. Add one primary-agent step with no `step.timeoutSeconds`.
3. Use an `AgentRuntime.processMessage()` test double that never resolves.
4. Start the pipeline and advance timers beyond one second.
5. Observe that the run remains `running` instead of failing with the pipeline
   timeout.

## Impact

Operators can configure a run-level timeout and still get stuck pipeline runs.
Long-running or stalled LLM/tool work can block completion indefinitely and keep
pipeline state misleadingly active until manual cleanup.

## Proposed Fix

Apply remaining run budget to each step and to the level-level await:

```typescript
const remainingMs = deadline ? Math.max(0, deadline - Date.now()) : undefined;
const stepTimeoutSeconds =
  step.timeoutSeconds ?? (remainingMs ? Math.ceil(remainingMs / 1000) : undefined);

const outputValue = await this.withOptionalTimeout(
  this.dispatchStep(runId, step, action, context),
  stepTimeoutSeconds,
  `Pipeline step "${step.id}"`
);
```

Also check cancellation and timeout after each step settles, and mark pending
steps skipped when the deadline expires.

## Regression Test

```typescript
it("fails a hung step when only the pipeline run timeout is configured", async () => {
  vi.useFakeTimers();
  const processMessage = vi.fn(() => new Promise(() => undefined));
  const pipeline = store.create({
    name: "timeout",
    timeoutSeconds: 1,
    steps: [{ id: "slow", agent: "primary", action: "never returns", output: "out" }],
  });

  const promise = executor.execute(pipeline);
  await vi.advanceTimersByTimeAsync(1_500);
  const detail = await promise;

  expect(detail.run.status).toBe("failed");
  expect(detail.run.error).toContain("timed out");
});
```

## Acceptance Criteria

- [ ] `PipelineDefinition.timeoutSeconds` bounds total run duration even when
      individual steps do not define `timeoutSeconds`.
- [ ] A timed-out run marks running/pending steps as failed or skipped with a
      clear timeout reason.
- [ ] Cancellation is checked after long awaits settle and cannot be overwritten
      by late success.
- [ ] Regression tests cover hung primary-agent and managed-agent steps.

## Related Artifacts

- GitHub issue: https://github.com/xlabtg/teleton-agent/issues/449
- Report: `improvements/work3/AUDIT_V2_REPORT.md#v2-003---pipeline-run-timeout-does-not-bound-running-steps`
- Module: `src/services/pipeline/executor.ts`
- Related V2 spec: `improvements/v2-09-pipeline-execution.md`
