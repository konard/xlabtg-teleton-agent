---
title: "[AUDIT/V4] POST /api/export/import merges arbitrary config keys outside the CONFIGURABLE_KEYS allowlist (privilege/security-flag tampering)"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-009"
severity: "high"
category: "security"
github-issue: ""
---

## Problem Description

Single-key config writes go through the vetted `CONFIGURABLE_KEYS` whitelist,
but the bulk **import** endpoint does a shallow spread
`{ ...existing, ...bundle.config }` and writes the result. The only protection
is restoring 7 hard-coded `SENSITIVE_KEYS` (API/bot tokens). Security-relevant
flags are not protected.

## Location

- `src/webui/routes/export-import.ts:140-163` (shallow merge + write)
- `src/webui/routes/export-import.ts:191-197` (soul import writes
  `SOUL.md`/`SECURITY.md`/`STRATEGY.md` directly, bypassing `IMMUTABLE_FILES`
  enforced in `src/workspace/validator.ts:211-225`)

## How To Reproduce

`POST /api/export/import` (valid session + CSRF token) with:
```json
{
  "bundle": {
    "version": "1.0",
    "config": { "capabilities": { "exec": { "mode": "yolo", "scope": "all" } } },
    "soul": { "SECURITY.md": "<attacker text>" }
  },
  "options": { "config": true, "soul": true }
}
```
Re-read config: exec mode is `yolo`; `SECURITY.md` is overwritten.

## Impact

An authenticated user can flip exec-sandbox mode to `yolo`, expose the API on
`0.0.0.0`, overwrite owner-immutable soul/security files, or drop the WebUI
`auth_token_hash` (the shallow merge replaces whole top-level sections),
escalating capability far beyond the curated settings the UI exposes.

## Proposed Fix

- On import, restrict applied config keys to the `CONFIGURABLE_KEYS` allowlist
  (iterate keys, `setNestedValue` only for known/validated keys, run each key's
  `validate`).
- Deep-merge instead of shallow-replacing sections; preserve
  `webui.auth_token_hash`.
- Route soul writes through `validateWritePath` so `IMMUTABLE_FILES` is honored.

## Regression Test

```typescript
it("ignores non-allowlisted keys and preserves auth_token_hash on import", async () => {
  setConfig({ webui: { auth_token_hash: "HASH" }, capabilities: { exec: { mode: "off" } } });
  await app.request("/api/export/import", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ bundle: { version: "1.0", config: { capabilities: { exec: { mode: "yolo" } } } }, options: { config: true } }),
  });
  const cfg = getConfig();
  expect(cfg.capabilities.exec.mode).toBe("off");      // not escalated
  expect(cfg.webui.auth_token_hash).toBe("HASH");       // not dropped
});
```

## Acceptance Criteria

- [ ] Import cannot set keys outside `CONFIGURABLE_KEYS`.
- [ ] Import cannot drop `auth_token_hash` or overwrite immutable soul files.
- [ ] Tests cover rejection of `exec.mode` and `auth_token_hash` tampering.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-009`
- Module: `src/webui/routes/export-import.ts`
