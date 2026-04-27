---
title: "[AUDIT/V2] Memory search API skips semantic vector retrieval"
labels: ["bug", "audit-finding-v2", "medium", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
audit-source: "#445"
finding-id: "V2-004"
severity: "medium"
category: "ui"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/450"
---

## Problem Description

The `/api/memory/search` route constructs `HybridSearch` with
`vectorEnabled = false` and passes an empty query embedding to
`searchKnowledge()`. `HybridSearch` can call the semantic vector store only when
it receives a non-empty embedding. Therefore the WebUI and Management API memory
search route remains keyword-only even when semantic vector memory is configured
and synchronized.

## Location

- `src/webui/routes/memory.ts:95`
- `src/webui/routes/memory.ts:101`
- `src/memory/search/hybrid.ts`

## How To Reproduce

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

Manual route-level scenario:

1. Configure semantic vector memory and index a memory chunk whose wording is
   semantically related to, but does not lexically contain, the query.
2. Call the agent memory search tool and observe semantic results.
3. Call `/api/memory/search?q=<semantic query>`.
4. Observe that the API route does not call the embedder/vector store and falls
   back to keyword-only results.

## Impact

The advertised V2 semantic memory capability is not exposed through the
operator-facing search API. Users can synchronize vectors successfully but still
get empty or incomplete memory search results in the UI for natural-language
queries.

## Proposed Fix

Use the configured memory embedder and vector readiness in the route:

```typescript
const queryEmbedding = await deps.memory.embedder.embedQuery(query);
const search = new HybridSearch(
  deps.memory.db,
  deps.memory.dbIsVectorReady ?? false,
  deps.memory.vectorStore,
  temporalOptions
);
const results = await search.searchKnowledge(query, queryEmbedding, options);
```

If local vector readiness is not available on `WebUIServerDeps`, expose it from
the memory system or rely on semantic vector store configuration while still
passing the embedding.

## Regression Test

```typescript
it("uses embeddings and semantic vector store for memory route search", async () => {
  const embedder = { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  const vectorStore = {
    isConfigured: true,
    searchKnowledge: vi
      .fn()
      .mockResolvedValue([
        { id: "semantic", text: "related memory", source: "memory", score: 0.92 },
      ]),
  };
  const app = buildMemoryRoutes({ embedder, vectorStore });

  const res = await app.request("/memory/search?q=meaning based query");
  const json = await res.json();

  expect(embedder.embedQuery).toHaveBeenCalledWith("meaning based query");
  expect(vectorStore.searchKnowledge).toHaveBeenCalled();
  expect(json.data[0].id).toBe("semantic");
});
```

## Acceptance Criteria

- [ ] `/api/memory/search` computes a query embedding when embeddings are
      enabled.
- [ ] The route calls semantic vector search when a semantic vector store is
      configured.
- [ ] Keyword fallback still works when embedding or vector search fails.
- [ ] Regression tests cover semantic success and fallback behavior.

## Related Artifacts

- GitHub issue: https://github.com/xlabtg/teleton-agent/issues/450
- Report: `improvements/work3/AUDIT_V2_REPORT.md#v2-004---memory-search-api-skips-semantic-vector-retrieval`
- Module: `src/webui/routes/memory.ts`
- Related V2 spec: `improvements/v2-01-semantic-vector-memory.md`
