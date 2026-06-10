import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryDatabase } from "../database.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MemoryDatabase vector dimensions (issue #537)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function vecTableSql(db: MemoryDatabase, table: string): string {
    return (
      db.getDb().prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as {
        sql: string;
      }
    ).sql;
  }

  it("creates vec0 tables at the configured dimension (non-384 provider)", () => {
    dir = mkdtempSync(join(tmpdir(), "teleton-db-"));
    const db = new MemoryDatabase({
      path: join(dir, "memory.db"),
      enableVectorSearch: true,
      vectorDimensions: 1024, // e.g. Voyage voyage-3 (1024), not the local 384
    });
    try {
      if (!db.isVectorSearchReady()) return; // sqlite-vec unavailable

      expect(vecTableSql(db, "tg_messages_vec")).toContain("[1024]");
      expect(vecTableSql(db, "knowledge_vec")).toContain("[1024]");
      expect(db.getVectorDimensions()).toBe(1024);
    } finally {
      db.close();
    }
  });
});
