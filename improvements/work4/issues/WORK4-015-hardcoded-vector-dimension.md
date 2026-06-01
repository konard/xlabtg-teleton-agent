---
title: "[AUDIT/V4] Hardcoded vector dimension (384) breaks embeddings for non-local providers and silently drops message rows"
labels: ["bug", "audit-finding-v4", "high", "v3.0-blocker", "data-integrity"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-015"
severity: "high"
category: "data-integrity"
github-issue: ""
---

## Problem Description

The vec0 virtual tables are created with a hardcoded `vectorDimensions: 384`,
which only matches the `local` embedding provider. Other providers emit
different dimensions (e.g. Voyage 512/1024), so inserts fail a dimension check.
Worse, vector inserts happen inside DB transactions with **no per-insert
try/catch**, so a failed embedding insert aborts the surrounding transaction and
the associated message/knowledge row is lost rather than degrading gracefully.

## Location

- `src/index.ts:217` (`vectorDimensions: 384` hardcoded, regardless of provider)
- `src/memory/embeddings/anthropic.ts:15-26` (Voyage default `voyage-3-lite`=512,
  `voyage-3`=1024 — never 384)
- `src/memory/database.ts:91-92` (`const dims = this.config.vectorDimensions ?? 512;`
  then `ensureVectorTables(this.db, dims)` — creates the vec0 tables at the
  configured 384; see `src/memory/schema.ts:894,912-920`)
- `src/memory/agent/knowledge.ts:131-174` and `src/memory/feed/messages.ts:56-89`
  (vector inserts inside `this.db.transaction(() => {...})()`, no per-insert
  isolation — a failed vec insert rolls back the base row)

## How To Reproduce

1. Set the embedding provider to `anthropic` (Voyage, 1024-dim).
2. Ingest a message/knowledge item.
3. The vec insert fails on dimension mismatch and the transaction rolls back —
   the message row is not stored.

## Impact

Switching embedding providers silently corrupts ingestion: messages and
knowledge are dropped instead of stored, causing data loss and broken memory
search. The system is effectively locked to the 384-dim local provider.

## Proposed Fix

- Derive `vectorDimensions` from the active embedder (`embedder.dimensions`) at
  table-creation time; fail fast with a clear error on dimension change.
- Wrap vector inserts so an embedding failure degrades to "row stored without
  vector" instead of rolling back the row, and log the failure.

## Regression Test

```typescript
it("creates vec tables matching the active embedder and does not drop rows on embed failure", async () => {
  const db = openDb({ embedder: { dimensions: 1024 } }); // non-384 provider
  await storage.storeMessage(db, { id: "m1", text: "hello" });
  expect(db.prepare("SELECT COUNT(*) AS c FROM tg_messages WHERE id='m1'").get().c).toBe(1);
});
```

## Acceptance Criteria

- [ ] vec tables are created with the active embedder's dimension.
- [ ] An embedding-insert failure does not drop the base row.
- [ ] Tests cover a non-384 provider end-to-end.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-015`
- Module: `src/index.ts`, `src/memory/database.ts`, `src/memory/schema.ts`,
  `src/memory/embeddings/anthropic.ts`, `src/memory/agent/knowledge.ts`,
  `src/memory/feed/messages.ts`
