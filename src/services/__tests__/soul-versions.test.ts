import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Mock module-db and paths before importing the module under test ────────────
// soul-versions.ts uses a file-based DB via openModuleDb. We replace openModuleDb
// with an in-memory Database so no disk I/O occurs during tests.

let mockDb: Database.Database;

vi.mock("../../utils/module-db.js", () => ({
  openModuleDb: vi.fn(() => mockDb),
}));

vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/test-teleton-root",
  WORKSPACE_ROOT: "/tmp/test-teleton-root/workspace",
  WORKSPACE_PATHS: {},
  ALLOWED_EXTENSIONS: {},
  MAX_FILE_SIZES: {},
}));

// Import AFTER mocks are set up
import {
  listVersions,
  getVersion,
  saveVersion,
  deleteVersion,
  closeSoulVersionsDb,
} from "../soul-versions.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_soul_versions_filename ON soul_versions(filename);
    CREATE INDEX IF NOT EXISTS idx_soul_versions_created_at ON soul_versions(created_at DESC);
  `);
  return db;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("soul-versions", () => {
  beforeEach(() => {
    // Provide a fresh in-memory DB for every test.
    // closeSoulVersionsDb() resets the module-level `db` variable so the next
    // call to getSoulVersionsDb() will invoke openModuleDb() (our mock) again.
    mockDb = createInMemoryDb();
    closeSoulVersionsDb();
  });

  afterEach(() => {
    closeSoulVersionsDb();
  });

  // ── listVersions() ────────────────────────────────────────────────────────────

  describe("listVersions()", () => {
    it("returns empty array when no versions exist for a filename", () => {
      const result = listVersions("SOUL.md");
      expect(result).toEqual([]);
    });

    it("returns versions for a specific filename", () => {
      saveVersion("SOUL.md", "content v1", "initial");
      saveVersion("SOUL.md", "content v2", "update");

      const result = listVersions("SOUL.md");
      expect(result.length).toBe(2);
    });

    it("does not return versions for other filenames", () => {
      saveVersion("SOUL.md", "soul content", "soul version");
      saveVersion("MEMORY.md", "memory content", "memory version");

      const soulVersions = listVersions("SOUL.md");
      const memoryVersions = listVersions("MEMORY.md");

      expect(soulVersions.length).toBe(1);
      expect(memoryVersions.length).toBe(1);
      expect(soulVersions[0].filename).toBe("SOUL.md");
    });

    it("returns metadata fields: id, filename, comment, created_at, content_length", () => {
      saveVersion("SOUL.md", "Hello World", "test comment");

      const result = listVersions("SOUL.md");
      expect(result.length).toBe(1);

      const meta = result[0];
      expect(typeof meta.id).toBe("number");
      expect(meta.filename).toBe("SOUL.md");
      expect(meta.comment).toBe("test comment");
      expect(typeof meta.created_at).toBe("string");
      expect(meta.content_length).toBe("Hello World".length);
    });

    it("orders versions by created_at DESC and id DESC", () => {
      saveVersion("SOUL.md", "v1 content", "first");
      saveVersion("SOUL.md", "v2 content", "second");
      saveVersion("SOUL.md", "v3 content", "third");

      const result = listVersions("SOUL.md");
      // Most recent should be first
      expect(result[0].comment).toBe("third");
      expect(result[result.length - 1].comment).toBe("first");
    });

    it("returns null comment when comment was not provided", () => {
      saveVersion("SOUL.md", "no comment content");

      const result = listVersions("SOUL.md");
      expect(result[0].comment).toBeNull();
    });
  });

  // ── getVersion() ──────────────────────────────────────────────────────────────

  describe("getVersion()", () => {
    it("returns null when the version does not exist", () => {
      const result = getVersion("SOUL.md", 9999);
      expect(result).toBeNull();
    });

    it("returns null when the id belongs to a different filename", () => {
      const saved = saveVersion("MEMORY.md", "mem content", "mem v1");
      const result = getVersion("SOUL.md", saved.id);
      expect(result).toBeNull();
    });

    it("returns the full version with content", () => {
      const saved = saveVersion("SOUL.md", "full content here", "v1");
      const result = getVersion("SOUL.md", saved.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(saved.id);
      expect(result!.filename).toBe("SOUL.md");
      expect(result!.content).toBe("full content here");
      expect(result!.comment).toBe("v1");
      expect(typeof result!.created_at).toBe("string");
    });

    it("returns the correct version when multiple versions exist", () => {
      const v1 = saveVersion("SOUL.md", "content v1", "v1");
      const v2 = saveVersion("SOUL.md", "content v2", "v2");

      const fetched = getVersion("SOUL.md", v1.id);
      expect(fetched!.content).toBe("content v1");
    });
  });

  // ── saveVersion() ─────────────────────────────────────────────────────────────

  describe("saveVersion()", () => {
    it("returns a SoulVersionMeta object after saving", () => {
      const meta = saveVersion("SOUL.md", "some content", "initial");

      expect(typeof meta.id).toBe("number");
      expect(meta.id).toBeGreaterThan(0);
      expect(meta.filename).toBe("SOUL.md");
      expect(meta.comment).toBe("initial");
      expect(meta.content_length).toBe("some content".length);
      expect(typeof meta.created_at).toBe("string");
    });

    it("saves without a comment (optional)", () => {
      const meta = saveVersion("SOUL.md", "content without comment");
      expect(meta.comment).toBeNull();
    });

    it("increments id for each new version", () => {
      const v1 = saveVersion("SOUL.md", "v1");
      const v2 = saveVersion("SOUL.md", "v2");
      expect(v2.id).toBeGreaterThan(v1.id);
    });

    it("persists content that can be retrieved via getVersion", () => {
      const saved = saveVersion("SOUL.md", "persistent content", "save test");
      const fetched = getVersion("SOUL.md", saved.id);
      expect(fetched?.content).toBe("persistent content");
    });

    it("saves versions for different filenames independently", () => {
      const s1 = saveVersion("SOUL.md", "soul v1");
      const s2 = saveVersion("MEMORY.md", "memory v1");

      expect(getVersion("SOUL.md", s1.id)?.content).toBe("soul v1");
      expect(getVersion("MEMORY.md", s2.id)?.content).toBe("memory v1");
    });

    it("enforces MAX_VERSIONS_PER_FILE (50) by deleting oldest entries", () => {
      // Save 51 versions for the same filename
      for (let i = 1; i <= 51; i++) {
        saveVersion("SOUL.md", `content version ${i}`, `v${i}`);
      }

      const versions = listVersions("SOUL.md");
      expect(versions.length).toBeLessThanOrEqual(50);
    });

    it("keeps the newest versions when pruning", () => {
      for (let i = 1; i <= 51; i++) {
        saveVersion("SOUL.md", `content ${i}`, `v${i}`);
      }

      const versions = listVersions("SOUL.md");
      // The most recent version (v51) should still be present
      const latestComment = versions[0].comment;
      expect(latestComment).toBe("v51");
    });

    it("does not prune versions from other files when one file hits the limit", () => {
      for (let i = 0; i < 51; i++) {
        saveVersion("SOUL.md", `soul ${i}`);
      }
      saveVersion("MEMORY.md", "memory content");

      const memoryVersions = listVersions("MEMORY.md");
      expect(memoryVersions.length).toBe(1);
    });

    it("handles empty string content", () => {
      const meta = saveVersion("SOUL.md", "");
      expect(meta.content_length).toBe(0);
      const fetched = getVersion("SOUL.md", meta.id);
      expect(fetched?.content).toBe("");
    });

    it("handles large content", () => {
      const largeContent = "x".repeat(10000);
      const meta = saveVersion("SOUL.md", largeContent, "large");
      expect(meta.content_length).toBe(10000);
      const fetched = getVersion("SOUL.md", meta.id);
      expect(fetched?.content).toBe(largeContent);
    });
  });

  // ── deleteVersion() ───────────────────────────────────────────────────────────

  describe("deleteVersion()", () => {
    it("returns false when the version does not exist", () => {
      const result = deleteVersion("SOUL.md", 9999);
      expect(result).toBe(false);
    });

    it("returns false when the id exists but for a different filename", () => {
      const saved = saveVersion("MEMORY.md", "content", "v1");
      const result = deleteVersion("SOUL.md", saved.id);
      expect(result).toBe(false);
    });

    it("returns true when the version is successfully deleted", () => {
      const saved = saveVersion("SOUL.md", "delete me", "v1");
      const result = deleteVersion("SOUL.md", saved.id);
      expect(result).toBe(true);
    });

    it("removes the version from the database", () => {
      const saved = saveVersion("SOUL.md", "to be deleted");
      deleteVersion("SOUL.md", saved.id);

      const fetched = getVersion("SOUL.md", saved.id);
      expect(fetched).toBeNull();
    });

    it("does not affect other versions of the same file", () => {
      const v1 = saveVersion("SOUL.md", "keep this", "v1");
      const v2 = saveVersion("SOUL.md", "delete this", "v2");

      deleteVersion("SOUL.md", v2.id);

      const remaining = listVersions("SOUL.md");
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(v1.id);
    });

    it("does not affect versions of other files", () => {
      const soul = saveVersion("SOUL.md", "soul content");
      const memory = saveVersion("MEMORY.md", "memory content");

      deleteVersion("SOUL.md", soul.id);

      const memVersions = listVersions("MEMORY.md");
      expect(memVersions.length).toBe(1);
    });
  });

  // ── closeSoulVersionsDb() ─────────────────────────────────────────────────────

  describe("closeSoulVersionsDb()", () => {
    it("can be called without error when db is open", () => {
      // Trigger db initialization by calling any function
      listVersions("SOUL.md");
      expect(() => closeSoulVersionsDb()).not.toThrow();
    });

    it("can be called without error when db is already closed (null)", () => {
      closeSoulVersionsDb(); // already null after beforeEach
      expect(() => closeSoulVersionsDb()).not.toThrow();
    });

    it("resets the singleton so a fresh db is created on next call", () => {
      const v1 = saveVersion("SOUL.md", "before close");
      closeSoulVersionsDb();

      // Provide a new fresh db via the mock
      mockDb = createInMemoryDb();
      // After closing, the module will call openModuleDb again (our mock)
      const versions = listVersions("SOUL.md");
      // New db has no data
      expect(versions.length).toBe(0);
    });
  });
});
