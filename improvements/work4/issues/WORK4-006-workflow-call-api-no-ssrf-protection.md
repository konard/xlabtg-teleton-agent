---
title: "[AUDIT/V4] Workflow call_api action performs unrestricted server-side fetch (SSRF, reachable via unauthenticated webhook)"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-006"
severity: "high"
category: "security"
github-issue: ""
---

## Problem Description

The workflow `call_api` action issues `fetch(action.url, …)` directly with no
SSRF validation. The only URL check is `action.url.startsWith("http")` at
config time. Unlike `src/services/alerting.ts` and
`src/services/webhook-dispatcher.ts` (which block private / loopback /
link-local addresses), the workflow executor applies no protection. Worse, the
workflow can be fired through the **unauthenticated** public webhook endpoint
`POST /api/workflows/webhook/:secret`.

## Location

- `src/services/workflow-executor.ts:81` (`fetch(action.url, { …, signal })`)
- `src/webui/routes/workflows.ts:284` (only validation:
  `!action.url.startsWith("http")`)
- Trigger surface: `src/webui/middleware/public-ingress.ts` (auth + CSRF
  skipped for the webhook ingress path)

## How To Reproduce

1. Authenticate to WebUI. `POST /api/workflows` with
   `trigger.type: "webhook"` and an action
   `{ type: "call_api", method: "GET", url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }`.
2. Read the returned `trigger.secret`.
3. `POST /api/workflows/webhook/<secret>` (no auth/cookie/CSRF). The executor
   fetches the internal URL.

## Impact

An authenticated user can configure — and anyone who knows the webhook secret
can then trigger — server-side requests to internal-only endpoints
(`127.0.0.1`, RFC1918 hosts, cloud metadata `169.254.169.254`) with arbitrary
method/headers/body. The agent process becomes a proxy into the internal
network.

## Proposed Fix

- Apply an SSRF allow/deny check before fetching in `workflow-executor.ts`;
  extract and reuse the `validateWebhookUrl` logic.
- Resolve the hostname and re-validate the resolved IP (see WORK4-008), and
  reject non-permitted schemes.
- Validate at both `validateConfig` (create/update) and execution time.

## Regression Test

```typescript
it("blocks call_api requests to private/metadata addresses", async () => {
  const action = { type: "call_api", method: "GET", url: "http://169.254.169.254/" };
  await expect(executeAction(action, ctx)).rejects.toThrow(/blocked|ssrf|not allowed/i);
});
```

## Acceptance Criteria

- [ ] `call_api` rejects private / loopback / link-local / metadata targets.
- [ ] Validation runs at config time and execution time.
- [ ] Tests cover blocked-target rejection.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-006`
- Module: `src/services/workflow-executor.ts`
- Related: WORK4-007, WORK4-008
