import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createSessionsRoutes } from "../routes/sessions.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────

function createTestDb() {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      chat_id TEXT UNIQUE NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ended_at INTEGER,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      last_message_id INTEGER,
      last_channel TEXT,
      last_to TEXT,
      context_tokens INTEGER,
      model TEXT,
      provider TEXT,
      last_reset_date TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tg_chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      username TEXT,
      member_count INTEGER,
      is_monitored INTEGER DEFAULT 1,
      is_archived INTEGER DEFAULT 0,
      last_message_id TEXT,
      last_message_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS tg_users (
      id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_bot INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_allowed INTEGER DEFAULT 0,
      first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      message_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tg_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT,
      text TEXT,
      embedding TEXT,
      reply_to_id TEXT,
      forward_from_id TEXT,
      is_from_agent INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      has_media INTEGER DEFAULT 0,
      media_type TEXT,
      timestamp INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tg_messages_fts USING fts5(
      text,
      id UNINDEXED,
      chat_id UNINDEXED,
      sender_id UNINDEXED,
      timestamp UNINDEXED,
      content='tg_messages',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS tg_messages_fts_insert AFTER INSERT ON tg_messages BEGIN
      INSERT INTO tg_messages_fts(rowid, text, id, chat_id, sender_id, timestamp)
      VALUES (new.rowid, new.text, new.id, new.chat_id, new.sender_id, new.timestamp);
    END;

    CREATE TRIGGER IF NOT EXISTS tg_messages_fts_delete AFTER DELETE ON tg_messages BEGIN
      DELETE FROM tg_messages_fts WHERE rowid = old.rowid;
    END;
  `);

  return db;
}

// ── Seed helpers ─────────────────────────────────────────────────────

function seedSession(
  db: Database.Database,
  opts: {
    id: string;
    chatId: string;
    chatDbId?: string;
    chatType?: string;
    chatTitle?: string;
    chatUsername?: string;
    model?: string;
    messageCount?: number;
  }
) {
  const now = Date.now();
  const rawChatDbId = opts.chatDbId ?? opts.chatId.replace("telegram:", "");

  if (opts.chatType) {
    db.prepare(
      `INSERT OR IGNORE INTO tg_chats (id, type, title, username) VALUES (?, ?, ?, ?)`
    ).run(rawChatDbId, opts.chatType, opts.chatTitle ?? null, opts.chatUsername ?? null);
  }

  db.prepare(
    `INSERT INTO sessions (id, chat_id, started_at, updated_at, message_count, model)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(opts.id, opts.chatId, now, now, opts.messageCount ?? 0, opts.model ?? null);
}

function seedMessage(
  db: Database.Database,
  opts: {
    id: string;
    chatId: string;
    text?: string;
    isFromAgent?: boolean;
    timestamp?: number;
    senderId?: string;
  }
) {
  db.prepare(
    `INSERT INTO tg_messages (id, chat_id, text, is_from_agent, timestamp)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    opts.id,
    opts.chatId,
    opts.text ?? null,
    opts.isFromAgent ? 1 : 0,
    opts.timestamp ?? Date.now()
  );
}

// ── App builder ─────────────────────────────────────────────────────

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/sessions", createSessionsRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /sessions", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns empty list when no sessions exist", async () => {
    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.sessions).toEqual([]);
    expect(json.data.total).toBe(0);
  });

  it("returns sessions with pagination metadata", async () => {
    seedSession(db, { id: "sess-1", chatId: "telegram:100", chatType: "dm" });
    seedSession(db, { id: "sess-2", chatId: "telegram:200", chatType: "group", chatDbId: "200" });

    const res = await app.request("/sessions?page=1&limit=10");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessions.length).toBe(2);
    expect(json.data.total).toBe(2);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(10);
  });

  it("filters sessions by chat_type", async () => {
    seedSession(db, { id: "sess-dm", chatId: "telegram:101", chatType: "dm", chatDbId: "101" });
    seedSession(db, {
      id: "sess-grp",
      chatId: "telegram:201",
      chatType: "group",
      chatDbId: "201",
    });

    const res = await app.request("/sessions?chat_type=dm");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessions.length).toBe(1);
    expect(json.data.sessions[0].sessionId).toBe("sess-dm");
  });

  it("respects pagination limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      seedSession(db, { id: `sess-${i}`, chatId: `telegram:${1000 + i}` });
    }

    const res = await app.request("/sessions?page=1&limit=3");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessions.length).toBe(3);
    expect(json.data.total).toBe(5);

    const res2 = await app.request("/sessions?page=2&limit=3");
    const json2 = await res2.json();
    expect(json2.data.sessions.length).toBe(2);
  });

  it("returns session fields including chatType and chatTitle", async () => {
    seedSession(db, {
      id: "sess-with-chat",
      chatId: "telegram:999",
      chatType: "group",
      chatDbId: "999",
      chatTitle: "My Group",
      chatUsername: "mygroup",
      model: "claude-opus-4-5",
      messageCount: 10,
    });

    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    const json = await res.json();
    const s = json.data.sessions[0];
    expect(s.sessionId).toBe("sess-with-chat");
    expect(s.chatType).toBe("group");
    expect(s.chatTitle).toBe("My Group");
    expect(s.chatUsername).toBe("mygroup");
    expect(s.model).toBe("claude-opus-4-5");
    expect(s.messageCount).toBe(10);
  });
});

describe("GET /sessions/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/nonexistent");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns session detail for existing session", async () => {
    seedSession(db, {
      id: "sess-detail",
      chatId: "telegram:555",
      chatType: "dm",
      chatDbId: "555",
      model: "claude-sonnet-4-6",
    });

    const res = await app.request("/sessions/sess-detail");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.sessionId).toBe("sess-detail");
    expect(json.data.model).toBe("claude-sonnet-4-6");
    expect(json.data.chatType).toBe("dm");
  });
});

describe("GET /sessions/:id/messages", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/nonexistent/messages");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns empty messages when none exist for the session chat", async () => {
    seedSession(db, { id: "sess-empty", chatId: "telegram:777", chatType: "dm", chatDbId: "777" });

    const res = await app.request("/sessions/sess-empty/messages");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messages).toEqual([]);
    expect(json.data.total).toBe(0);
  });

  it("returns messages for the session's chat", async () => {
    seedSession(db, {
      id: "sess-msgs",
      chatId: "telegram:888",
      chatType: "dm",
      chatDbId: "888",
    });
    seedMessage(db, {
      id: "msg-1",
      chatId: "888",
      text: "Hello agent",
      isFromAgent: false,
      timestamp: 1000,
    });
    seedMessage(db, {
      id: "msg-2",
      chatId: "888",
      text: "Hello user",
      isFromAgent: true,
      timestamp: 2000,
    });

    const res = await app.request("/sessions/sess-msgs/messages");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(2);
    expect(json.data.messages.length).toBe(2);
    // Ordered by timestamp ASC
    expect(json.data.messages[0].text).toBe("Hello agent");
    expect(json.data.messages[0].isFromAgent).toBe(false);
    expect(json.data.messages[1].text).toBe("Hello user");
    expect(json.data.messages[1].isFromAgent).toBe(true);
  });

  it("paginates messages correctly", async () => {
    seedSession(db, {
      id: "sess-paginate",
      chatId: "telegram:333",
      chatType: "dm",
      chatDbId: "333",
    });
    for (let i = 0; i < 10; i++) {
      seedMessage(db, { id: `msg-p-${i}`, chatId: "333", text: `msg ${i}`, timestamp: i * 1000 });
    }

    const res = await app.request("/sessions/sess-paginate/messages?page=1&limit=4");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messages.length).toBe(4);
    expect(json.data.total).toBe(10);

    const res2 = await app.request("/sessions/sess-paginate/messages?page=3&limit=4");
    const json2 = await res2.json();
    expect(json2.data.messages.length).toBe(2); // 10 total, page 3 = items 9-10
  });
});

describe("DELETE /sessions/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("deletes an existing session", async () => {
    seedSession(db, { id: "sess-del", chatId: "telegram:444" });

    const res = await app.request("/sessions/sess-del", { method: "DELETE" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toBe("Session deleted");

    // Verify it's gone
    const check = db.prepare("SELECT id FROM sessions WHERE id = ?").get("sess-del");
    expect(check).toBeUndefined();
  });
});

describe("GET /sessions/search", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 400 when no query provided", async () => {
    const res = await app.request("/sessions/search");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("required");
  });

  it("returns matching messages for a search query", async () => {
    seedSession(db, { id: "sess-search", chatId: "telegram:111", chatType: "dm", chatDbId: "111" });
    seedMessage(db, {
      id: "msg-search-1",
      chatId: "111",
      text: "What is the weather today?",
      timestamp: 1000,
    });
    seedMessage(db, {
      id: "msg-search-2",
      chatId: "111",
      text: "Tell me about TypeScript",
      timestamp: 2000,
    });

    const res = await app.request("/sessions/search?q=weather");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].messageId).toBe("msg-search-1");
    expect(json.data[0].text).toContain("weather");
  });

  it("returns empty array when no messages match", async () => {
    seedSession(db, {
      id: "sess-nomatch",
      chatId: "telegram:222",
      chatType: "dm",
      chatDbId: "222",
    });
    seedMessage(db, { id: "msg-nm", chatId: "222", text: "Hello world", timestamp: 1000 });

    const res = await app.request("/sessions/search?q=xyznonexistent");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

describe("GET /sessions/:id/export", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/unknown/export");
    expect(res.status).toBe(404);
  });

  it("exports session as JSON by default", async () => {
    seedSession(db, {
      id: "sess-export",
      chatId: "telegram:600",
      chatType: "dm",
      chatDbId: "600",
    });
    seedMessage(db, { id: "msg-exp", chatId: "600", text: "Export this", timestamp: 1000 });

    const res = await app.request("/sessions/sess-export/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.text();
    const json = JSON.parse(body);
    expect(json.session.id).toBe("sess-export");
    expect(json.messages.length).toBe(1);
    expect(json.messages[0].text).toBe("Export this");
  });

  it("exports session as Markdown when format=md", async () => {
    seedSession(db, {
      id: "sess-md",
      chatId: "telegram:700",
      chatType: "group",
      chatDbId: "700",
      chatTitle: "Dev Group",
    });
    seedMessage(db, { id: "msg-md", chatId: "700", text: "Check this out", timestamp: 1000 });

    const res = await app.request("/sessions/sess-md/export?format=md");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("# Session Export");
    expect(body).toContain("Check this out");
  });
});
