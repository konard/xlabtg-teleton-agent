import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureSchema, ensureVectorTables } from "../../schema.js";
import { KnowledgeIndexer } from "../knowledge.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function vectorOfDim(dim: number, fill = 0.1): number[] {
  return new Array(dim).fill(fill);
}

/** Embedder that returns the same vector for every chunk. */
function makeEmbedder(vector: number[]): EmbeddingProvider {
  return {
    id: "mock",
    model: "mock-model",
    dimensions: vector.length,
    embedQuery: vi.fn().mockResolvedValue(vector),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => vector)),
  };
}

/**
 * In-memory DB with sqlite-vec loaded and vec0 tables at the given dimension.
 * Returns null when sqlite-vec is unavailable in the environment.
 */
function createVectorDb(dimensions: number): InstanceType<typeof Database> | null {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  try {
    sqliteVec.load(db);
    ensureVectorTables(db, dimensions);
  } catch {
    db.close();
    return null;
  }
  return db;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("KnowledgeIndexer vector isolation (issue #537)", () => {
  let workspace: string;
  let mdPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "teleton-knowledge-"));
    mdPath = join(workspace, "note.md");
    writeFileSync(mdPath, "# Title\n\nSome knowledge content to embed and store.");
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("does not drop knowledge rows when the vector insert fails (dimension mismatch)", async () => {
    // vec0 table expects 1024 dims, embedder emits 384 → vec insert fails.
    const vdb = createVectorDb(1024);
    if (!vdb) return; // sqlite-vec unavailable in this environment
    try {
      const indexer = new KnowledgeIndexer(vdb, workspace, makeEmbedder(vectorOfDim(384)), true);

      const result = await indexer.indexFile(mdPath, true);
      expect(result.indexed).toBe(true);

      const rowCount = (
        vdb.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE source='memory'").get() as {
          c: number;
        }
      ).c;
      const vecCount = (
        vdb.prepare("SELECT COUNT(*) AS c FROM knowledge_vec").get() as { c: number }
      ).c;
      expect(rowCount).toBeGreaterThan(0); // rows preserved despite vec failure
      expect(vecCount).toBe(0); // vectors degraded, not inserted
    } finally {
      vdb.close();
    }
  });

  it("does not drop knowledge rows when the embedder throws", async () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    try {
      const throwingEmbedder: EmbeddingProvider = {
        id: "mock",
        model: "mock-model",
        dimensions: 1024,
        embedQuery: vi.fn().mockResolvedValue([]),
        embedBatch: vi.fn().mockRejectedValue(new Error("provider down")),
      };
      const indexer = new KnowledgeIndexer(db, workspace, throwingEmbedder, false);

      const result = await indexer.indexFile(mdPath, true);
      expect(result.indexed).toBe(true);

      const rowCount = (
        db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE source='memory'").get() as {
          c: number;
        }
      ).c;
      expect(rowCount).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("stores knowledge rows and vectors for a non-384-dim provider (Voyage 1024)", async () => {
    const vdb = createVectorDb(1024);
    if (!vdb) return;
    try {
      const indexer = new KnowledgeIndexer(vdb, workspace, makeEmbedder(vectorOfDim(1024)), true);

      await indexer.indexFile(mdPath, true);

      const rowCount = (
        vdb.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE source='memory'").get() as {
          c: number;
        }
      ).c;
      const vecCount = (
        vdb.prepare("SELECT COUNT(*) AS c FROM knowledge_vec").get() as { c: number }
      ).c;
      expect(rowCount).toBeGreaterThan(0);
      expect(vecCount).toBe(rowCount); // every chunk got a vector
    } finally {
      vdb.close();
    }
  });
});
