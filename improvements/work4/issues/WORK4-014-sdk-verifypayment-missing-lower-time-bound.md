---
title: "[AUDIT/V4] Plugin SDK ton.verifyPayment has no lower time bound — old transactions can satisfy new payment requests (replay)"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "financial"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-014"
severity: "medium"
category: "financial"
github-issue: ""
---

## Problem Description

The Plugin SDK's `ton.verifyPayment` only enforces an **upper** age bound
(`tx.secondsAgo > maxAgeMinutes * 60` rejects very old txs) but accepts any
transaction newer than that window. There is no `requestTime`/`since` lower
bound tying the transaction to the moment the payment was requested. The core
verifier does this (`if (txTime < requestTime) continue`); the SDK path does
not, so a prior unrelated payment of the right amount, made *before* the deal
existed, can satisfy a new request (the `used_transactions` table only prevents
re-consuming the *same* transaction twice, not a pre-existing one).

## Location

- `src/sdk/ton.ts:198-247` (esp. `:242` `if (tx.secondsAgo > maxAgeMinutes * 60)
  continue;` — upper bound only, no lower bound)
- Contrast core: `src/ton/payment-verifier.ts:98`
  (`if (txTime < requestTime) continue`)

## How To Reproduce

1. A user previously sent the exact required amount to the receiving address.
2. A plugin calls `ton.verifyPayment` for a new deal of the same amount.
3. The old transaction (within `maxAge`) is accepted as payment for the new deal.

## Impact

Plugins relying on the SDK verifier can be tricked into accepting a stale/replayed
payment, enabling double-spend of a single on-chain transfer across multiple
deals — a direct financial risk.

## Proposed Fix

- Add a required `since`/`requestTime` parameter (or derive from the deal/request
  creation time) and reject transactions older than it, matching the core
  verifier semantics.

## Regression Test

```typescript
it("rejects transactions older than the request time", async () => {
  const requestTime = now;
  const oldTx = { utime: now - 60, value: amount, dest: address }; // before request, within maxAge
  mockTransactions([oldTx]);
  const res = await sdk.ton.verifyPayment({ address, amount, since: requestTime });
  expect(res.verified).toBe(false);
});
```

## Acceptance Criteria

- [ ] SDK `verifyPayment` rejects transactions earlier than the request time.
- [ ] Test covers an old-but-within-maxAge transaction being rejected.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-014`
- Module: `src/sdk/ton.ts`, `src/ton/payment-verifier.ts`
- Related: WORK4-013
