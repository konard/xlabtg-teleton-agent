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

import { createHooksRoutes } from "../routes/hooks.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  // Create user_hook_config table used by user-hook-store
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_hook_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function buildApp(db: Database.Database, userHookEvaluator?: unknown) {
  const deps = {
    memory: { db },
    userHookEvaluator: userHookEvaluator ?? null,
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/hooks", createHooksRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /hooks/blocklist", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns default blocklist config when none is set", async () => {
    const res = await app.request("/hooks/blocklist");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.enabled).toBe(false);
    expect(json.data.keywords).toEqual([]);
    expect(json.data.message).toBe("");
  });
});

describe("PUT /hooks/blocklist", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("sets blocklist config successfully", async () => {
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        keywords: ["spam", "blocked-word"],
        message: "This content is blocked",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.enabled).toBe(true);
    expect(json.data.keywords).toEqual(["spam", "blocked-word"]);
    expect(json.data.message).toBe("This content is blocked");
  });

  it("filters out keywords shorter than 2 characters", async () => {
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        keywords: ["ok", "a", "good"],
        message: "",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.keywords).not.toContain("a");
    expect(json.data.keywords).toContain("ok");
    expect(json.data.keywords).toContain("good");
  });

  it("trims whitespace from keywords", async () => {
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        keywords: ["  hello  ", " world "],
        message: "",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.keywords).toContain("hello");
    expect(json.data.keywords).toContain("world");
  });

  it("returns 400 when enabled is not a boolean", async () => {
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes", keywords: [], message: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("enabled");
  });

  it("returns 400 when keywords is not an array", async () => {
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, keywords: "word", message: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("keywords");
  });

  it("returns 400 when keywords array exceeds 200 items", async () => {
    const keywords = Array.from({ length: 201 }, (_, i) => `keyword${i}`);
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, keywords, message: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("200");
  });

  it("truncates message to 500 characters", async () => {
    const longMessage = "x".repeat(600);
    const res = await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, keywords: ["test"], message: longMessage }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message.length).toBe(500);
  });

  it("calls reload on userHookEvaluator when present", async () => {
    const mockEvaluator = { reload: vi.fn(), evaluateWithTrace: vi.fn() };
    const appWithEvaluator = buildApp(db, mockEvaluator);

    await appWithEvaluator.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, keywords: [], message: "" }),
    });

    expect(mockEvaluator.reload).toHaveBeenCalledTimes(1);
  });
});

describe("GET /hooks/triggers", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns empty array when no triggers are configured", async () => {
    const res = await app.request("/hooks/triggers");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });
});

describe("POST /hooks/triggers", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("creates a new trigger successfully", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: "meeting",
        context: "Always check the calendar when meetings are mentioned.",
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keyword).toBe("meeting");
    expect(json.data.context).toBe("Always check the calendar when meetings are mentioned.");
    expect(json.data.enabled).toBe(true);
    expect(typeof json.data.id).toBe("string");
  });

  it("defaults enabled to true when not specified", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "deploy", context: "Check deployment status." }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enabled).toBe(true);
  });

  it("returns 400 when keyword is too short (< 2 chars)", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "a", context: "Some context here." }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("keyword");
  });

  it("returns 400 when keyword exceeds 100 characters", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "k".repeat(101), context: "Some context." }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 when context is empty", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "meeting", context: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("context");
  });

  it("returns 400 when context exceeds 2000 characters", async () => {
    const res = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "meeting", context: "x".repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("can be retrieved via GET after creation", async () => {
    await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "bug", context: "Check bug tracker." }),
    });

    const res = await app.request("/hooks/triggers");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].keyword).toBe("bug");
  });
});

