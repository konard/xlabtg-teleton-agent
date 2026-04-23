import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { stripSqlComments } from "../index.js";
import { createPluginSDK, type SDKDependencies } from "../index.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  return db;
}

function createSafeDbViaSDK(db: Database.Database) {
  const mockBridge = { isAvailable: () => false, getClient: () => null } as any;
  const deps: SDKDependencies = { bridge: mockBridge };
  const sdk = createPluginSDK(deps, {
    pluginName: "test-plugin",
    db,
    sanitizedConfig: {},
    pluginConfig: {},
  });
  return sdk.db!;
}

describe("stripSqlComments", () => {
  it("strips block comments", () => {
    expect(stripSqlComments("SELECT /* comment */ 1")).toBe("SELECT   1");
  });

  it("strips line comments", () => {
    expect(stripSqlComments("SELECT 1 -- comment\nFROM t")).toBe("SELECT 1  \nFROM t");
  });

  it("strips nested-looking block comments", () => {
    expect(stripSqlComments("AT/* */TACH DATABASE")).toBe("AT TACH DATABASE");
  });

  it("preserves normal SQL", () => {
    expect(stripSqlComments("SELECT * FROM users WHERE id = 1")).toBe(
      "SELECT * FROM users WHERE id = 1"
    );
  });
});

describe("createSafeDb — allow-list: exposed methods", () => {
  it("exposes prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(typeof (safe as any).prepare).toBe("function");
  });

  it("exposes transaction", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(typeof (safe as any).transaction).toBe("function");
  });

  it("exposes inTransaction (read-only boolean)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(typeof (safe as any).inTransaction).toBe("boolean");
  });

  it("close() is a no-op and does not throw", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => (safe as any).close()).not.toThrow();
    // underlying db must still be open
    expect(() => db.exec("SELECT 1")).not.toThrow();
  });
});

describe("createSafeDb — allow-list: blocked methods", () => {
  it("loadExtension is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).loadExtension).toBeUndefined();
  });

  it("backup is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).backup).toBeUndefined();
  });

  it("serialize is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).serialize).toBeUndefined();
  });

  it("function (UDF registration) is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).function).toBeUndefined();
  });

  it("pragma method is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).pragma).toBeUndefined();
  });

  it("exec is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).exec).toBeUndefined();
  });

  it("aggregate is not accessible (returns undefined)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect((safe as any).aggregate).toBeUndefined();
  });
});

describe("createSafeDb — SQL denylist via prepare", () => {
  it("blocks ATTACH DATABASE via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("ATTACH DATABASE ':memory:' AS ext")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("blocks DETACH DATABASE via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("DETACH DATABASE ext")).toThrow("not allowed in plugin context");
  });

  it("blocks PRAGMA via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("PRAGMA foreign_keys = OFF")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("blocks VACUUM via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("VACUUM")).toThrow("not allowed in plugin context");
  });

  it("blocks ALTER TABLE via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("ALTER TABLE test ADD COLUMN extra TEXT")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("blocks case variations (lowercase attach database)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("attach database ':memory:' as ext")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("blocks ATTACH with block comment bypass", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("ATTACH /* bypass */ DATABASE ':memory:' AS ext")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("blocks PRAGMA with line comment bypass", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("-- harmless\nPRAGMA journal_mode = WAL")).toThrow(
      "not allowed in plugin context"
    );
  });

  it("does not match ATTACH split across block comment (SQLite also rejects it)", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    // AT/**/TACH becomes "AT TACH" after stripping — doesn't match \bATTACH\b
    // Our guard lets it through, but SQLite itself rejects "AT TACH" as invalid SQL
    expect(() => safe.prepare("AT/**/TACH DATABASE ':memory:' AS ext")).toThrow();
  });

  // ─── Allowed SQL ──────────────────────────────────────────

  it("allows normal SELECT via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    const stmt = safe.prepare("SELECT * FROM test");
    expect(stmt.all()).toEqual([]);
  });

  it("allows INSERT via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() => safe.prepare("INSERT INTO test (name) VALUES ('hello')")).not.toThrow();
  });

  it("allows CREATE TABLE via prepare", () => {
    const safe = createSafeDbViaSDK(createTestDb());
    expect(() =>
      safe.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
    ).not.toThrow();
  });

  it("transaction helper works end-to-end", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    const insert = safe.prepare("INSERT INTO test (name) VALUES (?)");
    const tx = (safe as any).transaction((name: string) => insert.run(name));
    expect(() => tx("alice")).not.toThrow();
    const rows = db.prepare("SELECT name FROM test").all();
    expect(rows).toEqual([{ name: "alice" }]);
  });
});
