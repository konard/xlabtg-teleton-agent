---
title: "[AUDIT/V2] Public V2 webhook ingress is blocked by WebUI auth and CSRF"
labels: ["bug", "audit-finding-v2", "high", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
audit-source: "#445"
finding-id: "V2-001"
severity: "high"
category: "integration"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/447"
---

## Problem Description

The V2 webhook and workflow webhook ingress routes advertise their own
authentication model: workflow webhooks use a secret token in the URL, and
external webhooks use `X-Webhook-Signature`. In the real WebUI server these
routes are mounted under `/api/*`, so the global WebUI CSRF middleware and auth
middleware run before the route handlers.

Only `/api/agent-network` is bypassed. As a result, valid external webhook calls
cannot reach the route-level secret/signature verification.

## Location

- `src/webui/server.ts:180`
- `src/webui/server.ts:213`
- `src/webui/server.ts:321`
- `src/webui/server.ts:324`
- `src/webui/routes/workflows.ts:192`
- `src/webui/routes/webhooks.ts:72`

## How To Reproduce

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

Manual route-level reproduction:

1. Start WebUI with V2 webhooks enabled.
2. Create an active webhook registration with a secret, or create a workflow
   with `trigger.type = "webhook"`.
3. POST a correctly signed request to `/api/webhooks/incoming/:id`, or POST to
   `/api/workflows/webhook/:secret`, without WebUI session cookies.
4. Observe that the global middleware returns 401 or 403 before the route-level
   verifier handles the request.

## Impact

External providers cannot trigger configured V2 webhooks or workflow webhooks.
Operators can configure apparently valid webhook automation that will never run
in production unless callers also possess a browser/API session and CSRF token,
which is incompatible with normal provider webhook delivery.

## Proposed Fix

```typescript
// Sketch: keep browser API protection, but explicitly exempt signed/public ingress.
const PUBLIC_SIGNED_API_PATHS = [
  /^\/api\/agent-network$/,
  /^\/api\/webhooks\/incoming\/[^/]+$/,
  /^\/api\/workflows\/webhook\/[^/]+$/,
];

function isPublicSignedIngress(path: string): boolean {
  return PUBLIC_SIGNED_API_PATHS.some((pattern) => pattern.test(path));
}

// Use isPublicSignedIngress() in both CSRF and WebUI auth middleware.
```

Add route tests proving:

- signed webhook ingress works without WebUI cookie auth;
- workflow secret ingress works without WebUI cookie auth;
- normal mutating `/api/*` routes still require auth and CSRF;
- invalid webhook signatures/secrets are still rejected.

## Regression Test

```typescript
it("allows signed incoming webhooks through WebUI auth and CSRF middleware", async () => {
  const app = buildFullWebUiAppWithAuthAndCsrf();
  const { id, secret } = createWebhookFixture(app.db);
  const raw = JSON.stringify({ type: "external.test" });
  const signature = hmac(secret, raw);

  const res = await app.request(`/api/webhooks/incoming/${id}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature,
    },
  });

  expect(res.status).toBe(202);
});
```

## Acceptance Criteria

- [ ] `/api/webhooks/incoming/:id` reaches signature verification without WebUI
      session cookies.
- [ ] `/api/workflows/webhook/:secret` reaches secret verification without
      WebUI session cookies.
- [ ] Invalid signatures and secrets remain rejected.
- [ ] Browser/API mutating routes remain protected by auth and CSRF.
- [ ] Regression tests cover both public ingress paths and one protected
      negative control.

## Related Artifacts

- GitHub issue: https://github.com/xlabtg/teleton-agent/issues/447
- Report: `improvements/work3/AUDIT_V2_REPORT.md#v2-001---public-v2-webhook-ingress-is-blocked-by-webui-auth-and-csrf`
- Module: `src/webui/server.ts`
- Previous audits checked agent-network signed ingress in #400-#402; this
  finding covers different V2 webhook routes.