describe("PUT /hooks/triggers/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for a non-existent trigger id", async () => {
    const res = await app.request("/hooks/triggers/nonexistent-id", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "new-keyword" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("not found");
  });

  it("updates trigger keyword successfully", async () => {
    // First create a trigger
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "original", context: "Some context." }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "updated" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keyword).toBe("updated");
    expect(json.data.context).toBe("Some context.");
  });

  it("updates trigger enabled status", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test-kw", context: "Test context.", enabled: true }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enabled).toBe(false);
  });

  it("returns 400 when updated keyword is invalid length", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "valid", context: "Context." }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "x" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe("DELETE /hooks/triggers/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("deletes a trigger and returns success", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "to-delete", context: "Context to delete." }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it("removes the trigger from the list after deletion", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "deletable", context: "Some context." }),
    });
    const { data: trigger } = await createRes.json();

    await app.request(`/hooks/triggers/${trigger.id}`, { method: "DELETE" });

    const listRes = await app.request("/hooks/triggers");
    const listJson = await listRes.json();
    const ids = listJson.data.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(trigger.id);
  });

  it("returns success even for a non-existent trigger id", async () => {
    // The implementation just filters, no 404 for missing ids
    const res = await app.request("/hooks/triggers/nonexistent-id", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

describe("PATCH /hooks/triggers/:id/toggle", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("toggles a trigger's enabled state", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "toggleable", context: "Context.", enabled: true }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(trigger.id);
    expect(json.data.enabled).toBe(false);
  });

  it("returns 404 for a non-existent trigger id", async () => {
    const res = await app.request("/hooks/triggers/nonexistent/toggle", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 when enabled is not a boolean", async () => {
    const createRes = await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "mykey", context: "Context." }),
    });
    const { data: trigger } = await createRes.json();

    const res = await app.request(`/hooks/triggers/${trigger.id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe("GET /hooks/rules", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns empty array when no rules are configured", async () => {
    const res = await app.request("/hooks/rules");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });
});

describe("POST /hooks/rules", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("creates a new rule successfully", async () => {
    const blocks = [
      { type: "trigger", keyword: "deploy" },
      { type: "action", ruleType: "inject", value: "Check deployment guide." },
    ];

    const res = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Deploy Rule", enabled: true, blocks }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("Deploy Rule");
    expect(json.data.enabled).toBe(true);
    expect(json.data.blocks).toEqual(blocks);
    expect(typeof json.data.id).toBe("string");
    expect(json.data.order).toBe(0);
  });

  it("defaults name to 'Untitled Rule' when not provided", async () => {
    const res = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Untitled Rule");
  });

  it("defaults enabled to true when not specified", async () => {
    const res = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enabled).toBe(true);
  });

  it("returns 400 when blocks is not an array", async () => {
    const res = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Rule", blocks: "not-array" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("blocks");
  });

  it("sets order based on existing rules count", async () => {
    // Create first rule
    await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule 1", blocks: [] }),
    });

    // Create second rule
    const res = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule 2", blocks: [] }),
    });
    const json = await res.json();
    expect(json.data.order).toBe(1);
  });
});

describe("PUT /hooks/rules/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns 404 for non-existent rule id", async () => {
    const res = await app.request("/hooks/rules/nonexistent-id", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("updates rule name successfully", async () => {
    const createRes = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Old Name", blocks: [] }),
    });
    const { data: rule } = await createRes.json();

    const res = await app.request(`/hooks/rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("New Name");
  });

  it("updates rule enabled status", async () => {
    const createRes = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule", blocks: [], enabled: true }),
    });
    const { data: rule } = await createRes.json();

    const res = await app.request(`/hooks/rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enabled).toBe(false);
  });

  it("updates rule blocks", async () => {
    const createRes = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule", blocks: [] }),
    });
    const { data: rule } = await createRes.json();

    const newBlocks = [{ type: "trigger", keyword: "test" }];
    const res = await app.request(`/hooks/rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: newBlocks }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.blocks).toEqual(newBlocks);
  });
});

describe("PUT /hooks/rules/reorder", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("reorders rules according to provided ids array", async () => {
    const res1 = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule A", blocks: [] }),
    });
    const res2 = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rule B", blocks: [] }),
    });
    const { data: ruleA } = await res1.json();
    const { data: ruleB } = await res2.json();

    // Reorder: B first, A second
    const reorderRes = await app.request("/hooks/rules/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ruleB.id, ruleA.id] }),
    });
    expect(reorderRes.status).toBe(200);
    const json = await reorderRes.json();
    expect(json.success).toBe(true);
    expect(json.data[0].name).toBe("Rule B");
    expect(json.data[1].name).toBe("Rule A");
  });

  it("returns 400 when ids is not an array", async () => {
    const res = await app.request("/hooks/rules/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: "not-array" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe("DELETE /hooks/rules/:id", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("deletes a rule and returns null data", async () => {
    const createRes = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Delete Me", blocks: [] }),
    });
    const { data: rule } = await createRes.json();

    const res = await app.request(`/hooks/rules/${rule.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it("removes rule from list after deletion", async () => {
    const createRes = await app.request("/hooks/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Removable", blocks: [] }),
    });
    const { data: rule } = await createRes.json();

    await app.request(`/hooks/rules/${rule.id}`, { method: "DELETE" });

    const listRes = await app.request("/hooks/rules");
    const listJson = await listRes.json();
    const ids = listJson.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(rule.id);
  });
});

describe("POST /hooks/test", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  it("evaluates a message and returns trace result", async () => {
    const res = await app.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello, this is a test message." }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.data.blocked).toBe("boolean");
    expect(json.data.blocked).toBe(false);
    expect(Array.isArray(json.data.trace)).toBe(true);
    expect(Array.isArray(json.data.triggeredHooks)).toBe(true);
    expect(typeof json.data.injectedContext).toBe("string");
  });

  it("detects blocked message when blocklist is configured", async () => {
    // Set up a blocklist with a keyword
    await app.request("/hooks/blocklist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, keywords: ["spam"], message: "Blocked!" }),
    });

    const res = await app.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "This is spam content." }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.blocked).toBe(true);
    expect(json.data.blockResponse).toBe("Blocked!");
  });

  it("defaults message to empty string when not provided", async () => {
    const res = await app.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns 400 when message exceeds 4000 characters", async () => {
    const res = await app.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(4001) }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("4000");
  });

  it("uses the provided userHookEvaluator when available", async () => {
    const mockResult = {
      blocked: false,
      blockResponse: "",
      triggeredHooks: [],
      injectedContext: "",
      trace: [{ step: "Mock step", matched: false }],
    };
    const mockEvaluator = {
      reload: vi.fn(),
      evaluateWithTrace: vi.fn().mockReturnValue(mockResult),
    };
    const appWithEvaluator = buildApp(db, mockEvaluator);

    const res = await appWithEvaluator.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockEvaluator.evaluateWithTrace).toHaveBeenCalledWith("test");
    expect(json.data.trace[0].step).toBe("Mock step");
  });

  it("triggers context injection when a matching trigger keyword is found", async () => {
    // Set up a trigger
    await app.request("/hooks/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "budget", context: "Budget info: $10k available." }),
    });

    const res = await app.request("/hooks/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is our budget for this?" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.blocked).toBe(false);
    expect(json.data.triggeredHooks.length).toBeGreaterThan(0);
    expect(json.data.injectedContext).toContain("Budget info");
  });
});
