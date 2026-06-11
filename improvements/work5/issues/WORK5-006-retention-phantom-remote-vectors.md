---
title: "[AUDIT/V5] Memory retention deletes local vectors inside the transaction but only logs remote (Upstash) delete failures, leaving phantom vectors"
labels: ["bug", "audit-finding-v5", "medium", "v3.0-blocker", "data-integrity"]
milestone: "v3.0 - Production Ready"
audit-source: "#583"
finding-id: "WORK5-006"
severity: "medium"
category: "data-integrity"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/590"
---

## Problem Description

During retention/archive, the local `knowledge` rows and their local vector rows
are deleted inside a synchronous SQLite transaction (`deleteVector?.run(row.id)`
/ `deleteKnowledge.run(row.id)`), and the transaction commits. Only **after**
the commit does the code attempt to delete the corresponding vectors from the
remote semantic store (Upstash) via `await this.vectorStore.delete(ids)`, and a
failure there is swallowed with `log.warn(...)`. The local state is already gone,
so on any remote failure (network blip, auth error, rate limit) the remote store
keeps orphaned vectors for content that no longer exists locally.

These phantom vectors then surface in semantic search results pointing at IDs
with no backing row, producing dangling hits and a slow, monotonic divergence
between local and remote stores that nothing ever reconciles.

## Location

- `src/memory/retention.ts:255-288` — local deletes inside the transaction
  (`:275-276`), commit, then post-commit remote delete whose failure is only
  logged (`:282-288`):
  ```ts
  if (archived > 0 && this.vectorStore?.isConfigured) {
    try { await this.vectorStore.delete(ids); }
    catch (error) { log.warn({ err: error }, "Semantic vector cleanup failed after memory archive"); }
  }
  ```

## How To Reproduce

1. Configure a remote vector store and add knowledge entries with vectors.
2. Force `vectorStore.delete` to reject (e.g. simulate a network error).
3. Run retention so those entries are archived/deleted locally.
4. Query the semantic store — the deleted IDs are still returned (no local row).

## Impact

Search returns stale/dangling semantic hits; remote storage grows unbounded with
orphaned vectors; local and remote stores silently diverge with no repair path.
For privacy-sensitive deletions, content the user expected to be purged remains
queryable in the remote index.

## Proposed Fix

- Record failed remote deletions in a durable pending-deletion queue and retry
  them (idempotently) until they succeed, instead of dropping the error.
- Alternatively, delete from the remote store first (or in the same logical unit)
  and only commit the local delete once the remote delete is confirmed.
- Add a reconciliation pass that removes remote vectors whose local row is gone.

## Regression Test

```typescript
it("retries / records remote vector deletes that fail after local archive", async () => {
  vectorStore.delete = vi.fn().mockRejectedValueOnce(new Error("network"));
  await retention.cleanup();
  expect(retention.pendingRemoteDeletions()).toContain(archivedId);
});
```

## Acceptance Criteria

- [ ] A failed remote delete is retried or persisted for later retry, not lost.
- [ ] After a transient remote failure + recovery, no orphaned remote vector
      remains.

## Related Artifacts

- Report: `improvements/work5/AUDIT_V5_REPORT.md#work5-006`
- Module: `src/memory/retention.ts`
