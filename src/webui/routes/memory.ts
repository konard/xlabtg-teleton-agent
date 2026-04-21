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

function vectorSyncUnavailableMessage(mode: MemoryVectorSyncResult["status"]["mode"]): string {
  if (mode === "standby") {
    return "Vector memory is not configured; local SQLite/FTS5 memory remains active.";
  }
  return "Vector memory is unavailable; local SQLite/FTS5 memory remains active.";
}

export function createMemoryRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  const graphStore = () => new MemoryGraphStore(deps.memory.db);
  const graphQuery = () => new MemoryGraphQuery(graphStore());

  // Search knowledge base
  app.get("/search", async (c) => {
    try {
      const query = c.req.query("q") || "";
      const limit = parseInt(c.req.query("limit") || "10", 10);

      if (!query) {
        const response: APIResponse = {
          success: false,
          error: "Query parameter 'q' is required",
        };
        return c.json(response, 400);
      }

      // Sanitize FTS5 query: wrap in double-quotes to treat as phrase literal
      const sanitizedQuery = '"' + query.replace(/"/g, '""') + '"';

      const results = deps.memory.db
        .prepare(
          `
          SELECT
            k.id,
            k.text,
            k.source,
            k.path,
            bm25(knowledge_fts) as score
          FROM knowledge_fts
          JOIN knowledge k ON knowledge_fts.rowid = k.rowid
          WHERE knowledge_fts MATCH ?
          ORDER BY score DESC
          LIMIT ?
        `
        )
        .all(sanitizedQuery, limit) as Array<{
        id: string;
        text: string;
        source: string;
        path: string | null;
        score: number;
      }>;

      const searchResults: MemorySearchResult[] = results.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.path || row.source,
        score: Math.max(0, 1 - row.score / 10), // Normalize BM25 score to 0-1 range
        keywordScore: Math.max(0, 1 - row.score / 10),
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
            status,
            message: vectorSyncUnavailableMessage(status.mode),
          },
        };
        return c.json(response);
      }

      const result = await deps.memory.knowledge.indexAll({ force: true });
      const finalStatus = await vectorStore.healthCheck();
      const synced = finalStatus.mode === "online";
      const response: APIResponse<MemoryVectorSyncResult> = {
        success: true,
        data: {
          synced,
          indexed: result.indexed,
          skipped: result.skipped,
          status: finalStatus,
          message: synced
            ? `Vector memory synchronized: ${result.indexed} file(s) indexed, ${result.skipped} skipped.`
            : vectorSyncUnavailableMessage(finalStatus.mode),
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
