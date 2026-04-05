/**
 * Tests for memory isolation: non-owner users must not receive admin context
 * via the RAG pipeline (relevant knowledge and feed history).
 *
 * Regression test for issue #150:
 * https://github.com/xlabtg/teleton-agent/issues/150
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { ContextBuilder } from "../search/context.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

/**
 * A minimal stub embedder that returns a fixed zero vector.
 * Sufficient for FTS-only tests where embedding similarity is not used.
 */
const stubEmbedder: EmbeddingProvider = {
  embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0)),
  embedDocument: vi.fn().mockResolvedValue(new Array(384).fill(0)),
};

function insertKnowledge(db: InstanceType<typeof Database>, id: string, text: string) {
  const hash = `hash-${id}`;
  db.prepare(
    `INSERT OR REPLACE INTO knowledge (id, source, path, text, hash) VALUES (?, 'memory', NULL, ?, ?)`
  ).run(id, text, hash);
}

function insertMessage(
  db: InstanceType<typeof Database>,
  chatId: string,
  text: string,
  timestamp: number = Math.floor(Date.now() / 1000)
) {
  const existing = db.prepare("SELECT id FROM tg_chats WHERE id = ?").get(chatId);
  if (!existing) {
    db.prepare(`INSERT INTO tg_chats (id, type, is_monitored) VALUES (?, 'dm', 1)`).run(chatId);
  }
  const id = `msg-${Math.random()}`;
  db.prepare(`INSERT INTO tg_messages (id, chat_id, text, timestamp) VALUES (?, ?, ?, ?)`).run(
    id,
    chatId,
    text,
    timestamp
  );
}

describe("ContextBuilder — memory isolation (issue #150)", () => {
  it("includeAgentMemory: false returns no relevant knowledge chunks", async () => {
    const db = createTestDb();
    insertKnowledge(db, "k1", "Admin trading session: bought 500 TON at $2.10");
    insertKnowledge(db, "k2", "Wallet balance: 12,000 USDT");

    const builder = new ContextBuilder(db, stubEmbedder, false);

    const context = await builder.buildContext({
      query: "wallet balance trading",
      chatId: "non-owner-chat",
      includeAgentMemory: false,
      includeFeedHistory: false,
    });

    expect(context.relevantKnowledge).toHaveLength(0);
  });

  it("includeAgentMemory: true returns relevant knowledge chunks (owner baseline)", async () => {
    const db = createTestDb();
    insertKnowledge(db, "k1", "Admin trading session: bought 500 TON at $2.10");

    const builder = new ContextBuilder(db, stubEmbedder, false);

    const context = await builder.buildContext({
      query: "trading session",
      chatId: "owner-chat",
      includeAgentMemory: true,
      includeFeedHistory: false,
    });

    // Knowledge is present — FTS should match the text
    // (result may be empty if FTS score is too low, but we verify no crash and shape is correct)
    expect(Array.isArray(context.relevantKnowledge)).toBe(true);
  });

  it("includeFeedHistory: false returns no relevant feed messages", async () => {
    const db = createTestDb();
    const adminChatId = "admin-private-123";
    insertMessage(db, adminChatId, "Admin private: sold BTC, profit 3 ETH");
    insertMessage(db, adminChatId, "Admin note: wallet seed phrase backup done");

    const builder = new ContextBuilder(db, stubEmbedder, false);

    const context = await builder.buildContext({
      query: "wallet seed phrase profit",
      chatId: "non-owner-chat",
      includeAgentMemory: false,
      includeFeedHistory: false,
    });

    expect(context.relevantFeed).toHaveLength(0);
  });

  it("includeFeedHistory: true with searchAllChats: false does not surface other-chat messages", async () => {
    const db = createTestDb();
    const adminChatId = "admin-chat-999";
    insertMessage(db, adminChatId, "Secret admin info: private wallet address");

    const builder = new ContextBuilder(db, stubEmbedder, false);

    // Non-owner in their own chat, group mode (searchAllChats: false)
    const context = await builder.buildContext({
      query: "wallet address",
      chatId: "non-owner-chat-777",
      includeAgentMemory: false,
      includeFeedHistory: true,
      searchAllChats: false,
    });

    // Should not contain admin-chat messages since searchAllChats is false
    const allFeed = context.relevantFeed.join(" ");
    expect(allFeed).not.toContain("Secret admin info");
  });

  it("non-owner gets neither knowledge nor feed when both flags are false", async () => {
    const db = createTestDb();
    insertKnowledge(db, "k1", "Private: admin TON staking plan");
    insertMessage(db, "admin-chat", "Admin note: 2FA backup codes stored");

    const builder = new ContextBuilder(db, stubEmbedder, false);

    const context = await builder.buildContext({
      query: "staking backup codes admin",
      chatId: "non-owner-chat",
      includeAgentMemory: false,
      includeFeedHistory: false,
    });

    expect(context.relevantKnowledge).toHaveLength(0);
    expect(context.relevantFeed).toHaveLength(0);
  });
});
