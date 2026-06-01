---
title: "[AUDIT/V4] Autonomous task with no maxIterations/maxDurationHours relies solely on LLM self-report for completion"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "logic"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-012"
severity: "medium"
category: "logic"
github-issue: ""
---

## Problem Description

When `successCriteria` is non-empty, `evaluateSuccess` always returns `false`,
so the only completion path is `reflection.goalAchieved` from the self-reflect
LLM call (which defaults to `false` on any parse error). An unconstrained task
whose reflection never returns `goalAchieved: true` runs until the global cap
(`MAX_GLOBAL_ITERATIONS = 500`).

## Location

- `src/autonomous/manager.ts:325-329` (`evaluateSuccess` returns `false` whenever
  `successCriteria` is non-empty)
- `src/autonomous/loop.ts:487` (`reflection.goalAchieved || evaluateSuccess(...)`)
- `src/autonomous/manager.ts:360,366` (`goalAchieved: parsed.goalAchieved ?? false`,
  and the `catch` fallback returns no `goalAchieved` — i.e. `false` — on parse
  error)
- `src/autonomous/goal-parser.ts:96-97` (`maxIterations` only clamped
  `Math.max(1, ...)` *when present*; absent → `undefined`, no enforced default —
  the "default 50" at `:38` is only an LLM prompt hint, not deterministic)
- `src/autonomous/loop.ts:24` (`MAX_GLOBAL_ITERATIONS = 500` — the only hard cap)

## How To Reproduce

1. Start a task with `successCriteria: ["..."]` and a goal the agent cannot
   finish.
2. Reflection returns `goalAchieved: false` each turn.
3. The loop iterates to 500 (~1000 LLM calls + 500 tool calls) before failing.

## Impact

The global cap prevents infinite loops, but the cost ceiling is very high for
tasks that omit explicit `maxIterations`. A misbehaving / unsatisfiable task
can burn ~1000 LLM calls before stopping.

## Proposed Fix

- Apply a sane default `maxIterations` (e.g. 50) when constraints omit it,
  and/or implement deterministic success-criteria evaluation instead of always
  returning `false`.

## Regression Test

```typescript
it("applies a default iteration cap when constraints omit maxIterations", () => {
  const constraints = parseConstraints({ goal: "do X" }); // no maxIterations
  expect(constraints.maxIterations).toBeGreaterThan(0);
  expect(constraints.maxIterations).toBeLessThan(500);
});
```

## Acceptance Criteria

- [ ] Unconstrained tasks have a sane default iteration ceiling well below 500.
- [ ] Tests cover the default-cap path.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-012`
- Module: `src/autonomous/manager.ts`, `src/autonomous/loop.ts`
