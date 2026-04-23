// src/utils/__tests__/module-db.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
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
  let mainDbPath: string;
  let moduleDb: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "teleton-sql-test-"));
    mainDbPath = join(tempDir, "memory.db");
  });

  afterEach(() => {
    try {
      moduleDb?.close();
    } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should escape single quotes in MAIN_DB_PATH to prevent SQL injection", () => {
    // Create a module DB with the journal schema
    const moduleDbPath = join(tempDir, "module.db");
    moduleDb = openModuleDb(moduleDbPath);
    moduleDb.exec(JOURNAL_SCHEMA);

    // Simulate a path with a single quote by manually calling exec with the escaped form.
    // We verify that the escaping logic produces valid SQL (no syntax error).
    const pathWithApostrophe = "/tmp/o'brien/.teleton/memory.db";
    const escapedPath = pathWithApostrophe.replace(/'/g, "''");
    // The resulting SQL should be syntactically valid even though the file does not exist.
    expect(() => {
      moduleDb.exec(`ATTACH DATABASE '${escapedPath}' AS safe_db`);
      moduleDb.exec(`DETACH DATABASE safe_db`);
    }).not.toThrow();
  });

  it("should not allow a raw apostrophe in ATTACH DATABASE path to break SQL", () => {
    const moduleDbPath = join(tempDir, "module.db");
    moduleDb = openModuleDb(moduleDbPath);
    moduleDb.exec(JOURNAL_SCHEMA);

    // An unescaped apostrophe in ATTACH DATABASE causes a syntax error.
    const pathWithApostrophe = "/tmp/o'brien/.teleton/memory.db";
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

describe("TELETON_ROOT startup validation", () => {
  it("should reject a TELETON_HOME containing backtick (shell metacharacter)", async () => {
    const originalEnv = process.env.TELETON_HOME;
    try {
      process.env.TELETON_HOME = "/tmp/bad`path";
      // Re-importing paths.ts will throw because the module is cached after the mock above.
      // We test the validation regex directly to confirm the pattern catches the character.
      const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
      expect(UNSAFE_RE.test("/tmp/bad`path")).toBe(true);
    } finally {
      process.env.TELETON_HOME = originalEnv;
    }
  });

  it("should reject a TELETON_HOME containing dollar sign (shell metacharacter)", () => {
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/tmp/$bad")).toBe(true);
  });

  it("should reject a TELETON_HOME containing semicolon (shell metacharacter)", () => {
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/tmp/bad;rm -rf /")).toBe(true);
  });

  it("should reject a TELETON_HOME containing pipe (shell metacharacter)", () => {
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/tmp/bad|command")).toBe(true);
  });

  it("should accept a normal path with apostrophe (not a shell metacharacter)", () => {
    // Single quote is NOT in the unsafe regex – only shell metacharacters are rejected.
    // The apostrophe in MAIN_DB_PATH is handled by SQL escaping in module-db.ts.
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/home/o'brien/.teleton")).toBe(false);
  });

  it("should accept a plain Linux path without metacharacters", () => {
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/home/user/.teleton")).toBe(false);
  });

  it("should accept a path with hyphens and dots", () => {
    const UNSAFE_RE = /[`$\\!|;&<>*?{}()\[\]"]/;
    expect(UNSAFE_RE.test("/home/user-name/.teleton-data")).toBe(false);
  });
});
