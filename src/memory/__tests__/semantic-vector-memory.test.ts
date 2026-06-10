import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { ToolContext } from "../../agent/tools/types.js";
import { memorySearchExecutor } from "../../agent/tools/telegram/memory/memory-search.js";
import { KnowledgeIndexer } from "../agent/knowledge.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { MessageStore } from "../feed/messages.js";
import { ensureSchema } from "../schema.js";
import { HybridSearch } from "../search/hybrid.js";
import { UpstashSemanticVectorStore, type SemanticVectorStore } from "../vector-store.js";

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

function insertKnowledge(db: InstanceType<typeof Database>, id: string, text: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO knowledge (id, source, path, text, hash) VALUES (?, 'memory', NULL, ?, ?)`
  ).run(id, text, `hash-${id}`);
}

function insertMessageRow(
  db: InstanceType<typeof Database>,
  id: string,
  chatId: string,
  text: string
): void {
  const existing = db.prepare("SELECT id FROM tg_chats WHERE id = ?").get(chatId);
  if (!existing) {
    db.prepare(`INSERT INTO tg_chats (id, type, is_monitored) VALUES (?, 'dm', 1)`).run(chatId);
  }
  db.prepare(`INSERT INTO tg_messages (id, chat_id, text, timestamp) VALUES (?, ?, ?, ?)`).run(
    id,
    chatId,
    text,
    Math.floor(Date.now() / 1000)
  );
}

function makeEmbedder(embedding: number[] = [0.1, 0.2, 0.3]): EmbeddingProvider {
  return {
    id: "test",
    model: "test-model",
    dimensions: embedding.length,
    embedQuery: vi.fn().mockResolvedValue(embedding),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => embedding)),
  };
}

function makeSemanticStore(overrides: Partial<SemanticVectorStore> = {}): SemanticVectorStore {
  return {
    isConfigured: true,
    namespace: "test",
    delete: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ mode: "online" }),
    logStatus: vi.fn().mockResolvedValue({ mode: "online" }),
    searchKnowledge: vi.fn().mockResolvedValue([
      {
        id: "semantic-7-laws",
        text: "7 laws of gold: protect principal and avoid risky schemes.",
        source: "memory",
        score: 0.94,
        vectorScore: 0.94,
      },
    ]),
    searchMessages: vi.fn().mockResolvedValue([]),
    upsertKnowledge: vi.fn().mockResolvedValue(undefined),
    upsertMessages: vi.fn().mockResolvedValue(undefined),
    deleteMessages: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Semantic vector memory", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns semantic Upstash results when keyword search would miss related wording", async () => {
    const vectorStore = makeSemanticStore();
    const search = new HybridSearch(db, false, vectorStore);

    const results = await search.searchKnowledge("how to manage risk in TON?", [0.1, 0.2, 0.3], {
      limit: 5,
    });

    expect(results.map((r) => r.id)).toContain("semantic-7-laws");
    expect(vectorStore.searchKnowledge).toHaveBeenCalledWith([0.1, 0.2, 0.3], 15);
  });

  it("falls back to local keyword memory when semantic vector search fails", async () => {
    insertKnowledge(db, "local-risk", "risk fallback keyword local memory");
    const vectorStore = makeSemanticStore({
      searchKnowledge: vi.fn().mockRejectedValue(new Error("upstash offline")),
    });
    const search = new HybridSearch(db, false, vectorStore);

    const results = await search.searchKnowledge("risk fallback keyword", [0.1, 0.2, 0.3], {
      limit: 5,
    });

    expect(results.map((r) => r.id)).toContain("local-risk");
  });

  it("returns message matches served only from the semantic store", async () => {
    const vectorStore = makeSemanticStore({
      searchMessages: vi.fn().mockResolvedValue([
        {
          id: "m1",
          text: "remote-only content",
          source: "chat-remote",
          score: 0.91,
          vectorScore: 0.91,
        },
      ]),
    });
    const search = new HybridSearch(db, false, vectorStore);

    const results = await search.searchMessages("remote-only content", [0.1, 0.2, 0.3], {
      limit: 5,
    });

    expect(results.map((r) => r.id)).toContain("m1");
    expect(vectorStore.searchMessages).toHaveBeenCalledWith([0.1, 0.2, 0.3], 15, {
      chatId: undefined,
      afterTimestamp: undefined,
    });
  });

  it("forwards chatId and afterTimestamp filters to the semantic message search", async () => {
    const vectorStore = makeSemanticStore({
      searchMessages: vi.fn().mockResolvedValue([]),
    });
    const search = new HybridSearch(db, false, vectorStore);

    await search.searchMessages("anything", [0.1, 0.2, 0.3], {
      chatId: "chat-7",
      afterTimestamp: 1700000000,
      limit: 4,
    });

    expect(vectorStore.searchMessages).toHaveBeenCalledWith([0.1, 0.2, 0.3], 12, {
      chatId: "chat-7",
      afterTimestamp: 1700000000,
    });
  });

  it("falls back to local keyword message search when semantic vector search fails", async () => {
    insertMessageRow(db, "local-msg", "chat-local", "risk fallback keyword local message");
    const vectorStore = makeSemanticStore({
      searchMessages: vi.fn().mockRejectedValue(new Error("upstash offline")),
    });
    const search = new HybridSearch(db, false, vectorStore);

    const results = await search.searchMessages("risk fallback keyword", [0.1, 0.2, 0.3], {
      limit: 5,
    });

    expect(results.map((r) => r.id)).toContain("local-msg");
  });

  it("dual-writes stored messages to the semantic vector store", async () => {
    const embedder = makeEmbedder([0.3, 0.6, 0.9]);
    const vectorStore = makeSemanticStore();
    const store = new MessageStore(db, embedder, false, undefined, vectorStore);

    await store.storeMessage({
      id: "msg-sync-1",
      chatId: "chat-sync",
      senderId: "user-1",
      text: "dual write me to upstash",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 1700000123,
    });

    expect(embedder.embedQuery).toHaveBeenCalledWith("dual write me to upstash");
    expect(vectorStore.upsertMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "msg-sync-1",
          text: "dual write me to upstash",
          vector: [0.3, 0.6, 0.9],
          metadata: expect.objectContaining({
            chatId: "chat-sync",
            timestamp: 1700000123,
          }),
        }),
      ])
    );
  });

  it("does not call the semantic store when message sync has no embedding", async () => {
    const embedder = makeEmbedder([]);
    const vectorStore = makeSemanticStore();
    const store = new MessageStore(db, embedder, false, undefined, vectorStore);

    await store.storeMessage({
      id: "msg-sync-2",
      chatId: "chat-sync",
      senderId: "user-1",
      text: "no embedding available",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 1700000200,
    });

    expect(vectorStore.upsertMessages).not.toHaveBeenCalled();
  });

  it("memory_search uses the shared embedder and semantic vector store when available", async () => {
    const embedder = makeEmbedder([0.5, 0.25, 0.125]);
    const vectorStore = makeSemanticStore();
    const context = {
      bridge: {},
      db,
      chatId: "chat-1",
      senderId: 1,
      isGroup: false,
      semanticMemory: {
        embedder,
        vectorEnabled: false,
        vectorStore,
      },
    } as unknown as ToolContext;

    const result = await memorySearchExecutor({ query: "how do I avoid loss?", limit: 3 }, context);

    expect(result.success).toBe(true);
    expect(embedder.embedQuery).toHaveBeenCalledWith("how do I avoid loss?");
    expect(vectorStore.searchKnowledge).toHaveBeenCalledWith([0.5, 0.25, 0.125], 9);
    expect(JSON.stringify(result.data)).toContain("7 laws of gold");
  });

  it("knowledge indexing dual-writes local chunks to the semantic vector store", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "teleton-memory-"));
    const memoryFile = join(workspaceDir, "MEMORY.md");
    writeFileSync(memoryFile, "# Memory\n\nRemember the 10% rule for conservative risk.");

    const embedder = makeEmbedder([0.7, 0.8, 0.9]);
    const vectorStore = makeSemanticStore();
    const indexer = new KnowledgeIndexer(db, workspaceDir, embedder, false, vectorStore);

    const result = await indexer.indexAll();
    const rows = db.prepare("SELECT text FROM knowledge").all() as Array<{ text: string }>;

    expect(result.indexed).toBe(1);
    expect(rows.map((r) => r.text).join("\n")).toContain("10% rule");
    expect(vectorStore.upsertKnowledge).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("10% rule"),
          vector: [0.7, 0.8, 0.9],
        }),
      ])
    );

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("reports semantic vector sync failures when Upstash rejects an upsert", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "teleton-memory-"));
    const memoryFile = join(workspaceDir, "MEMORY.md");
    writeFileSync(memoryFile, "# Memory\n\nRemember the 10% rule for conservative risk.");

    const embedder = makeEmbedder([0.7, 0.8, 0.9]);
    const vectorStore = makeSemanticStore({
      upsertKnowledge: vi.fn().mockRejectedValue(new Error("dimension mismatch")),
    });
    const indexer = new KnowledgeIndexer(db, workspaceDir, embedder, false, vectorStore);

    const result = await indexer.indexAll();

    expect(result.indexed).toBe(1);
    expect(result.semantic.upserted).toBe(0);
    expect(result.semantic.failed).toBe(1);
    expect(result.semantic.errors.join("\n")).toContain("dimension mismatch");
    expect(result.semantic.errors.join("\n")).toMatch(/reprovision the Upstash index/i);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("detects Upstash index dimension mismatch before attempting upsert", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "teleton-memory-"));
    const memoryFile = join(workspaceDir, "MEMORY.md");
    writeFileSync(memoryFile, "# Memory\n\nRemember the 10% rule for conservative risk.");

    // Local all-MiniLM-L6-v2 produces 384-dim vectors; the user's Upstash
    // index is configured for 768. Repro for issue #246.
    const embedder = makeEmbedder(new Array(384).fill(0.001));
    const upsertKnowledge = vi.fn().mockResolvedValue(undefined);
    const vectorStore = makeSemanticStore({
      healthCheck: vi.fn().mockResolvedValue({ mode: "online", indexDimension: 768 }),
      upsertKnowledge,
    });
    const indexer = new KnowledgeIndexer(db, workspaceDir, embedder, false, vectorStore);

    const result = await indexer.indexAll();

    expect(result.indexed).toBe(1);
    expect(result.semantic.upserted).toBe(0);
    expect(result.semantic.failed).toBe(1);
    expect(upsertKnowledge).not.toHaveBeenCalled();
    const message = result.semantic.errors.join("\n");
    expect(message).toContain("384");
    expect(message).toContain("768");
    expect(message).toMatch(/dimension/i);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("surfaces the Upstash index dimension in the semantic memory status", async () => {
    const upstashInfoPayload = {
      vectorCount: 42,
      pendingVectorCount: 0,
      indexSize: 0,
      dimension: 768,
      similarityFunction: "COSINE" as const,
      namespaces: {},
    };
    const store = new UpstashSemanticVectorStore({
      url: "https://steady-fox-123.upstash.io",
      token: "upstash-token-12345",
    });

    // Swap in a stubbed Upstash index to avoid live HTTP.
    const fakeIndex = { info: vi.fn().mockResolvedValue(upstashInfoPayload) };
    (store as unknown as { index: typeof fakeIndex }).index = fakeIndex;

    const status = await store.healthCheck();

    expect(status.mode).toBe("online");
    expect(status.indexDimension).toBe(768);
    expect(fakeIndex.info).toHaveBeenCalled();
  });

  it("reports semantic vector sync failures when embeddings are disabled", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "teleton-memory-"));
    const memoryFile = join(workspaceDir, "MEMORY.md");
    writeFileSync(memoryFile, "# Memory\n\nRemember the 10% rule for conservative risk.");

    const embedder = makeEmbedder([]);
    const vectorStore = makeSemanticStore();
    const indexer = new KnowledgeIndexer(db, workspaceDir, embedder, false, vectorStore);

    const result = await indexer.indexAll();

    expect(result.indexed).toBe(1);
    expect(result.semantic.upserted).toBe(0);
    expect(result.semantic.failed).toBe(1);
    expect(result.semantic.errors.join("\n")).toContain("Embedding provider returned no vectors");
    expect(vectorStore.upsertKnowledge).not.toHaveBeenCalled();

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("reconfigures the Upstash vector store at runtime", () => {
    const store = new UpstashSemanticVectorStore({
      url: "https://steady-fox-123.upstash.io",
      token: "upstash-token-12345",
      namespace: "custom-memory",
    });

    expect(store.isConfigured).toBe(true);
    expect(store.namespace).toBe("custom-memory");

    store.configure({});

    expect(store.isConfigured).toBe(false);
    expect(store.namespace).toBe("teleton-memory");
  });

  it("reports standby when Upstash vector memory is not configured", async () => {
    const store = new UpstashSemanticVectorStore({});

    const status = await store.healthCheck();

    expect(store.isConfigured).toBe(false);
    expect(status.mode).toBe("standby");
    expect(status.reason).toContain("not configured");
  });
});
