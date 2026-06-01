---
title: "[AUDIT/V4] Outbound webhook SSRF guard validates only literal IPs/hostnames, never the resolved address (DNS-rebinding bypass)"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-008"
severity: "medium"
category: "security"
github-issue: ""
---

## Problem Description

`validateWebhookUrl` blocks private/loopback IP literals, but when the host is
a DNS name it only string-matches a tiny loopback denylist. It never resolves
the hostname, so the private-IP checks are bypassed for any attacker-controlled
domain, and there is no re-validation of the IP actually connected to at fetch
time (DNS rebinding).

## Location

- `src/services/alerting.ts:64-93` (esp. `:87-92`, hostname branch only checks
  `localhost`/`.localhost`/`local`)
- Used by `src/services/webhook-dispatcher.ts:244,292,429` and alerting webhook
  config.

## How To Reproduce

1. Configure a webhook / alert URL `https://rebind.example.com/...` whose A
   record resolves to `169.254.169.254` (or `127.0.0.1` / an RFC1918 address).
2. Trigger an alert / delivery; the request reaches the internal target.

## Impact

An authenticated user (or anyone who can set the alerting webhook URL or
register an outbound webhook) can reach internal services and cloud metadata
via a hostname that resolves to a private address — and DNS rebinding defeats a
naive resolve-once check.

## Proposed Fix

- Resolve the hostname (`dns.lookup` with `all: true`), reject if **any**
  resolved address is private / loopback / link-local / metadata.
- Pin the connection to the validated IP (custom `lookup`/agent) so the address
  used for the socket is the one validated, closing the rebinding window.
- Apply the same guard to the workflow executor (WORK4-006).

## Regression Test

```typescript
it("rejects hostnames that resolve to private/metadata IPs", async () => {
  mockDnsLookup("rebind.example.com", ["169.254.169.254"]);
  await expect(validateWebhookUrl("https://rebind.example.com/x"))
    .rejects.toThrow(/blocked|private|not allowed/i);
});
```

## Acceptance Criteria

- [ ] Hostnames resolving to private/metadata IPs are rejected.
- [ ] The connected IP is the validated IP (rebinding-safe).

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-008`
- Module: `src/services/alerting.ts`, `src/services/webhook-dispatcher.ts`
- Related: WORK4-006
