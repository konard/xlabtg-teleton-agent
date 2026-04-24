import { Hono } from "hono";
import type {
  WebUIServerDeps,
  MemorySearchResult,
  MemorySourceFile,
  MemoryVectorSyncResult,
  SessionInfo,
  APIResponse,
} from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { MemoryGraphStore } from "../../memory/graph-store.js";
import { MemoryGraphQuery } from "../../memory/graph-query.js";
import { HybridSearch } from "../../memory/search/hybrid.js";
import { MemoryScorer } from "../../memory/scoring.js";
import { MemoryRetentionService } from "../../memory/retention.js";
import type { SemanticVectorIndexStats } from "../../memory/agent/knowledge.js";

function vectorSyncUnavailableMessage(mode: MemoryVectorSyncResult["status"]["mode"]): string {
  if (mode === "standby") {
    return "Vector memory is not configured; local SQLite/FTS5 memory remains active.";
  }
  return "Vector memory is unavailable; local SQLite/FTS5 memory remains active.";
}

function emptySemanticStats(): SemanticVectorIndexStats {
  return {
    upserted: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function vectorSyncMessage(params: {
  synced: boolean;
  namespace: string;
  indexed: number;
  skipped: number;
  semantic: SemanticVectorIndexStats;
  status: MemoryVectorSyncResult["status"];
}): string {
  const { synced, namespace, indexed, skipped, semantic, status } = params;
  if (synced) {
    return `Vector memory synchronized in namespace "${namespace}": ${semantic.upserted} vector(s) uploaded from ${indexed} file(s), ${skipped} skipped.`;
  }
  if (status.mode !== "online") {
    return vectorSyncUnavailableMessage(status.mode);
  }
  if (semantic.upserted === 0) {
    const firstError = semantic.errors[0] ? ` ${semantic.errors[0]}` : "";
    if (indexed === 0 && skipped === 0) {
      return "No memory files were found to upload to Upstash Vector.";
    }
    if (semantic.errors.some((err) => /dimension/i.test(err))) {
      return `No vectors were uploaded to Upstash Vector because of an embedding dimension mismatch. Align the embedding provider with the Upstash index dimension.${firstError}`;
    }
    return `No vectors were uploaded to Upstash Vector. Check that memory files contain content and embeddings are enabled.${firstError}`;
  }
  if (semantic.failed > 0) {
    const firstError = semantic.errors[0] ? ` ${semantic.errors[0]}` : "";
    return `Vector memory sync did not complete: ${semantic.failed} file(s) failed, ${semantic.upserted} vector(s) uploaded.${firstError}`;
  }
  return "No vectors were uploaded to Upstash Vector.";
}

export function createMemoryRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  const graphStore = () => new MemoryGraphStore(deps.memory.db);
  const graphQuery = () => new MemoryGraphQuery(graphStore());
  const scorer = () => deps.memory.scorer ?? new MemoryScorer(deps.memory.db);
  const retention = () =>
    deps.memory.retention ??
    new MemoryRetentionService(deps.memory.db, undefined, scorer(), deps.memory.vectorStore);

  // Search knowledge base
  app.get("/search", async (c) => {
    try {
      const query = c.req.query("q") || "";
      const limit = Math.max(1, Math.min(100, parseInt(c.req.query("limit") || "10", 10)));
      const minScoreRaw = c.req.query("min_score");
      const minScore =
        minScoreRaw === undefined ? undefined : Math.max(0, Math.min(1, parseFloat(minScoreRaw)));

      if (!query) {
        const response: APIResponse = {
          success: false,
          error: "Query parameter 'q' is required",
        };
        return c.json(response, 400);
      }

      const temporalConfig = deps.agent?.getConfig?.()?.temporal_context;
      const search = new HybridSearch(deps.memory.db, false, deps.memory.vectorStore, {
        ...temporalConfig?.weighting,
        enabled:
          temporalConfig?.enabled === false ? false : (temporalConfig?.weighting.enabled ?? true),
        timezone: temporalConfig?.timezone,
      });
      const results = await search.searchKnowledge(query, [], {
        limit,
        minScore: Number.isFinite(minScore) ? minScore : undefined,
        priorityWeight: 0.25,
      });

      const searchResults: MemorySearchResult[] = results.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.source,
        score: row.score,
        keywordScore: row.keywordScore,
        vectorScore: row.vectorScore,
        importanceScore: row.importanceScore,
        temporalScore: row.temporalScore,
      }));

      const response: APIResponse<MemorySearchResult[]> = {
        success: true,
        data: searchResults,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get prioritization stats for the Memory dashboard.
  app.get("/scores/stats", (c) => {
    try {
      const atRiskLimit = Math.max(
        1,
        Math.min(100, parseInt(c.req.query("at_risk_limit") || "20", 10))
      );
      const data = {
        scores: scorer().getStats(),
        pinned: scorer().listPinned(20),
        archive: retention().getArchiveStats(),
        atRisk: retention().getAtRisk(atRiskLimit),
        cleanupHistory: retention().getCleanupHistory(20),
      };

      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get a single memory score breakdown.
  app.get("/scores/:id", (c) => {
    try {
      const id = decodeURIComponent(c.req.param("id"));
      const score = scorer().getScore(id);
      if (!score) {
        const response: APIResponse = {
          success: false,
          error: "Memory score not found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<typeof score> = {
        success: true,
        data: score,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Pin/unpin a memory so retention never archives it.
  app.post("/scores/:id/pin", async (c) => {
    try {
      const id = decodeURIComponent(c.req.param("id"));
      const exists = deps.memory.db.prepare("SELECT id FROM knowledge WHERE id = ?").get(id);
      if (!exists) {
        const response: APIResponse = {
          success: false,
          error: "Memory not found",
        };
        return c.json(response, 404);
      }

      let pinned = true;
      try {
        const body = await c.req.json<{ pinned?: boolean }>();
        if (typeof body.pinned === "boolean") pinned = body.pinned;
      } catch {
        // Empty body defaults to pin.
      }

      const score = scorer().pinMemory(id, pinned);
      const response: APIResponse<typeof score> = {
        success: true,
        data: score,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Boost memories that contributed to a successful outcome.
  app.post("/scores/impact", async (c) => {
    try {
      const body = await c.req.json<{ memoryIds?: string[]; amount?: number }>();
      const ids = Array.isArray(body.memoryIds) ? body.memoryIds : [];
      if (ids.length === 0) {
        const response: APIResponse = {
          success: false,
          error: "memoryIds must contain at least one memory id",
        };
        return c.json(response, 400);
      }

      const memoryScorer = scorer();
      memoryScorer.boostImpact(ids, body.amount ?? 1);
      const data = ids.map((id) => memoryScorer.getScore(id)).filter(Boolean);
      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Trigger memory cleanup. Defaults to dry-run unless dry_run=false is supplied.
  app.post("/cleanup", async (c) => {
    try {
      let dryRun = c.req.query("dry_run") !== "false";
      try {
        const body = await c.req.json<{ dryRun?: boolean }>();
        if (typeof body.dryRun === "boolean") dryRun = body.dryRun;
      } catch {
        // Query-only calls are valid.
      }

      const data = await retention().cleanup({ dryRun });
      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get active sessions
  app.get("/sessions", (c) => {
    try {
      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            chat_id,
            id,
            message_count,
            context_tokens,
            updated_at
          FROM sessions
          ORDER BY updated_at DESC
        `
        )
        .all() as Array<{
        chat_id: string;
        id: string;
        message_count: number;
        context_tokens: number;
        updated_at: number;
      }>;

      const sessions: SessionInfo[] = rows.map((row) => ({
        chatId: row.chat_id,
        sessionId: row.id,
        messageCount: row.message_count,
        contextTokens: row.context_tokens,
        lastActivity: row.updated_at,
      }));

      const response: APIResponse<SessionInfo[]> = {
        success: true,
        data: sessions,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get memory stats
  app.get("/stats", (c) => {
    try {
      const stats = {
        knowledge: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM knowledge").get() as {
            count: number;
          }
        ).count,
        sessions: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as {
            count: number;
          }
        ).count,
        messages: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM tg_messages").get() as {
            count: number;
          }
        ).count,
        chats: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM tg_chats").get() as {
            count: number;
          }
        ).count,
      };

      const response: APIResponse<typeof stats> = {
        success: true,
        data: stats,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Synchronize existing MEMORY.md and memory/*.md chunks to the semantic vector store.
  app.post("/sync-vector", async (c) => {
    try {
      const vectorStore = deps.memory.vectorStore;
      if (!vectorStore) {
        const response: APIResponse<MemoryVectorSyncResult> = {
          success: true,
          data: {
            synced: false,
            indexed: 0,
            skipped: 0,
            vectorsUpserted: 0,
            vectorsDeleted: 0,
            vectorErrors: [],
            status: {
              mode: "standby",
              reason: "Semantic vector memory is not available in this server context",
            },
            message: "Vector memory is not available; local SQLite/FTS5 memory remains active.",
          },
        };
        return c.json(response);
      }

      const status = await vectorStore.healthCheck();
      if (status.mode !== "online") {
        const response: APIResponse<MemoryVectorSyncResult> = {
          success: true,
          data: {
            synced: false,
            indexed: 0,
            skipped: 0,
            vectorsUpserted: 0,
            vectorsDeleted: 0,
            vectorErrors: [],
            status,
            message: vectorSyncUnavailableMessage(status.mode),
          },
        };
        return c.json(response);
      }

      const result = await deps.memory.knowledge.indexAll({ force: true });
      const finalStatus = await vectorStore.healthCheck();
      const semantic = result.semantic ?? emptySemanticStats();
      const synced =
        finalStatus.mode === "online" && semantic.failed === 0 && semantic.upserted > 0;
      const response: APIResponse<MemoryVectorSyncResult> = {
        success: true,
        data: {
          synced,
          indexed: result.indexed,
          skipped: result.skipped,
          vectorsUpserted: semantic.upserted,
          vectorsDeleted: semantic.deleted,
          vectorErrors: semantic.errors,
          status: finalStatus,
          message: vectorSyncMessage({
            synced,
            namespace: vectorStore.namespace,
            indexed: result.indexed,
            skipped: result.skipped,
            semantic,
            status: finalStatus,
          }),
        },
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get chunks for a specific source
  app.get("/sources/:sourceKey", (c) => {
    try {
      const sourceKey = decodeURIComponent(c.req.param("sourceKey"));

      const rows = deps.memory.db
        .prepare(
          `
          SELECT id, text, source, path, start_line, end_line, updated_at
          FROM knowledge
          WHERE COALESCE(path, source) = ?
          ORDER BY start_line ASC, updated_at DESC
        `
        )
        .all(sourceKey) as Array<{
        id: string;
        text: string;
        source: string;
        path: string | null;
        start_line: number | null;
        end_line: number | null;
        updated_at: number;
      }>;

      const chunks = rows.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.path || row.source,
        startLine: row.start_line,
        endLine: row.end_line,
        updatedAt: row.updated_at,
      }));

      const response: APIResponse<typeof chunks> = {
        success: true,
        data: chunks,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // List/search graph nodes and adjacent in-scope edges for visualization.
  app.get("/graph/nodes", (c) => {
    try {
      const type = c.req.query("type") || undefined;
      const q = c.req.query("q") || undefined;
      const limit = parseInt(c.req.query("limit") || "120", 10);
      const data = graphStore().getOverview({ type, q, limit });

      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Traverse relationships around a node up to N hops.
  app.get("/graph/node/:id/related", (c) => {
    try {
      const id = decodeURIComponent(c.req.param("id"));
      const depth = parseInt(c.req.query("depth") || "2", 10);
      const limit = parseInt(c.req.query("limit") || "100", 10);
      const data = graphQuery().getRelated(id, { depth, limit });
      if (!data.root) {
        const response: APIResponse = {
          success: false,
          error: "Graph node not found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Find the shortest relationship path between two nodes.
  app.get("/graph/path", (c) => {
    try {
      const from = c.req.query("from");
      const to = c.req.query("to");
      const maxDepth = parseInt(c.req.query("maxDepth") || "6", 10);
      if (!from || !to) {
        const response: APIResponse = {
          success: false,
          error: "Query parameters 'from' and 'to' are required",
        };
        return c.json(response, 400);
      }

      const data = graphQuery().findShortestPath(from, to, { maxDepth });
      if (!data) {
        const response: APIResponse = {
          success: false,
          error: "No graph path found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get the full graph context around a task node or persisted task id.
  app.get("/graph/context", (c) => {
    try {
      const taskId = c.req.query("task_id");
      const depth = parseInt(c.req.query("depth") || "2", 10);
      const limit = parseInt(c.req.query("limit") || "100", 10);
      if (!taskId) {
        const response: APIResponse = {
          success: false,
          error: "Query parameter 'task_id' is required",
        };
        return c.json(response, 400);
      }

      const data = graphQuery().getTaskContext(taskId, { depth, limit });
      if (!data.root) {
        const response: APIResponse = {
          success: false,
          error: "Task graph node not found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<typeof data> = {
        success: true,
        data,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // List indexed sources (grouped by file/source category)
  app.get("/sources", (c) => {
    try {
      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            COALESCE(path, source) AS source_key,
            COUNT(*) AS entry_count,
            MAX(updated_at) AS last_updated
          FROM knowledge
          GROUP BY source_key
          ORDER BY last_updated DESC
        `
        )
        .all() as Array<{
        source_key: string;
        entry_count: number;
        last_updated: number;
      }>;

      const sources: MemorySourceFile[] = rows.map((row) => ({
        source: row.source_key,
        entryCount: row.entry_count,
        lastUpdated: row.last_updated,
      }));

      const response: APIResponse<MemorySourceFile[]> = {
        success: true,
        data: sources,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
