import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { rmSync, writeFileSync, existsSync } from "fs";

// vi.hoisted runs before import hoisting. Use inline requires to avoid TDZ issues.
const { tempRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");
  const root = mkdtempSync(join(tmpdir(), "teleton-migrate-test-"));
  return { tempRoot: root };
});

vi.mock("../../workspace/paths.js", () => {
  const { join } = require("path") as typeof import("path");
  return {
    TELETON_ROOT: tempRoot,
    WORKSPACE_ROOT: join(tempRoot, "workspace"),
    WORKSPACE_PATHS: {},
  };
});

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// testDb is swapped in beforeEach; the mock captures it via the closure.
let testDb: InstanceType<typeof Database>;

vi.mock("../../memory/index.js", () => ({
  getDatabase: () => ({
    getDb: () => testDb,
  }),
}));

// Import after mocks
import { join } from "path";
import { ensureSchema, runMigrations } from "../../memory/schema.js";
const { migrateSessionsToDb } = await import("../migrate.js");

const SESSIONS_JSON = join(tempRoot, "sessions.json");
const SESSIONS_JSON_BACKUP = join(tempRoot, "sessions.json.backup");

function createFreshDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  runMigrations(db);
  return db;
}

describe("migrateSessionsToDb", () => {
  beforeEach(() => {
    testDb = createFreshDb();
    if (existsSync(SESSIONS_JSON)) rmSync(SESSIONS_JSON);
    if (existsSync(SESSIONS_JSON_BACKUP)) rmSync(SESSIONS_JSON_BACKUP);
  });

  afterEach(() => {
    testDb.close();
    if (existsSync(SESSIONS_JSON)) rmSync(SESSIONS_JSON);
    if (existsSync(SESSIONS_JSON_BACKUP)) rmSync(SESSIONS_JSON_BACKUP);
  });

  afterAll(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns 0 when sessions.json does not exist", () => {
    const result = migrateSessionsToDb();
    expect(result).toBe(0);
  });

  it("migrates sessions from JSON to the SQLite database", () => {
    const now = Date.now();

    const store = {
      "telegram:100": {
        sessionId: "uuid-100",
        createdAt: now - 10000,
        updatedAt: now,
        messageCount: 5,
        lastMessageId: 42,
        lastChannel: "telegram",
        lastTo: "100",
        contextTokens: 1000,
        model: "claude-opus-4",
        provider: "anthropic",
        lastResetDate: "2024-01-16",
      },
      "telegram:200": {
        sessionId: "uuid-200",
        createdAt: now - 20000,
        updatedAt: now - 5000,
        messageCount: 12,
        lastMessageId: null,
        lastChannel: "telegram",
        lastTo: "200",
        contextTokens: null,
        model: null,
        provider: null,
        lastResetDate: null,
      },
    };

    writeFileSync(SESSIONS_JSON, JSON.stringify(store), "utf-8");

    const migrated = migrateSessionsToDb();
    expect(migrated).toBe(2);

    const rows = testDb.prepare("SELECT * FROM sessions").all() as Array<{
      id: string;
      chat_id: string;
    }>;
    expect(rows).toHaveLength(2);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain("uuid-100");
    expect(ids).toContain("uuid-200");

    const chatIds = rows.map((r) => r.chat_id);
    expect(chatIds).toContain("telegram:100");
    expect(chatIds).toContain("telegram:200");
  });

  it("maps all session fields correctly into the database", () => {
    const now = Date.now();

    const store = {
      "telegram:999": {
        sessionId: "uuid-999",
        createdAt: now - 5000,
        updatedAt: now,
        messageCount: 3,
        lastMessageId: 77,
        lastChannel: "telegram",
        lastTo: "999",
        contextTokens: 2048,
        model: "claude-3-haiku",
        provider: "anthropic",
        lastResetDate: "2024-03-01",
      },
    };

    writeFileSync(SESSIONS_JSON, JSON.stringify(store), "utf-8");
    migrateSessionsToDb();

    const row = testDb.prepare("SELECT * FROM sessions WHERE id = ?").get("uuid-999") as
      | Record<string, unknown>
      | undefined;

    expect(row).toBeDefined();
    expect(row!.chat_id).toBe("telegram:999");
    expect(row!.started_at).toBe(now - 5000);
    expect(row!.updated_at).toBe(now);
    expect(row!.message_count).toBe(3);
    expect(row!.last_message_id).toBe(77);
    expect(row!.last_channel).toBe("telegram");
    expect(row!.last_to).toBe("999");
    expect(row!.context_tokens).toBe(2048);
    expect(row!.model).toBe("claude-3-haiku");
    expect(row!.provider).toBe("anthropic");
    expect(row!.last_reset_date).toBe("2024-03-01");
  });

  it("stores null for optional fields when they are absent in the source JSON", () => {
    const store = {
      "telegram:minimal": {
        sessionId: "uuid-minimal",
        createdAt: 1000000,
        updatedAt: 2000000,
        messageCount: 0,
      },
    };

    writeFileSync(SESSIONS_JSON, JSON.stringify(store), "utf-8");
    migrateSessionsToDb();

    const row = testDb.prepare("SELECT * FROM sessions WHERE id = ?").get("uuid-minimal") as
      | Record<string, unknown>
      | undefined;

    expect(row).toBeDefined();
    expect(row!.last_message_id).toBeNull();
    expect(row!.last_channel).toBeNull();
    expect(row!.last_to).toBeNull();
    expect(row!.context_tokens).toBeNull();
    expect(row!.model).toBeNull();
    expect(row!.provider).toBeNull();
    expect(row!.last_reset_date).toBeNull();
  });

  it("renames sessions.json to sessions.json.backup after a successful migration", () => {
    writeFileSync(SESSIONS_JSON, JSON.stringify({}), "utf-8");
    migrateSessionsToDb();

    expect(existsSync(SESSIONS_JSON)).toBe(false);
    expect(existsSync(SESSIONS_JSON_BACKUP)).toBe(true);
  });

  it("returns 0 and does not throw when sessions.json contains invalid JSON", () => {
    writeFileSync(SESSIONS_JSON, "{ not valid json }", "utf-8");

    let result: number | undefined;
    expect(() => {
      result = migrateSessionsToDb();
    }).not.toThrow();
    expect(result).toBe(0);
  });

  it("migrates an empty sessions store and creates no rows", () => {
    writeFileSync(SESSIONS_JSON, JSON.stringify({}), "utf-8");

    const migrated = migrateSessionsToDb();
    expect(migrated).toBe(0);

    const rows = testDb.prepare("SELECT * FROM sessions").all();
    expect(rows).toHaveLength(0);
  });

  it("uses INSERT OR REPLACE so a second migration with updated data overwrites the first", () => {
    const now = Date.now();
    const base = {
      sessionId: "uuid-v1",
      createdAt: now,
      updatedAt: now,
      messageCount: 1,
      lastMessageId: null,
      lastChannel: null,
      lastTo: null,
      contextTokens: null,
      model: null,
      provider: null,
      lastResetDate: null,
    };

    // First migration
    writeFileSync(SESSIONS_JSON, JSON.stringify({ "telegram:dup": base }), "utf-8");
    migrateSessionsToDb();

    // Backup now exists; remove it so a second rename can succeed.
    rmSync(SESSIONS_JSON_BACKUP);
    const updated = { ...base, sessionId: "uuid-v2", messageCount: 99 };
    writeFileSync(SESSIONS_JSON, JSON.stringify({ "telegram:dup": updated }), "utf-8");
    const secondMigration = migrateSessionsToDb();

    expect(secondMigration).toBe(1);

    const rows = testDb
      .prepare("SELECT * FROM sessions WHERE chat_id = ?")
      .all("telegram:dup") as Array<{ id: string; message_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("uuid-v2");
    expect(rows[0].message_count).toBe(99);
  });

  it("defaults messageCount to 0 when the field is absent in the source JSON", () => {
    const store = {
      "telegram:no-count": {
        sessionId: "uuid-no-count",
        createdAt: 1000000,
        updatedAt: 2000000,
        // messageCount deliberately absent
      },
    };

    writeFileSync(SESSIONS_JSON, JSON.stringify(store), "utf-8");
    migrateSessionsToDb();

    const row = testDb.prepare("SELECT * FROM sessions WHERE id = ?").get("uuid-no-count") as
      | Record<string, unknown>
      | undefined;

    expect(row).toBeDefined();
    expect(row!.message_count).toBe(0);
  });
});
