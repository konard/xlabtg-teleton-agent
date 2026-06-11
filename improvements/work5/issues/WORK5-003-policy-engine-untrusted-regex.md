---
title: "[AUDIT/V5] Security policy engine compiles untrusted regex patterns with no guard (ReDoS / crash on evaluation)"
labels: ["bug", "audit-finding-v5", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-003"
severity: "high"
category: "security"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/587"
---

## Problem Description

`matchesParam` compiles `matcher.pattern` directly with
`new RegExp(matcher.pattern).test(value)` on every policy evaluation. The pattern
comes from a policy definition and is never validated, length-limited, compiled
once, or wrapped in a try/catch. Two problems follow:

1. **ReDoS** — a pathological pattern (e.g. `(a+)+$`) evaluated against an
   attacker-influenced `value` causes catastrophic backtracking and blocks the
   event loop, stalling the agent's security checks for every request.
2. **Crash** — an invalid pattern throws a `SyntaxError` synchronously inside
   `matchesPolicy`, which propagates out of policy evaluation; depending on the
   caller this can fail open (policy skipped) or take down the evaluation path.

Unlike `matchesName` (`:463-467`), which builds its regex from a glob whose
literal parts are escaped, `matchesParam` passes the raw pattern through
unmodified, and the regex is recompiled on every call rather than cached.

## Location

- `src/services/policy-engine.ts:471-476` — `matchesParam`:
  ```ts
  if (matcher.pattern !== undefined) {
    if (typeof value !== "string") return false;
    if (!new RegExp(matcher.pattern).test(value)) return false;
  }
  ```
- Validation entrypoint `normalizePolicy` (`:415-439`) never checks
  `match.params.*.pattern`.

## How To Reproduce

1. Register a policy whose param matcher uses `pattern: "(a+)+$"`.
2. Evaluate an action whose corresponding param value is a long run of `a`
   followed by a non-match (e.g. `"aaaaaaaaaaaaaaaaaaaaaaaa!"`).
3. The evaluation hangs (CPU pegged) — every concurrent request waits.

## Impact

A user able to author security policies (or supply policy params) can stall the
security-decision path or crash it, undermining the very component that gates
tool execution and spending. Even without malice, a typo'd pattern throws at
evaluation time rather than at definition time.

## Proposed Fix

- Validate `pattern` at `normalizePolicy` time: compile it once in a try/catch
  and reject the policy on `SyntaxError`; store the compiled `RegExp`.
- Bound pattern length and reject obviously dangerous constructs, or evaluate
  with a timeout / a linear-time engine (e.g. `re2`).
- Catch evaluation errors and fail closed (treat as no-match / deny) rather than
  letting them propagate.

## Regression Test

```typescript
it("rejects an invalid or unsafe regex pattern at policy definition time", () => {
  expect(() => engine.addPolicy({ name: "p", action: "deny",
    match: { params: { x: { pattern: "(" } } } })).toThrow(/pattern|regex/i);
});
```

## Acceptance Criteria

- [ ] Invalid patterns are rejected when the policy is defined, not at eval time.
- [ ] Policy evaluation cannot hang the event loop on a crafted pattern/value.
- [ ] Compiled regexes are reused, not rebuilt per evaluation.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-003`
- Module: `src/services/policy-engine.ts`
