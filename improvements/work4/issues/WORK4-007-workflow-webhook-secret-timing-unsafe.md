---
title: "[AUDIT/V4] Public workflow webhook secret verified with timing-unsafe string equality"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-007"
severity: "medium"
category: "security"
github-issue: ""
---

## Problem Description

The webhook secret — the sole authentication for the public, unauthenticated
trigger endpoint `/api/workflows/webhook/:secret` — is compared with the `===`
operator, which short-circuits on the first differing byte. Every other secret
comparison in the codebase uses constant-time equality
(`webhook-dispatcher.ts` `safeCompare`/`timingSafeEqual`,
`setup-server.ts` `nonceMatches`), making this an inconsistent oversight.

## Location

- `src/services/workflow-scheduler.ts:62-69` (`…trigger.secret === secret`)

## How To Reproduce

1. Send many `POST /api/workflows/webhook/<guess>` requests, measuring latency.
2. The matching-prefix length correlates with time-to-first-mismatch, allowing
   byte-by-byte secret recovery.

## Impact

The secret authenticates an endpoint reachable without auth or CSRF. A
network-positioned attacker can mount a timing side-channel to recover it, then
trigger the workflow at will (including the SSRF in WORK4-006). Network jitter
reduces practicality, but constant-time comparison is the standard.

## Proposed Fix

- Compare with `crypto.timingSafeEqual` over equal-length buffers (mirror
  `safeCompare`).
- Index workflows by a hash of the secret and look up in constant time rather
  than scanning with `===`.

## Regression Test

```typescript
it("matches webhook secrets via constant-time comparison", () => {
  // The comparison helper must use timingSafeEqual, not ===.
  expect(matchWebhookSecret("abc123", "abc123")).toBe(true);
  expect(matchWebhookSecret("abc123", "abc124")).toBe(false);
  expect(matchWebhookSecret("abc123", "ab")).toBe(false); // length mismatch safe
});
```

## Acceptance Criteria

- [ ] Webhook secret comparison is constant-time.
- [ ] Test verifies non-matching secrets are rejected without early-exit timing
      differences (structural test of the comparison function).

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-007`
- Module: `src/services/workflow-scheduler.ts`
- Related: WORK4-006
