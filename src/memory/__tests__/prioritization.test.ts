import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MemoryScorer } from "../scoring.js";
import { MemoryRetentionService } from "../retention.js";
import { MemoryGraphStore } from "../graph-store.js";

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
});
