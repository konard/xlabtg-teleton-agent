---
title: "[AUDIT/V4] exec scope \"allowlist\" silently ignores exec.allowlist and grants exec to all admins"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-004"
severity: "medium"
category: "logic"
github-issue: ""
---

## Problem Description

`capabilities.exec.scope` supports the value `allowlist`, documented as
"Telegram user IDs allowed to use exec". But `resolveScope` collapses
`allowlist` to `admin-only`, and nothing ever reads `execCfg.allowlist`. The
documented per-user restriction does not exist.

## Location

- `src/agent/tools/exec/module.ts:15-24` (`resolveScope`: `case "allowlist":
  return "admin-only"`)
- `src/config/schema.ts:754-761` (`allowlist: z.array(z.number())` with the
  "when scope = allowlist" description)

## How To Reproduce

1. Set `scope: "allowlist"`, `allowlist: [123]`, `admin_ids: [999]`.
2. User `999` (an admin, not in the allowlist) can run exec.
3. User `123` (in the allowlist, not an admin) is denied.

## Impact

An operator who configures `scope: allowlist` with a narrow user-ID list
believes exec is limited to those IDs, but every admin retains exec and listed
non-admins are denied. The effective privilege boundary differs from the
configured/expected policy — a false sense of restriction over a host-command
capability.

## Proposed Fix

- Implement an `allowlist` enforcement path that checks
  `senderId ∈ exec.allowlist` independent of admin status, or
- Remove the `allowlist` scope value entirely to avoid a misleading option.

## Regression Test

```typescript
it("enforces exec.allowlist membership under scope=allowlist", () => {
  const cfg = { scope: "allowlist", allowlist: [123], admin_ids: [999] };
  expect(canUseExec(cfg, 123)).toBe(true);  // listed non-admin allowed
  expect(canUseExec(cfg, 999)).toBe(false); // admin not in list denied
});
```

## Acceptance Criteria

- [ ] `scope: allowlist` enforces membership in `exec.allowlist`, or the value
      is removed.
- [ ] Tests cover allowed/denied users under `allowlist` scope.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-004`
- Module: `src/agent/tools/exec/module.ts`
- Related: WORK4-001
