import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createSelfImprovementRoutes } from "../routes/self-improvement.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────

function createTestDb(): Database.Database {
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

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/self-improvement", createSelfImprovementRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /self-improvement/config", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns default config when nothing has been saved", async () => {
    const res = await app.request("/self-improvement/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.selected_plugin).toBe("");
    expect(json.data.target_repo).toBe("");
    expect(json.data.guide_url).toBe("");
    expect(Array.isArray(json.data.focus_areas)).toBe(true);
    expect(json.data.auto_create_issues).toBe(false);
    expect(json.data.schedule_enabled).toBe(false);
    expect(json.data.require_approval).toBe(true);
  });

  it("returns saved config after a POST", async () => {
    await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_repo: "owner/repo", selected_plugin: "github-dev-assistant" }),
    });

    const res = await app.request("/self-improvement/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.target_repo).toBe("owner/repo");
    expect(json.data.selected_plugin).toBe("github-dev-assistant");
  });
});

describe("POST /self-improvement/config", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("saves and returns the updated config", async () => {
    const res = await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_repo: "xlabtg/teleton-agent",
        selected_plugin: "github-dev-assistant",
        focus_areas: ["security", "performance"],
        auto_create_issues: true,
        schedule_enabled: true,
        schedule_interval_hours: 12,
        require_approval: false,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.target_repo).toBe("xlabtg/teleton-agent");
    expect(json.data.selected_plugin).toBe("github-dev-assistant");
    expect(json.data.focus_areas).toEqual(["security", "performance"]);
    expect(json.data.auto_create_issues).toBe(true);
    expect(json.data.schedule_enabled).toBe(true);
    expect(json.data.schedule_interval_hours).toBe(12);
    expect(json.data.require_approval).toBe(false);
  });

  it("persists a changed target_repo and retrieving it via GET returns the new value", async () => {
    // Save initial repo
    await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_repo: "initial/repo" }),
    });

    // Change the repo
    await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_repo: "updated/repo" }),
    });

    // Confirm the new value is returned
    const res = await app.request("/self-improvement/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.target_repo).toBe("updated/repo");
  });

  it("merges partial update with existing config (other fields are preserved)", async () => {
    // Set initial full config
    await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_repo: "my/repo",
        selected_plugin: "my-plugin",
        focus_areas: ["security"],
      }),
    });

    // Update only target_repo — other fields should remain
    await app.request("/self-improvement/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_repo: "new/repo" }),
    });

    const res = await app.request("/self-improvement/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.target_repo).toBe("new/repo");
    expect(json.data.selected_plugin).toBe("my-plugin"); // preserved
    expect(json.data.focus_areas).toEqual(["security"]); // preserved
  });
});

describe("GET /self-improvement/analysis (no plugin DB)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns empty array when plugin DB does not exist", async () => {
    const res = await app.request("/self-improvement/analysis");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });
});

describe("GET /self-improvement/tasks (no plugin DB)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns empty array when plugin DB does not exist", async () => {
    const res = await app.request("/self-improvement/tasks");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it("supports status filter query param", async () => {
    const res = await app.request("/self-improvement/tasks?status=pending");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });
});

describe("GET /self-improvement/status (no plugin DB)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns installed: false when plugin DB does not exist", async () => {
    const res = await app.request("/self-improvement/status");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.installed).toBe(false);
  });
});
