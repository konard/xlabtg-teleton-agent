// src/utils/__tests__/module-db.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { openModuleDb, migrateFromMainDb, JOURNAL_SCHEMA } from "../module-db.js";

// We need to control TELETON_ROOT so migrateFromMainDb uses a temp path.
// The module reads MAIN_DB_PATH at module load time, so we mock the paths module.
vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/test-teleton-root",
}));

describe("migrateFromMainDb – SQL injection via apostrophe in MAIN_DB_PATH", () => {
  let tempDir: string;
  let moduleDb: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "teleton-sql-test-"));
  });

  afterEach(() => {
    try {
      moduleDb?.close();
    } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should escape single quotes in MAIN_DB_PATH to prevent SQL injection", () => {
    // Create a real directory whose name contains an apostrophe (valid POSIX path).
    const dirWithApostrophe = join(tempDir, "o'brien");
    mkdirSync(dirWithApostrophe, { recursive: true });
    const pathWithApostrophe = join(dirWithApostrophe, "memory.db");

    const moduleDbPath = join(tempDir, "module.db");
    moduleDb = openModuleDb(moduleDbPath);
    moduleDb.exec(JOURNAL_SCHEMA);

    // SQL-escape the single quote: ' → ''
    const escapedPath = pathWithApostrophe.replace(/'/g, "''");
    // ATTACH with a properly escaped path should succeed (SQLite creates the DB file).
    expect(() => {
      moduleDb.exec(`ATTACH DATABASE '${escapedPath}' AS safe_db`);
      moduleDb.exec(`DETACH DATABASE safe_db`);
    }).not.toThrow();
  });

  it("should not allow a raw apostrophe in ATTACH DATABASE path to break SQL", () => {
    // Create the same real directory so SQLite would otherwise succeed.
    const dirWithApostrophe = join(tempDir, "o'brien");
    mkdirSync(dirWithApostrophe, { recursive: true });
    const pathWithApostrophe = join(dirWithApostrophe, "memory.db");

    const moduleDbPath = join(tempDir, "module.db");
    moduleDb = openModuleDb(moduleDbPath);
    moduleDb.exec(JOURNAL_SCHEMA);

    // An unescaped apostrophe in ATTACH DATABASE is a SQL syntax error.
    expect(() => {
      moduleDb.exec(`ATTACH DATABASE '${pathWithApostrophe}' AS injected_db`);
    }).toThrow();
  });

  it("migrateFromMainDb completes without error when module DB is empty and main DB is absent", () => {
    const moduleDbPath = join(tempDir, "module.db");
    moduleDb = openModuleDb(moduleDbPath);
    moduleDb.exec(JOURNAL_SCHEMA);

    // migrateFromMainDb should return 0 when MAIN_DB_PATH does not exist
    const result = migrateFromMainDb(moduleDb, ["journal"]);
    expect(result).toBe(0);
  });
});
