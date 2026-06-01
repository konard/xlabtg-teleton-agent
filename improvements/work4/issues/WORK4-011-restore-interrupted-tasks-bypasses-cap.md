---
title: "[AUDIT/V4] restoreInterruptedTasks bypasses maxParallelTasks and can exceed the concurrency cap after a crash"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "reliability"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-011"
severity: "medium"
category: "reliability"
github-issue: ""
---

## Problem Description

`startTask` gates on `runningLoops.size >= maxParallelTasks`, but the restore
path calls `runLoop` unconditionally for every `running` and `pending` task.
Only `queued` tasks respect the slot loop. After a crash with more than
`maxParallelTasks` active tasks, restart starts them all concurrently.

## Location

- `src/autonomous/manager.ts:192-234` (`restoreInterruptedTasks`)
- `src/autonomous/manager.ts:72` (`startTask` concurrency gate, not applied on
  restore)

## How To Reproduce

1. Persist 15 `running` autonomous tasks with `maxParallelTasks = 10`.
2. Restart the agent and call `restoreInterruptedTasks()`.
3. `getRunningTaskIds().length === 15`.

## Impact

The concurrency limit is defeated after a restart; each restored loop does
2 LLM calls + 1 tool call per iteration, causing a resource/cost spike and
provider rate-limit pressure.

## Proposed Fix

- Restore into the queue and drain through the existing slot loop: push
  `running`/`pending` tasks to `taskQueue`, or only `runLoop` while
  `runningLoops.size < maxParallelTasks`.

## Regression Test

```typescript
it("respects maxParallelTasks when restoring interrupted tasks", async () => {
  const mgr = createManager({ maxParallelTasks: 10 });
  for (let i = 0; i < 15; i++) persistRunningTask(db, `t${i}`);
  await mgr.restoreInterruptedTasks();
  expect(mgr.getRunningTaskIds().length).toBeLessThanOrEqual(10);
});
```

## Acceptance Criteria

- [ ] After restore, concurrent loops never exceed `maxParallelTasks`.
- [ ] Test restores N > cap tasks and asserts the cap holds.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-011`
- Module: `src/autonomous/manager.ts`
