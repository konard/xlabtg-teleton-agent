import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MemoryScorer } from "../scoring.js";
import { MAX_BOOST_AMOUNT } from "../../constants/limits.js";

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function insertKnowledge(db: InstanceType<typeof Database>, id: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO knowledge (id, source, text, hash, created_at, updated_at)
     VALUES (?, 'memory', ?, ?, ?, ?)`
  ).run(id, `text-${id}`, `hash-${id}`, now, now);
}

describe("MemoryScorer — boost amount clamping (WORK6-015)", () => {
  let db: InstanceType<typeof Database>;
  let scorer: MemoryScorer;

  beforeEach(() => {
    db = createDb();
    insertKnowledge(db, "m1");
    scorer = new MemoryScorer(db);
  });

  it("clamps an out-of-range boostImpact amount to MAX_BOOST_AMOUNT", () => {
    scorer.boostImpact(["m1"], 1e9);
    const row = db
      .prepare("SELECT impact_count FROM memory_scores WHERE memory_id = ?")
      .get("m1") as { impact_count: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.impact_count).toBeLessThanOrEqual(MAX_BOOST_AMOUNT);
  });

  it("clamps an out-of-range recordAccess amount to MAX_BOOST_AMOUNT", () => {
    scorer.recordAccess(["m1"], 1e9);
    const row = db
      .prepare("SELECT access_count FROM memory_scores WHERE memory_id = ?")
      .get("m1") as { access_count: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.access_count).toBeLessThanOrEqual(MAX_BOOST_AMOUNT);
  });

  it("applies the full amount when within bounds", () => {
    scorer.boostImpact(["m1"], 50);
    const row = db
      .prepare("SELECT impact_count FROM memory_scores WHERE memory_id = ?")
      .get("m1") as { impact_count: number } | undefined;
    expect(row!.impact_count).toBe(50);
  });

  it("treats non-finite boostImpact amount as minimum 1", () => {
    scorer.boostImpact(["m1"], NaN);
    const row = db
      .prepare("SELECT impact_count FROM memory_scores WHERE memory_id = ?")
      .get("m1") as { impact_count: number } | undefined;
    expect(row!.impact_count).toBe(1);
  });

  it("treats negative boostImpact amount as minimum 1", () => {
    scorer.boostImpact(["m1"], -5);
    const row = db
      .prepare("SELECT impact_count FROM memory_scores WHERE memory_id = ?")
      .get("m1") as { impact_count: number } | undefined;
    expect(row!.impact_count).toBe(1);
  });
});
