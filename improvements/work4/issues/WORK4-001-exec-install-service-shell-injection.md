---
title: "[AUDIT/V4] exec_install and exec_service build shell commands by interpolation and ignore allowlist mode (command injection / allowlist bypass)"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-001"
severity: "high"
category: "security"
github-issue: ""
---

## Problem Description

`exec_install` and `exec_service` construct their shell command by string
interpolation of free-form, model-controlled arguments and pass the result to
`runCommand`, which defaults to `useShell = true` (`bash -c "<command>"`).
Neither tool consults the exec allowlist. Only `exec_run` checks
`isCommandAllowed`. As a result, an operator who configures
`capabilities.exec.mode = "allowlist"` (the documented "only permitted
commands" mode) still exposes arbitrary command execution through these two
tools.

## Location

- `src/agent/tools/exec/install.ts:13-18` (interpolated command templates)
- `src/agent/tools/exec/install.ts:51,65` (`buildCommand(packages)` then
  `runCommand(command, …)` with no allowlist check)
- `src/agent/tools/exec/service.ts:42,56` (`` `systemctl ${action} ${name}` ``)
- `src/agent/tools/exec/runner.ts:12` (`useShell = true` default →
  `["bash", ["-c", command]]`)
- Contrast `src/agent/tools/exec/run.ts:35-42`, which does enforce the
  allowlist.

## How To Reproduce

1. Set `capabilities.exec.mode: allowlist`, `command_allowlist: ["git"]`.
2. Invoke `exec_install` with
   `{ "manager": "apt", "packages": "git; touch /tmp/PWNED" }`
   (or `exec_service` with `{ "action": "status", "name": "x; touch /tmp/PWNED" }`).
3. `/tmp/PWNED` is created even though the allowlist only contains `git`.

## Impact

Arbitrary host command execution that completely bypasses
`command_allowlist`. An attacker-controlled tool argument
(`packages` / `name`) is classic shell injection in non-allowlist modes and a
full allowlist bypass in allowlist mode. This is the highest-impact finding in
this audit because exec runs in the same process that holds the TON mnemonic
and credentials.

## Proposed Fix

- Route `exec_install` / `exec_service` through the same gate as `exec_run`:
  in allowlist mode, reject (or run with `useShell: false` against a strictly
  tokenized argv).
- Validate each package / service name against a conservative pattern (e.g.
  `/^[A-Za-z0-9._@/+-]+$/`), split `packages` and validate each token, and
  spawn with `useShell: false` and an argv array instead of a shell string.

## Regression Test

```typescript
it("rejects exec_install package args that contain shell metacharacters", async () => {
  const exec = createExecInstallExecutor(db, { ...cfg, mode: "allowlist", command_allowlist: ["git"] });
  const res = await exec({ manager: "apt", packages: "git; touch /tmp/PWNED" }, ctx);
  expect(res.success).toBe(false);
  expect(existsSync("/tmp/PWNED")).toBe(false);
});
```

## Acceptance Criteria

- [ ] `exec_install` and `exec_service` honor `capabilities.exec.mode`.
- [ ] Package / service arguments are validated and executed without a shell.
- [ ] Tests cover allowlist rejection and metacharacter rejection.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-001`
- Module: `src/agent/tools/exec/`
- Related: WORK4-004 (exec scope allowlist ignored)
