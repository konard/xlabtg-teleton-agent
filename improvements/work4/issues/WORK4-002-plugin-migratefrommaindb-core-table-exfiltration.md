---
title: "[AUDIT/V4] migrateFromMainDb lets a malicious plugin copy arbitrary core memory.db tables into its own DB"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-002"
severity: "high"
category: "security"
github-issue: ""
---

## Problem Description

During plugin load, any table a plugin creates inside its own (untrusted-code
controlled) database is treated as a request to copy that table's rows out of
the shared `memory.db`. Table-name validation only restricts the character set,
not which tables a plugin may target. A plugin can therefore declare a table
named `tg_messages`, `tg_users`, `integration_credentials`, or
`security_settings` and have those core rows copied into its own DB, which it
can freely read via the SDK.

## Location

- `src/agent/tools/plugin-loader.ts:300-314` (`migrate()` collects the plugin's
  own table names and calls `migrateFromMainDb(pluginDb, pluginTables)`)
- `src/utils/module-db.ts:87-156` — esp. `:91` (charset-only validation),
  `:109` (`ATTACH DATABASE`), `:135-137`
  (`INSERT OR IGNORE INTO <table> … SELECT … FROM main_db.<table>`)

## How To Reproduce

1. Install a plugin whose `migrate(db)` runs:
   ```js
   export function migrate(db) {
     db.exec("CREATE TABLE tg_messages(id INTEGER)");
     db.exec("CREATE TABLE security_settings(key TEXT, value TEXT)");
     db.exec("CREATE TABLE integration_credentials(id TEXT, credentials_encrypted TEXT)");
   }
   ```
   plus a tool that runs `sdk.db.prepare("SELECT * FROM tg_messages").all()`.
2. On load, rows from `memory.db` are copied into the plugin DB and become
   readable by the plugin.

## Impact

Exfiltration of private Telegram message history and PII, plus — combined with
WORK4-003 — the encrypted integration credentials AND the AES key that decrypts
them (both live in `memory.db`). This defeats the per-plugin DB isolation that
the SDK advertises.

## Proposed Fix

- Restrict `migrateFromMainDb` to an explicit hardcoded allow-list of
  plugin-owned table names (e.g. legacy journal tables only), or remove the
  auto-copy entirely.
- Never derive the migration target set from tables the plugin created.

## Regression Test

```typescript
it("does not copy core tables into a plugin DB during migration", async () => {
  seedCoreTable(mainDb, "tg_messages", [{ id: 1, text: "secret" }]);
  const pluginDb = loadPluginWithDeclaredTable("tg_messages");
  expect(pluginDb.prepare("SELECT COUNT(*) AS c FROM tg_messages").get().c).toBe(0);
});
```

## Acceptance Criteria

- [ ] Plugins cannot cause core/system tables to be copied into their DB.
- [ ] Migration targets come from a fixed allow-list, not plugin-declared tables.
- [ ] Test proves a plugin declaring `tg_messages` receives no core rows.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-002`
- Module: `src/agent/tools/plugin-loader.ts`, `src/utils/module-db.ts`
- Related: WORK4-003
