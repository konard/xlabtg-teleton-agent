---
title: "[AUDIT/V4] Integration-credential AES key is stored in the same database as the ciphertext"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-003"
severity: "medium"
category: "security"
github-issue: ""
---

## Problem Description

When `TELETON_INTEGRATIONS_KEY` is not set (the default), the AES-256-GCM key
used to encrypt integration credentials is auto-generated and persisted into
`security_settings` inside the same `memory.db` that stores the encrypted
credentials (`integration_credentials`). Encryption-at-rest then provides no
confidentiality against any actor who can read the database file/rows.

## Location

- `src/services/integrations/auth.ts:70-82` (`getStoredKey` persists the key)
- `src/services/integrations/auth.ts:148` (derivation order:
  `keyMaterial || env || getStoredKey(db)`)
- `src/services/integrations/registry.ts:69` (tables created in the main DB)
- `src/memory/schema.ts:86-96` (`security_settings` schema)

## How To Reproduce

1. Leave `TELETON_INTEGRATIONS_KEY` unset.
2. Store an integration credential.
3. Read `security_settings` (`integration_credentials_key`) and
   `integration_credentials` from `memory.db`; decrypt with the stored key.

## Impact

"Encrypted" integration credentials are effectively plaintext to anyone with
read access to `memory.db` — including the plugin DB-copy path in WORK4-002,
backups, or DB exfiltration. Removes the protective value of the AES-GCM layer.

## Proposed Fix

- Require an out-of-DB key (env var / OS keyring / file with `0600` perms
  outside the DB); refuse to auto-store the key in the same database in
  production.
- At minimum, keep `security_settings` out of any plugin-reachable copy path
  (see WORK4-002) and document the env-key requirement.

## Regression Test

```typescript
it("does not persist the integrations AES key inside memory.db by default", () => {
  process.env.TELETON_INTEGRATIONS_KEY = "";
  storeCredential(db, "svc", { token: "secret" });
  const row = db.prepare(
    "SELECT value FROM security_settings WHERE key = 'integration_credentials_key'",
  ).get();
  expect(row).toBeUndefined();
});
```

## Acceptance Criteria

- [ ] Default deployments do not store the encryption key alongside ciphertext,
      or this is loudly warned against and documented.
- [ ] `security_settings` is excluded from any plugin-accessible migration path.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-003`
- Module: `src/services/integrations/auth.ts`
- Related: WORK4-002
