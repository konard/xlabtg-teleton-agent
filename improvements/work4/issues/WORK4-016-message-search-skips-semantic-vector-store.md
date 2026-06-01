---
title: "[AUDIT/V4] Hybrid message search never queries the semantic vector store (Upstash), unlike knowledge search"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "logic"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-016"
severity: "medium"
category: "logic"
github-issue: ""
---

## Problem Description

`searchKnowledge` consults both local vectors and the remote semantic store
(Upstash), but `searchMessages` only uses the local path — it never queries the
semantic vector store. When the deployment relies on the remote store for
semantic recall, message search silently returns degraded (keyword/local-only)
results while knowledge search works as designed. `SemanticVectorStore` also has
no message-search method, so the capability is simply absent.

## Location

- `src/memory/search/hybrid.ts:127` (`searchMessages` — no semantic-store call)
- Contrast `src/memory/search/hybrid.ts:91,106-112,201-208`
  (`searchKnowledge` → `semanticVectorSearchKnowledge` queries the semantic store)
- `src/memory/vector-store.ts` — `SemanticVectorStore` exposes
  `searchKnowledge` but no equivalent message-search method

## How To Reproduce

1. Configure the remote semantic vector store (Upstash) for memory.
2. Run a semantic message query whose match exists only in the remote store.
3. `searchMessages` misses it while the equivalent knowledge query succeeds.

## Impact

Inconsistent and degraded semantic recall for messages; users get materially
worse results from message search than knowledge search with no indication why.

## Proposed Fix

- Extend `SemanticVectorStore` with a message-search method and call it from
  `searchMessages`, or explicitly document message search as local-only and gate
  the feature accordingly.

## Regression Test

```typescript
it("returns message matches served only from the semantic store", async () => {
  await semanticStore.upsertMessage({ id: "m1", text: "remote-only content" });
  const results = await hybrid.searchMessages("remote-only content");
  expect(results.map((r) => r.id)).toContain("m1");
});
```

## Acceptance Criteria

- [ ] Message search and knowledge search use the same store backends, or the
  divergence is documented and intentional.
- [ ] Test covers a message match served from the semantic store.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-016`
- Module: `src/memory/search/hybrid.ts`, `src/memory/vector-store.ts`
