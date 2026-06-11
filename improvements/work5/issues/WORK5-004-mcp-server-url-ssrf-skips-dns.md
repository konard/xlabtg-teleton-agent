---
title: "[AUDIT/V5] MCP server URL validation blocks only IP literals, never resolves DNS (SSRF via hostname → internal IP)"
labels: ["bug", "audit-finding-v5", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-004"
severity: "high"
category: "security"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/588"
---

## Problem Description

`validateMcpServerUrl` is the SSRF guard for remote (HTTP) MCP servers. It
rejects a small set of hostnames (`localhost`, `metadata`,
`metadata.google.internal`, `*.localhost`) and any private/loopback/link-local
**IP literal**. But when the host is a DNS name it is only string-matched against
that tiny denylist — `isBlockedMcpIp` calls `isIP(hostname)`, which returns `0`
for a domain, so the function returns `false` (not blocked). The hostname is
never resolved, and the IP actually connected to at request time is never
re-validated. Any attacker-controlled domain whose A record points at
`127.0.0.1`, an RFC1918 address, or `169.254.169.254` sails through, and DNS
rebinding defeats even a naive resolve-once check.

This is the MCP-loader analogue of the webhook DNS-rebinding gap (WORK4-008 /
#530) and the WebUI MCP route gap (WORK4-005 / #527), but it is a distinct code
path: this guard protects the MCP transport (`StreamableHTTPClientTransport`),
and closing #527/#530 does not close it.

## Location

- `src/config/mcp-security.ts:36-62` — `validateMcpServerUrl`; the IP checks only
  run for literal IPs (`isBlockedMcpIp` → `isIP(hostname)`), domains fall through
  to `return undefined` (allowed).
- Consumed where remote MCP servers are connected via the validated URL.

## How To Reproduce

1. Configure a remote MCP server with URL `https://rebind.example.com/mcp` whose
   A record resolves to `169.254.169.254` (or `127.0.0.1`).
2. Load MCP servers; validation passes and the transport connects to the
   internal address.

## Impact

A user who can set an MCP server URL can reach internal services and cloud
metadata endpoints from the agent host, exfiltrating credentials or pivoting —
the standard SSRF impact, with rebinding making a one-shot resolve insufficient.

## Proposed Fix

- Resolve the hostname (`dns.lookup` with `all: true`) and reject if **any**
  resolved address is private/loopback/link-local/metadata, reusing the existing
  `blockedIpRanges` BlockList.
- Pin the connection to the validated IP (custom `lookup`/agent) so the socket
  uses the address that was checked, closing the rebinding window.
- Share one guard implementation across MCP, webhooks (#530), and workflow
  call_api (#528) to avoid drift.

## Regression Test

```typescript
it("rejects an MCP URL whose hostname resolves to a private IP", async () => {
  mockDnsLookup("rebind.example.com", ["169.254.169.254"]);
  expect(await validateMcpServerUrl("https://rebind.example.com/mcp"))
    .toMatch(/private|metadata|not allowed/i);
});
```

## Acceptance Criteria

- [ ] Hostnames resolving to private/metadata IPs are rejected.
- [ ] The connected IP is the validated IP (rebinding-safe).

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-004`
- Module: `src/config/mcp-security.ts`
- Related: WORK4-005 / #527, WORK4-008 / #530, WORK4-006 / #528
