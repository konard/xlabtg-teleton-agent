---
title: "[AUDIT/V4] memory getStats unconditionally recalculates all scores (O(N) + O(N·M) centrality) on every call"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "performance"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-017"
severity: "medium"
category: "performance"
github-issue: ""
---

## Problem Description

`getStats` calls `recalculateAll` every time it runs. `recalculateAll` rescores
every memory and recomputes graph centrality, which is O(N) over memories plus
an O(N·M) centrality pass. A read-only stats call therefore triggers a full,
potentially expensive recomputation rather than reading already-persisted scores.

## Location

- `src/memory/scoring.ts:335-341` (`getStats` → `recalculateAll`)
- `src/memory/scoring.ts:475-485` (centrality pass, O(N·M))

## How To Reproduce

1. Populate a large memory graph (many nodes/edges).
2. Call the stats endpoint / `getStats` repeatedly (e.g. dashboard polling).
3. Observe full recompute and latency growth proportional to graph size on each
   call.

## Impact

Stats/dashboard reads scale poorly with memory size and can dominate CPU under
periodic polling, degrading the whole agent under load.

## Proposed Fix

- Have `getStats` read existing persisted scores; move `recalculateAll` to a
  scheduled/explicit refresh (or cache results with a TTL / dirty flag).

## Regression Test

```typescript
it("does not recalculate all scores on getStats", () => {
  const spy = vi.spyOn(scoring, "recalculateAll");
  scoring.getStats();
  expect(spy).not.toHaveBeenCalled();
});
```

## Acceptance Criteria

- [ ] `getStats` is O(1)/O(N read) and does not trigger centrality recompute.
- [ ] Recalculation runs on a schedule or on explicit demand.
- [ ] Test asserts `getStats` does not call `recalculateAll`.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-017`
- Module: `src/memory/scoring.ts`
