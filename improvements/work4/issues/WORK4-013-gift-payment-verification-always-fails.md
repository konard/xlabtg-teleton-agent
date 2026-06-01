---
title: "[AUDIT/V4] Gift-based payment verification can never match: compactGift omits sender (fromId) and mixes seconds/milliseconds"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "logic"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-013"
severity: "high"
category: "logic"
github-issue: ""
---

## Problem Description

Two independent defects make gift-based payment verification unreliable:

1. **Missing sender.** The `compactGift` object returned by `telegram_get_my_gifts`
   has no `fromId`/`sender` field. The verification consumers read a sender off
   the gift (`gift.fromId`), so the value is `undefined`; the buyer-match
   (`fromUserId === deal.user_telegram_id`, and `Number(g.fromId) === deal.userId`
   in the poller, where `Number(undefined)` is `NaN`) can never succeed.
2. **Unit mismatch.** `gift-detector` sets `receivedAt: gift.date || Date.now()`
   — `gift.date` is in **seconds** while `Date.now()` is in **milliseconds** —
   and `verify-payment` compares `g.receivedAt >= deal.created_at * 1000`
   (milliseconds). When `receivedAt` is the seconds value, the lower time-bound
   check is never satisfied.

## Location

- `src/agent/tools/telegram/gifts/get-my-gifts.ts:188-197` (`compactGift` has no
  `fromId`/`sender`)
- `src/deals/gift-detector.ts:62,64` (`fromUserId: gift.fromId ? Number(gift.fromId) : undefined`,
  `receivedAt: gift.date || Date.now()`)
- `src/agent/tools/deals/verify-payment.ts:187-188`
  (`g.fromUserId === deal.user_telegram_id` and
  `g.receivedAt >= deal.created_at * 1000`)
- `src/bot/services/verification-poller.ts:223`
  (`Number(g.fromId) === deal.userId`)

## How To Reproduce

1. Create a deal expecting a gift payment from a known buyer.
2. Have the buyer send the matching gift.
3. Run verification — it never matches, so the deal is never confirmed.

## Impact

Gift-settled deals can never be auto-verified: legitimate payments are not
recognized, blocking settlement. The unit bug also undermines any time-window
guard, weakening replay protection.

## Proposed Fix

- Populate `fromId` (and a normalized `sender`) in `compactGift`.
- Standardize all gift/deal timestamps to a single unit (ms) before comparison,
  with explicit conversion at the boundary.
- Add a verification test with a fixture gift + deal that must match.

## Regression Test

```typescript
it("verifies a deal when a matching gift arrives from the buyer", async () => {
  const deal = createDeal({ user_telegram_id: 123, created_at: now });
  const gift = { fromId: 123, receivedAt: now + 5000, amount: deal.amount };
  expect(verifyGiftPayment(deal, [gift]).verified).toBe(true);
  const wrongSender = { fromId: 999, receivedAt: now + 5000, amount: deal.amount };
  expect(verifyGiftPayment(deal, [wrongSender]).verified).toBe(false);
});
```

## Acceptance Criteria

- [ ] `compactGift` exposes the sender id used for buyer matching.
- [ ] Timestamps are compared in a single, documented unit.
- [ ] Test confirms a matching gift verifies the deal; a non-matching one does not.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-013`
- Module: `src/agent/tools/telegram/gifts/`, `src/deals/gift-detector.ts`,
  `src/agent/tools/deals/verify-payment.ts`,
  `src/bot/services/verification-poller.ts`
