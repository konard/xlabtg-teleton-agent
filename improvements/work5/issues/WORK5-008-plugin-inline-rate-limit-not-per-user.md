---
title: "[AUDIT/V5] Plugin inline/callback rate limiter is keyed per-plugin only, so one user can exhaust a plugin's limit for everyone"
labels: ["bug", "audit-finding-v5", "medium", "v3.0-blocker", "reliability"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-008"
severity: "medium"
category: "reliability"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/592"
---

## Problem Description

`PluginRateLimiter.check` keys its sliding window on `${pluginName}:${action}`
only — never on the requesting user. The inline-query/callback router invokes
plugin handlers for any Telegram user who interacts with the bot inline, and the
rate-limit bucket they all share is global per plugin+action. A single user
sending inline queries at the limit therefore consumes the entire window for
every other user, who then receive empty results / dropped callbacks until the
window clears. There is no per-user fairness or isolation, so the limiter behaves
as a denial-of-service amplifier rather than abuse protection.

## Location

- `src/bot/rate-limiter.ts:18-44` — `check(pluginName, action, limit, windowMs)`
  builds `const key = \`${pluginName}:${action}\`;` with no user dimension.
- `src/bot/inline-router.ts:138-185` — `handleInlineQuery` (and the callback
  path) run plugin handlers for `ctx.from.id` without per-user accounting.

## How To Reproduce

1. Register a plugin with an inline handler and a per-minute limit of N.
2. From user A, send N inline queries in a minute.
3. From user B, send one inline query — it is rate-limited even though B has made
   no prior requests.

## Impact

Any single user can lock out a plugin's inline/callback functionality for the
entire bot audience, a low-effort denial of service against multi-user
deployments. The shared bucket also makes per-user quotas impossible to express.

## Proposed Fix

- Include the user id in the rate-limit key (`${pluginName}:${action}:${userId}`)
  so limits are enforced per user, with an optional separate global ceiling.
- Bound and periodically prune the windows map (it grows with distinct keys);
  drop empty windows during `check`.

## Regression Test

```typescript
it("rate-limits per user, not globally per plugin", () => {
  const rl = new PluginRateLimiter();
  for (let i = 0; i < 5; i++) rl.check("p", "inline", 5, 60_000, "userA");
  expect(() => rl.check("p", "inline", 5, 60_000, "userB")).not.toThrow();
});
```

## Acceptance Criteria

- [ ] One user hitting the limit does not block other users.
- [ ] The windows map does not grow unbounded (empty windows pruned).

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-008`
- Module: `src/bot/rate-limiter.ts`, `src/bot/inline-router.ts`
