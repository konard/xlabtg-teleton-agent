/**
 * Tests for self-improvement routes when the plugin DB exists and contains data.
 *
 * These tests verify that the routes read from the correct DB file
 * ("self-improve-orchestrator.db") and return real data instead of empty arrays.
 *
 * We mock ../../workspace/paths.js using a factory so that the mock is hoisted
 * before any module imports and PLUGIN_DB_PATH is computed from our temp dir.
 */

import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";

// Temp dir computed inside the factory (string literal — no variable access)
// We use a predictable sub-dir name under os.tmpdir() so we can reference
// it both inside the hoisted factory and in the test body.
const TMP_ROOT = join(tmpdir(), "teleton-si-with-data-test");
const PLUGIN_DATA_DIR = join(TMP_ROOT, "plugins", "data");

// vi.mock is hoisted to the top of the file at compile-time, so we must NOT
// reference any let/const declared above — we use the inline join() calls.
vi.mock("../../workspace/paths.js", () => {
  const { join: _join } = require("node:path");
  const { tmpdir: _tmpdir } = require("node:os");
  const root = _join(_tmpdir(), "teleton-si-with-data-test");
  return {
    TELETON_ROOT: root,
    WORKSPACE_ROOT: _join(root, "workspace"),
    WORKSPACE_PATHS: {},
    ALLOWED_EXTENSIONS: {},
    MAX_FILE_SIZES: {},
  };
});

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import routes AFTER mocks are registered
import { createSelfImprovementRoutes } from "../routes/self-improvement.js";
import type { WebUIServerDeps } from "../types.js";

// ── Schema helper (mirrors examples/plugins/self-improve-orchestrator/index.js) ──

function createPluginDb(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       INTEGER NOT NULL,
      repo            TEXT    NOT NULL,
      branch          TEXT    NOT NULL DEFAULT 'main',
      executor_plugin TEXT    NOT NULL DEFAULT 'github-dev-assistant',
      files_analyzed  INTEGER NOT NULL DEFAULT 0,
      issues_found    INTEGER NOT NULL DEFAULT 0,
      issues_created  INTEGER NOT NULL DEFAULT 0,
      summary         TEXT
    );

    CREATE TABLE IF NOT EXISTS improvement_tasks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id      INTEGER REFERENCES analysis_log(id),
      task_type        TEXT    NOT NULL DEFAULT 'code_improvement',
      priority         TEXT    NOT NULL DEFAULT 'medium',
      file_path        TEXT,
      description      TEXT    NOT NULL,
      suggestion       TEXT,
      code_snippet     TEXT,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_at       INTEGER NOT NULL,
      github_issue_url TEXT
    );
  `);
  return db;
}

// ── Test fixtures ────────────────────────────────────────────────────────────

const PLUGIN_DB_FILE = join(PLUGIN_DATA_DIR, "self-improve-orchestrator.db");

beforeAll(() => {
  mkdirSync(PLUGIN_DATA_DIR, { recursive: true });

  const pluginDb = createPluginDb(PLUGIN_DB_FILE);

  // Insert one analysis entry
  pluginDb
    .prepare(
      `INSERT INTO analysis_log (timestamp, repo, branch, files_analyzed, issues_found, issues_created, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(1_700_000_000, "xlabtg/teleton-agent", "main", 42, 3, 1, "Found 3 issues");

  // Insert one pending task and one created task
  pluginDb
    .prepare(
      `INSERT INTO improvement_tasks (analysis_id, task_type, priority, file_path, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(1, "code_improvement", "high", "src/foo.ts", "Fix null check", "pending", 1_700_000_001);

  pluginDb
    .prepare(
      `INSERT INTO improvement_tasks (analysis_id, task_type, priority, file_path, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(1, "code_improvement", "low", "src/bar.ts", "Add docs", "created", 1_700_000_002);

  pluginDb.close();
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── App builder ──────────────────────────────────────────────────────────────

function createMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_hook_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function buildApp() {
  const deps = { memory: { db: createMemoryDb() } } as unknown as WebUIServerDeps;
  const app = new Hono();
  app.route("/self-improvement", createSelfImprovementRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /self-improvement/analysis (with plugin DB populated)", () => {
  it("returns the analysis entries from self-improve-orchestrator.db", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/analysis");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].repo).toBe("xlabtg/teleton-agent");
    expect(json.data[0].files_analyzed).toBe(42);
    expect(json.data[0].issues_found).toBe(3);
    expect(json.data[0].summary).toBe("Found 3 issues");
  });

  it("respects the limit query parameter", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/analysis?limit=1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBeLessThanOrEqual(1);
  });
});

describe("GET /self-improvement/tasks (with plugin DB populated)", () => {
  it("returns all tasks when status=all", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/tasks?status=all");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
  });

  it("filters tasks by status=pending", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/tasks?status=pending");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].status).toBe("pending");
    expect(json.data[0].description).toBe("Fix null check");
  });

  it("filters tasks by status=created", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/tasks?status=created");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].status).toBe("created");
  });
});

describe("GET /self-improvement/status (with plugin DB populated)", () => {
  it("returns installed: true with correct counts", async () => {
    const app = buildApp();
    const res = await app.request("/self-improvement/status");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.installed).toBe(true);
    expect(json.data.analysis_count).toBe(1);
    expect(json.data.pending_tasks).toBe(1);
    expect(json.data.last_analysis).toBe(1_700_000_000);
  });
});
