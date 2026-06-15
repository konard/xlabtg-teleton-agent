import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MemoryScorer } from "../scoring.js";
import { MemoryRetentionService } from "../retention.js";
import { MemoryGraphStore } from "../graph-store.js";
import type { SemanticVectorStore } from "../vector-store.js";

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function insertKnowledge(
  db: InstanceType<typeof Database>,
  id: string,
  text: string,
  createdAt = Math.floor(Date.now() / 1000)
): void {
  db.prepare(
    `
    INSERT INTO knowledge (id, source, text, hash, created_at, updated_at)
    VALUES (?, 'memory', ?, ?, ?, ?)
  `
  ).run(id, text, `hash-${id}`, createdAt, createdAt);
}

function ensureFeedVectorTable(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tg_messages_vec (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);
}

function insertFeedMessage(
  db: InstanceType<typeof Database>,
  id: string,
  text: string,
  timestamp: number,
  chatId = "chat-retention"
): void {
  db.prepare(`INSERT OR IGNORE INTO tg_chats (id, type, is_monitored) VALUES (?, 'dm', 1)`).run(
    chatId
  );
  db.prepare(
    `
    INSERT INTO tg_messages (
      id,
      chat_id,
      sender_id,
      text,
      embedding,
      is_from_agent,
      has_media,
      timestamp
    )
    VALUES (?, ?, NULL, ?, NULL, 0, 0, ?)
  `
  ).run(id, chatId, text, timestamp);
  db.prepare(`INSERT INTO tg_messages_vec (id, embedding) VALUES (?, ?)`).run(
    id,
    Buffer.from("vector")
  );
}

