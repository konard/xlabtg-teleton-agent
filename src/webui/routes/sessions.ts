import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { CorrectionLogger } from "../../agent/self-correction/logger.js";

export function createSessionsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List sessions with pagination and optional filters
  app.get("/", (c) => {
    try {
      const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const chatType = c.req.query("chat_type"); // dm | group | channel
      const search = c.req.query("q");

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (chatType && ["dm", "group", "channel"].includes(chatType)) {
        conditions.push("c.type = ?");
        params.push(chatType);
      }

      if (search) {
        const sanitized = '"' + search.replace(/"/g, '""') + '"';
        // Filter sessions that have at least one matching message
        conditions.push(`s.chat_id IN (
          SELECT DISTINCT m.chat_id
          FROM tg_messages_fts f
          JOIN tg_messages m ON f.rowid = m.rowid
          WHERE f MATCH ?
        )`);
        params.push(sanitized);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = deps.memory.db
        .prepare(
          `
          SELECT COUNT(*) as total
          FROM sessions s
          LEFT JOIN tg_chats c ON s.chat_id = 'telegram:' || c.id
          ${whereClause}
        `
        )
        .get(...params) as { total: number };

      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            s.id,
            s.chat_id,
            s.started_at,
            s.updated_at,
            s.message_count,
            s.model,
            s.provider,
            s.input_tokens,
            s.output_tokens,
            s.context_tokens,
            c.type as chat_type,
            c.title as chat_title,
            c.username as chat_username
          FROM sessions s
          LEFT JOIN tg_chats c ON s.chat_id = 'telegram:' || c.id
          ${whereClause}
          ORDER BY s.updated_at DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(...params, limit, offset) as Array<{
        id: string;
        chat_id: string;
        started_at: number;
        updated_at: number;
        message_count: number;
        model: string | null;
        provider: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
        context_tokens: number | null;
        chat_type: string | null;
        chat_title: string | null;
        chat_username: string | null;
      }>;

      const sessions = rows.map((row) => ({
        sessionId: row.id,
        chatId: row.chat_id,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count || 0,
        model: row.model ?? null,
        provider: row.provider ?? null,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        contextTokens: row.context_tokens ?? 0,
        chatType: row.chat_type ?? null,
        chatTitle: row.chat_title ?? null,
        chatUsername: row.chat_username ?? null,
      }));

      const response: APIResponse<{
        sessions: typeof sessions;
        total: number;
        page: number;
        limit: number;
      }> = {
        success: true,
        data: {
          sessions,
          total: countRow.total,
          page,
          limit,
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

  // Full-text search across messages — must be before /:id to avoid matching "search" as an id
  app.get("/search", (c) => {
    try {
      const query = c.req.query("q") || "";
      const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

      if (!query) {
        const response: APIResponse = {
          success: false,
          error: "Query parameter 'q' is required",
        };
        return c.json(response, 400);
      }

      const sanitized = '"' + query.replace(/"/g, '""') + '"';

      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            m.id as message_id,
            m.text,
            m.is_from_agent,
            m.timestamp,
            m.chat_id,
            s.id as session_id,
            c.type as chat_type,
            c.title as chat_title,
            bm25(tg_messages_fts) as score
          FROM tg_messages_fts f
          JOIN tg_messages m ON f.rowid = m.rowid
          LEFT JOIN tg_chats c ON m.chat_id = c.id
          LEFT JOIN sessions s ON s.chat_id = 'telegram:' || m.chat_id
          WHERE tg_messages_fts MATCH ?
          ORDER BY score DESC
          LIMIT ?
        `
        )
        .all(sanitized, limit) as Array<{
        message_id: string;
        text: string | null;
        is_from_agent: number;
        timestamp: number;
        chat_id: string;
        session_id: string | null;
        chat_type: string | null;
        chat_title: string | null;
        score: number;
      }>;

      const results = rows.map((row) => ({
        messageId: row.message_id,
        text: row.text ?? "",
        isFromAgent: row.is_from_agent === 1,
        timestamp: row.timestamp,
        chatId: row.chat_id,
        sessionId: row.session_id ?? null,
        chatType: row.chat_type ?? null,
        chatTitle: row.chat_title ?? null,
        score: row.score,
      }));

      const response: APIResponse<typeof results> = { success: true, data: results };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get correction cycles for a session — must be before /:id
  app.get("/:id/corrections", (c) => {
    try {
      const sessionId = c.req.param("id");
      const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

      const row = deps.memory.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as
        | { id: string }
        | undefined;
      if (!row) {
        const response: APIResponse = { success: false, error: "Session not found" };
        return c.json(response, 404);
      }

      const corrections = new CorrectionLogger(deps.memory.db).listForSession(sessionId, limit);
      const response: APIResponse<{ corrections: typeof corrections }> = {
        success: true,
        data: { corrections },
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

  // Get session detail
  app.get("/:id", (c) => {
    try {
      const sessionId = c.req.param("id");

      const row = deps.memory.db
        .prepare(
          `
          SELECT
            s.id,
            s.chat_id,
            s.started_at,
            s.updated_at,
            s.message_count,
            s.model,
            s.provider,
            s.input_tokens,
            s.output_tokens,
            s.context_tokens,
            c.type as chat_type,
            c.title as chat_title,
            c.username as chat_username
          FROM sessions s
          LEFT JOIN tg_chats c ON s.chat_id = 'telegram:' || c.id
          WHERE s.id = ?
        `
        )
        .get(sessionId) as
        | {
            id: string;
            chat_id: string;
            started_at: number;
            updated_at: number;
            message_count: number;
            model: string | null;
            provider: string | null;
            input_tokens: number | null;
            output_tokens: number | null;
            context_tokens: number | null;
            chat_type: string | null;
            chat_title: string | null;
            chat_username: string | null;
          }
        | undefined;

      if (!row) {
        const response: APIResponse = { success: false, error: "Session not found" };
        return c.json(response, 404);
      }

      const session = {
        sessionId: row.id,
        chatId: row.chat_id,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count || 0,
        model: row.model ?? null,
        provider: row.provider ?? null,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        contextTokens: row.context_tokens ?? 0,
        chatType: row.chat_type ?? null,
        chatTitle: row.chat_title ?? null,
        chatUsername: row.chat_username ?? null,
      };

      const response: APIResponse<typeof session> = { success: true, data: session };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get messages for a session (paginated)
  app.get("/:id/messages", (c) => {
    try {
      const sessionId = c.req.param("id");
      const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
      const offset = (page - 1) * limit;

      // Verify the session exists and get the chat_id
      const sessionRow = deps.memory.db
        .prepare("SELECT id, chat_id FROM sessions WHERE id = ?")
        .get(sessionId) as { id: string; chat_id: string } | undefined;

      if (!sessionRow) {
        const response: APIResponse = { success: false, error: "Session not found" };
        return c.json(response, 404);
      }

      // Extract raw telegram chat id from stored "telegram:<id>" format
      const rawChatId = sessionRow.chat_id.startsWith("telegram:")
        ? sessionRow.chat_id.slice("telegram:".length)
        : sessionRow.chat_id;

      const countRow = deps.memory.db
        .prepare("SELECT COUNT(*) as total FROM tg_messages WHERE chat_id = ?")
        .get(rawChatId) as { total: number };

      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            m.id,
            m.chat_id,
            m.sender_id,
            m.text,
            m.is_from_agent,
            m.is_edited,
            m.has_media,
            m.media_type,
            m.timestamp,
            m.reply_to_id,
            u.username as sender_username,
            u.first_name as sender_first_name,
            u.last_name as sender_last_name
          FROM tg_messages m
          LEFT JOIN tg_users u ON m.sender_id = u.id
          WHERE m.chat_id = ?
          ORDER BY m.timestamp ASC
          LIMIT ? OFFSET ?
        `
        )
        .all(rawChatId, limit, offset) as Array<{
        id: string;
        chat_id: string;
        sender_id: string | null;
        text: string | null;
        is_from_agent: number;
        is_edited: number;
        has_media: number;
        media_type: string | null;
        timestamp: number;
        reply_to_id: string | null;
        sender_username: string | null;
        sender_first_name: string | null;
        sender_last_name: string | null;
      }>;

      const messages = rows.map((row) => {
        const nameParts = [row.sender_first_name, row.sender_last_name].filter(Boolean);
        return {
          id: row.id,
          senderId: row.sender_id ?? null,
          senderUsername: row.sender_username ?? null,
          senderName: nameParts.length > 0 ? nameParts.join(" ") : null,
          text: row.text ?? null,
          isFromAgent: row.is_from_agent === 1,
          isEdited: row.is_edited === 1,
          hasMedia: row.has_media === 1,
          mediaType: row.media_type ?? null,
          timestamp: row.timestamp,
          replyToId: row.reply_to_id ?? null,
        };
      });

      const response: APIResponse<{
        messages: typeof messages;
        total: number;
        page: number;
        limit: number;
      }> = {
        success: true,
        data: {
          messages,
          total: countRow.total,
          page,
          limit,
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

  // Delete a session
  app.delete("/:id", (c) => {
    try {
      const sessionId = c.req.param("id");

      const row = deps.memory.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as
        | { id: string }
        | undefined;

      if (!row) {
        const response: APIResponse = { success: false, error: "Session not found" };
        return c.json(response, 404);
      }

      deps.memory.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: "Session deleted" },
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

  // Export session as JSON or Markdown
  app.get("/:id/export", (c) => {
    try {
      const sessionId = c.req.param("id");
      const format = c.req.query("format") === "md" ? "md" : "json";

      const sessionRow = deps.memory.db
        .prepare(
          `
          SELECT
            s.id,
            s.chat_id,
            s.started_at,
            s.updated_at,
            s.message_count,
            s.model,
            s.provider,
            c.type as chat_type,
            c.title as chat_title,
            c.username as chat_username
          FROM sessions s
          LEFT JOIN tg_chats c ON s.chat_id = 'telegram:' || c.id
          WHERE s.id = ?
        `
        )
        .get(sessionId) as
        | {
            id: string;
            chat_id: string;
            started_at: number;
            updated_at: number;
            message_count: number;
            model: string | null;
            provider: string | null;
            chat_type: string | null;
            chat_title: string | null;
            chat_username: string | null;
          }
        | undefined;

      if (!sessionRow) {
        const response: APIResponse = { success: false, error: "Session not found" };
        return c.json(response, 404);
      }

      const rawChatId = sessionRow.chat_id.startsWith("telegram:")
        ? sessionRow.chat_id.slice("telegram:".length)
        : sessionRow.chat_id;

      const messageRows = deps.memory.db
        .prepare(
          `
          SELECT
            m.id,
            m.text,
            m.is_from_agent,
            m.timestamp,
            u.username as sender_username,
            u.first_name as sender_first_name,
            u.last_name as sender_last_name
          FROM tg_messages m
          LEFT JOIN tg_users u ON m.sender_id = u.id
          WHERE m.chat_id = ?
          ORDER BY m.timestamp ASC
        `
        )
        .all(rawChatId) as Array<{
        id: string;
        text: string | null;
        is_from_agent: number;
        timestamp: number;
        sender_username: string | null;
        sender_first_name: string | null;
        sender_last_name: string | null;
      }>;

      if (format === "json") {
        const data = {
          session: {
            id: sessionRow.id,
            chatId: sessionRow.chat_id,
            chatTitle: sessionRow.chat_title,
            chatType: sessionRow.chat_type,
            startedAt: new Date(sessionRow.started_at).toISOString(),
            updatedAt: new Date(sessionRow.updated_at).toISOString(),
            model: sessionRow.model,
            provider: sessionRow.provider,
          },
          messages: messageRows.map((m) => {
            const nameParts = [m.sender_first_name, m.sender_last_name].filter(Boolean);
            return {
              id: m.id,
              role: m.is_from_agent ? "agent" : "user",
              sender: m.sender_username ?? (nameParts.length > 0 ? nameParts.join(" ") : "Unknown"),
              text: m.text ?? "",
              timestamp: new Date(m.timestamp).toISOString(),
            };
          }),
        };

        const filename = `session-${sessionId.slice(0, 8)}.json`;
        return c.body(JSON.stringify(data, null, 2), 200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        });
      } else {
        const chatLabel = sessionRow.chat_title || sessionRow.chat_username || sessionRow.chat_id;

        const lines: string[] = [
          `# Session Export`,
          ``,
          `**Chat:** ${chatLabel}`,
          `**Type:** ${sessionRow.chat_type ?? "unknown"}`,
          `**Started:** ${new Date(sessionRow.started_at).toISOString()}`,
          `**Model:** ${sessionRow.model ?? "unknown"}`,
          ``,
          `---`,
          ``,
        ];

        for (const m of messageRows) {
          const nameParts = [m.sender_first_name, m.sender_last_name].filter(Boolean);
          const sender = m.is_from_agent
            ? "**Agent**"
            : `**${m.sender_username ?? (nameParts.length > 0 ? nameParts.join(" ") : "User")}**`;
          const ts = new Date(m.timestamp).toLocaleString();
          lines.push(`${sender} _(${ts})_`);
          lines.push(``);
          lines.push(m.text ?? "_[no text]_");
          lines.push(``);
          lines.push(`---`);
          lines.push(``);
        }

        const filename = `session-${sessionId.slice(0, 8)}.md`;
        return c.body(lines.join("\n"), 200, {
          "Content-Type": "text/markdown",
          "Content-Disposition": `attachment; filename="${filename}"`,
        });
      }
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
