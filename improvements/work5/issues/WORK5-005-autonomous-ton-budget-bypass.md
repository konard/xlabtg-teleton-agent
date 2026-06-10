---
title: "[AUDIT/V5] Autonomous TON budget & confirmation gates rely on a self-reported tonAmount decoupled from the actual tool params"
labels: ["bug", "audit-finding-v5", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-005"
severity: "medium"
category: "security"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/589"
---

## Problem Description

The autonomous policy engine enforces the per-task TON budget and the
"require confirmation above X" gate by inspecting `action.tonAmount`:

```ts
if (action.tonAmount !== undefined && action.tonAmount > 0) {
  const budgetTON = constraints.budgetTON ?? this.config.tonSpending.perTask;
  if (action.tonAmount > budgetTON) { /* block */ }
  if (action.tonAmount > this.config.tonSpending.requireConfirmationAbove) { /* confirm */ }
}
```

But `tonAmount` is a separate, optional field that the planner attaches to the
action — it is the model's self-declared estimate, not derived from the tool
call's actual parameters. The planner (`planTool`) returns `{toolName, params,
reasoning, confidence}` and `tonAmount` is carried alongside (`loop.ts:55,320`).
Nothing reconciles `tonAmount` with the value the tool will actually move. So an
action that sends TON through `params` while leaving `tonAmount` `undefined` or
`0` skips the budget check **and** the confirmation gate entirely — the guarded
block never runs.

This compounds WORK4-012 / #534 (autonomous completion relies on LLM
self-report): here the *spending* control, not just the stop control, trusts an
unverified self-report.

## Location

- `src/autonomous/policy-engine.ts:205-223` — budget + confirmation gated on
  `action.tonAmount`.
- `src/autonomous/loop.ts:55` (`tonAmount?: number` on the action) and `:320`
  (`tonAmount: action.tonAmount`) — the value is passed through, not computed.

## How To Reproduce

1. Set a task with `budgetTON: 0.5` and `requireConfirmationAbove: 0.1`.
2. Have the planner emit an action that calls a TON-spending tool with a
   send amount of `5` in `params`, but with `tonAmount` omitted (or `0`).
3. `checkAction` returns allow with no confirmation — the spend proceeds
   unbounded.

## Impact

The on-chain spending guardrails for autonomous mode can be bypassed by any plan
whose declared `tonAmount` does not match what the tool actually transfers,
draining funds beyond the configured budget and skipping user confirmation.
`NaN`/negative declared amounts also slip past `> 0`.

## Proposed Fix

- Derive the spend amount from the actual tool + params (a per-tool extractor /
  cost function) rather than trusting `action.tonAmount`; fail closed when the
  amount for a known spending tool cannot be determined.
- Validate `tonAmount` is a finite, non-negative number when present and require
  it for any tool classified as value-moving.
- Re-check the budget/confirmation against the real amount immediately before
  execution, not only at plan time.

## Regression Test

```typescript
it("blocks a TON-spending tool whose declared tonAmount is omitted", () => {
  const task = makeTask({ constraints: { budgetTON: 0.5 } });
  const result = engine.checkAction(task, { toolName: "ton_send", params: { amount: 5 } });
  expect(result.allowed).toBe(false);
});
```

## Acceptance Criteria

- [ ] Spending checks use the real tool amount, not a self-reported field.
- [ ] A value-moving action with missing/invalid `tonAmount` is denied or
      forced through confirmation.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-005`
- Module: `src/autonomous/policy-engine.ts`, `src/autonomous/loop.ts`
- Related: WORK4-012 / #534