function countFeedRows(db: InstanceType<typeof Database>, table: string, id: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE id = ?`).get(id) as { c: number }).c;
}

function searchFeedToken(db: InstanceType<typeof Database>, token: string): Array<{ id: string }> {
  return db
    .prepare(
      `
      SELECT m.id
      FROM tg_messages_fts mf
      JOIN tg_messages m ON m.rowid = mf.rowid
      WHERE tg_messages_fts MATCH ?
    `
    )
    .all(token) as Array<{ id: string }>;
}

function createSemanticVectorStore(
  deleteRemote: (ids: string[]) => Promise<void>
): SemanticVectorStore {
  return {
    isConfigured: true,
    namespace: "test-namespace",
    healthCheck: vi.fn(async () => ({ mode: "online" })),
    logStatus: vi.fn(async () => ({ mode: "online" })),
    searchKnowledge: vi.fn(async () => []),
    searchMessages: vi.fn(async () => []),
    upsertKnowledge: vi.fn(async () => undefined),
    upsertMessages: vi.fn(async () => undefined),
    delete: deleteRemote,
    deleteMessages: vi.fn(async () => undefined),
  };
}

describe("memory prioritization", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates score, archive, and cleanup history tables", () => {
    const tables = db
      .prepare(
        `
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);

    expect(names).toContain("memory_scores");
    expect(names).toContain("memory_archive");
    expect(names).toContain("pending_remote_vector_deletions");
    expect(names).toContain("memory_cleanup_history");
  });

  it("calculates normalized scores from recency, frequency, impact, explicit markers, and graph centrality", () => {
    const scorer = new MemoryScorer(db, {
      weights: {
        recency: 0.2,
        frequency: 0.2,
        impact: 0.2,
        explicit: 0.2,
        centrality: 0.2,
      },
      recency_half_life_days: 30,
    });
    insertKnowledge(db, "plain", "casual note about lunch");
    insertKnowledge(db, "important", "remember this wallet recovery decision about TON");

    const graph = new MemoryGraphStore(db);
    const entity = graph.upsertNode({ type: "entity", label: "TON" });
    const topic = graph.upsertNode({ type: "topic", label: "wallet recovery" });
    graph.upsertEdge({ sourceId: entity.id, targetId: topic.id, relation: "RELATED_TO" });

    scorer.recordAccess(["important"]);
    scorer.boostImpact(["important"]);
    const result = scorer.recalculateAll();

    expect(result.scored).toBe(2);
    const important = scorer.getScore("important");
    const plain = scorer.getScore("plain");

    expect(important).not.toBeNull();
    expect(plain).not.toBeNull();
    expect(important!.score).toBeGreaterThan(plain!.score);
    expect(important!.explicit).toBe(1);
    expect(important!.frequency).toBeGreaterThan(0);
    expect(important!.impact).toBeGreaterThan(0);
    expect(important!.centrality).toBeGreaterThan(0);
    expect(important!.score).toBeGreaterThanOrEqual(0);
    expect(important!.score).toBeLessThanOrEqual(1);
  });

  it("does not recalculate all scores on getStats", () => {
    insertKnowledge(db, "plain", "casual note about lunch");
    insertKnowledge(db, "important", "remember this wallet recovery decision about TON");

    const scorer = new MemoryScorer(db);
    // Persist scores once so getStats has data to read.
    scorer.recalculateAll();

    const recalculateAll = vi.spyOn(scorer, "recalculateAll");
    const recalculate = vi.spyOn(scorer, "recalculate");

    const stats = scorer.getStats();

    expect(recalculateAll).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
    expect(stats.total).toBe(2);
  });

  it("archives low-value cleanup candidates and protects pinned memories", async () => {
    const old = Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60;
    insertKnowledge(db, "old-low", "stale casual note", old);
    insertKnowledge(db, "pinned-old", "remember this pinned decision", old);

    const scorer = new MemoryScorer(db);
    scorer.pinMemory("pinned-old", true);
    scorer.recalculateAll();

    const retention = new MemoryRetentionService(db, {
      min_score: 0.95,
      max_age_days: 90,
      max_entries: 100,
      archive_days: 14,
    });

    const dryRun = await retention.cleanup({ dryRun: true });
    expect(dryRun.archived).toBe(0);
    expect(dryRun.candidates.map((candidate) => candidate.id)).toContain("old-low");
    expect(dryRun.candidates.map((candidate) => candidate.id)).not.toContain("pinned-old");

    const cleanup = await retention.cleanup({ dryRun: false });
    expect(cleanup.archived).toBe(1);
    expect(db.prepare("SELECT id FROM knowledge WHERE id = 'old-low'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM knowledge WHERE id = 'pinned-old'").get()).toBeDefined();
    expect(
      db.prepare("SELECT memory_id FROM memory_archive WHERE memory_id = 'old-low'").get()
    ).toBeDefined();
  });

  it("persists and retries failed remote vector deletes after archive", async () => {
    const old = Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60;
    insertKnowledge(db, "remote-stale", "stale semantic memory", old);

    const deleteRemote = vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const vectorStore = createSemanticVectorStore(deleteRemote);

    const retention = new MemoryRetentionService(
      db,
      {
        min_score: 0.95,
        max_age_days: 90,
        max_entries: 100,
        archive_days: 14,
      },
      undefined,
      vectorStore
    );

    const cleanup = await retention.cleanup({ dryRun: false });

    expect(cleanup.archived).toBe(1);
    expect(deleteRemote).toHaveBeenCalledWith(["remote-stale"]);
    expect(retention.getPendingRemoteVectorDeletions().map((entry) => entry.memoryId)).toContain(
      "remote-stale"
    );

    await retention.cleanup({ dryRun: false });

    expect(deleteRemote).toHaveBeenCalledTimes(2);
    expect(deleteRemote).toHaveBeenLastCalledWith(["remote-stale"]);
    expect(retention.getPendingRemoteVectorDeletions()).toHaveLength(0);
  });

  it("prunes feed messages older than the configured window with vectors and FTS postings", async () => {
    ensureFeedVectorTable(db);
    const now = Math.floor(Date.now() / 1000);
    insertFeedMessage(db, "feed-old", "oldtoken stale feed row", now - 40 * 24 * 60 * 60);
    insertFeedMessage(db, "feed-new", "newtoken recent feed row", now - 2 * 24 * 60 * 60);

    const retention = new MemoryRetentionService(db, {}, undefined, undefined, {
      retention_days: 30,
      max_messages: 100,
    });

    const result = await retention.pruneFeedMessages(now);

    expect(result.deleted).toBe(1);
    expect(countFeedRows(db, "tg_messages", "feed-old")).toBe(0);
    expect(countFeedRows(db, "tg_messages_vec", "feed-old")).toBe(0);
    expect(searchFeedToken(db, "oldtoken")).toHaveLength(0);
    expect(countFeedRows(db, "tg_messages", "feed-new")).toBe(1);
    expect(countFeedRows(db, "tg_messages_vec", "feed-new")).toBe(1);
    expect(searchFeedToken(db, "newtoken")).toEqual([{ id: "feed-new" }]);
  });

  it("prunes feed overflow by keeping the newest configured number of messages", async () => {
    ensureFeedVectorTable(db);
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 5; i++) {
      insertFeedMessage(db, `feed-${i}`, `token${i} feed row`, now - (5 - i));
    }

    const retention = new MemoryRetentionService(db, {}, undefined, undefined, {
      retention_days: 365,
      max_messages: 3,
    });

    const result = await retention.pruneFeedMessages(now);
    const remaining = db
      .prepare(`SELECT id FROM tg_messages ORDER BY timestamp ASC`)
      .all() as Array<{ id: string }>;

    expect(result.deleted).toBe(2);
    expect(remaining.map((row) => row.id)).toEqual(["feed-3", "feed-4", "feed-5"]);
    expect(countFeedRows(db, "tg_messages_vec", "feed-1")).toBe(0);
    expect(countFeedRows(db, "tg_messages_vec", "feed-2")).toBe(0);
    expect(searchFeedToken(db, "token1")).toHaveLength(0);
    expect(searchFeedToken(db, "token5")).toEqual([{ id: "feed-5" }]);
  });
});
