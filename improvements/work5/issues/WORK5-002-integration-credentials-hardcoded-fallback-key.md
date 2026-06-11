---
title: "[AUDIT/V5] Integration credentials fall back to a hardcoded, public encryption key when no key material is configured"
labels: ["bug", "audit-finding-v5", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-002"
severity: "high"
category: "security"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/586"
---

## Problem Description

`IntegrationAuthManager` derives its AES key from the first non-empty of
`keyMaterial`, `process.env.TELETON_INTEGRATIONS_KEY`, or — if both are absent —
the string literal `"default-insecure-key-set-TELETON_INTEGRATIONS_KEY"`. When
no key is configured, every integration credential (OAuth tokens, API keys,
passwords) is encrypted under a constant key that is published in the source
tree. Anyone with read access to the SQLite database can derive the identical
key and decrypt every stored secret. The `warnNoKey()` log line is the only
mitigation, and it does not stop credentials from being written under the public
key.

This is distinct from WORK4-003 / #525 (which is about the auto-generated key
being co-located with the ciphertext in the same DB). Here the failure is worse:
with no key configured there is no secret at all — the key is a compile-time
constant.

## Location

- `src/services/integrations/auth.ts:143-147`
  ```ts
  const material = keyMaterial || process.env.TELETON_INTEGRATIONS_KEY || "";
  if (!material) { warnNoKey(); }
  this.key = deriveKey(material || "default-insecure-key-set-TELETON_INTEGRATIONS_KEY");
  ```
- `encryptJson` / `createCredential` (`:150-174`) then persist ciphertext under
  this key.

## How To Reproduce

1. Start Teleton without `TELETON_INTEGRATIONS_KEY` set and without passing
   `keyMaterial`.
2. Create an integration credential (`createCredential`).
3. Read `credentials_encrypted` from the DB and decrypt it with a key derived
   from the public literal — the plaintext is recovered.

## Impact

On any deployment that forgets to set `TELETON_INTEGRATIONS_KEY`, encryption of
integration secrets is effectively absent: the ciphertext is reversible by
anyone who reads the database (backup leak, shared host, stolen disk). The
warning is easy to miss and the system keeps operating, so the insecure default
is the steady state.

## Proposed Fix

- Refuse to start (or refuse to create/read credentials) when no key material is
  configured, instead of silently falling back to a constant.
- If a generated-and-stored key is acceptable (as in #525's model), generate a
  random key on first use and persist it with restrictive permissions — never
  use a source-literal default.
- Document `TELETON_INTEGRATIONS_KEY` as required in setup.

## Regression Test

```typescript
it("does not encrypt credentials under a hardcoded fallback key", () => {
  delete process.env.TELETON_INTEGRATIONS_KEY;
  expect(() => new IntegrationAuthManager(db)).toThrow(/key.*required|TELETON_INTEGRATIONS_KEY/i);
});
```

## Acceptance Criteria

- [ ] With no configured key, credential creation/read fails loudly instead of
      using the public constant.
- [ ] No source-literal key can ever encrypt persisted credentials.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-002`
- Module: `src/services/integrations/auth.ts`
- Related: WORK4-003 / #525 (key co-located in DB)
