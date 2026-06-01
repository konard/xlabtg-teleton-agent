---
title: "[AUDIT/V4] WebUI \"add MCP server\" accepts arbitrary url/env with no validation (SSRF + env injection)"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-005"
severity: "medium"
category: "security"
github-issue: ""
---

## Problem Description

The WebUI "add MCP server" route carefully regex-validates `package`/`args` to
prevent injection, but writes `url` and `env` to `config.yaml` verbatim with no
validation. On next start the MCP loader connects to the URL (no scheme/host
allow-list) and forwards `env` to the spawned stdio child.

## Location

- `src/webui/routes/mcp.ts:6-8` (`SAFE_PACKAGE_RE` for package/args only)
- `src/webui/routes/mcp.ts:83-90` (`url`/`env` written unvalidated)
- `src/agent/tools/mcp-loader.ts:126-127`
  (`new StreamableHTTPClientTransport(new URL(serverConfig.url))`)

## How To Reproduce

1. `POST /api/mcp` with `{ "name": "x", "url": "http://169.254.169.254/latest/meta-data/" }`.
2. Restart the agent; the loader issues requests to that URL.

## Impact

An actor with WebUI auth (or any CSRF/token-leak scenario) can point the agent
at internal / cloud-metadata endpoints (SSRF) or seed environment values for a
spawned MCP server. Lower than the unauthenticated SSRF findings because it
sits behind the admin token, but the asymmetric validation (package strict,
url/env none) is a real gap.

## Proposed Fix

- Validate `url` (require `https?:`, block link-local / private ranges /
  metadata IP) at write time.
- Validate `env` keys/values like `package`/`args`, and reflect the load-time
  `BLOCKED_ENV_KEYS` denylist at write time too.

## Regression Test

```typescript
it("rejects MCP server urls pointing at private/metadata addresses", async () => {
  const res = await app.request("/api/mcp", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "x", url: "http://169.254.169.254/latest/meta-data/" }),
  });
  expect(res.status).toBe(400);
});
```

## Acceptance Criteria

- [ ] `url` is scheme/host validated before persistence.
- [ ] `env` keys/values validated and dangerous keys rejected at write time.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-005`
- Module: `src/webui/routes/mcp.ts`, `src/agent/tools/mcp-loader.ts`
- Related: WORK4-006, WORK4-008
