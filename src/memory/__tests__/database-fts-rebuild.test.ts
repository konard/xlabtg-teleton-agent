import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryDatabase } from "../database.js";

describe("MemoryDatabase FTS rebuild", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createMemoryDatabase(): MemoryDatabase {
    tempDir = mkdtempSync(join(tmpdir(), "teleton-fts-"));
    return new MemoryDatabase({
      path: join(tempDir, "memory.sqlite"),
      enableVectorSearch: false,
    });
  }

  it("rebuildFtsIndexes removes stale tg_messages postings left by legacy REPLACE upserts", () => {
    const memoryDb = createMemoryDatabase();
    try {
      const db = memoryDb.getDb();
      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('chat1', 'dm')`).run();
      db.prepare(
        `INSERT INTO tg_messages (id, chat_id, text, timestamp)
         VALUES ('msg1', 'chat1', 'oldtoken message', 1000)`
      ).run();
      db.prepare(
        `INSERT OR REPLACE INTO tg_messages (id, chat_id, text, timestamp)
         VALUES ('msg1', 'chat1', 'newtoken message', 2000)`
      ).run();

      const staleBefore = db
        .prepare(
          `
          SELECT mf.rowid AS fts_rowid, m.id
          FROM tg_messages_fts mf
          LEFT JOIN tg_messages m ON m.rowid = mf.rowid
          WHERE tg_messages_fts MATCH 'oldtoken'
        `
        )
        .all();

      expect(staleBefore).toHaveLength(1);

      const result = memoryDb.rebuildFtsIndexes();

      const staleAfter = db
        .prepare(
          `
          SELECT mf.rowid AS fts_rowid, m.id
          FROM tg_messages_fts mf
          LEFT JOIN tg_messages m ON m.rowid = mf.rowid
          WHERE tg_messages_fts MATCH 'oldtoken'
        `
        )
        .all();
      const freshAfter = db
        .prepare(
          `
          SELECT m.id, m.text
          FROM tg_messages_fts mf
          JOIN tg_messages m ON m.rowid = mf.rowid
          WHERE tg_messages_fts MATCH 'newtoken'
        `
        )
        .all();

      expect(result).toEqual({ knowledge: 0, messages: 1 });
      expect(staleAfter).toHaveLength(0);
      expect(freshAfter).toEqual([{ id: "msg1", text: "newtoken message" }]);
    } finally {
      memoryDb.close();
    }
  });
});
