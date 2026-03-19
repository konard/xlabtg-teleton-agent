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

import { createSecurityRoutes } from "../routes/security.js";
import type { WebUIServerDeps } from "../types.js";

// ── In-memory SQLite helper ──────────────────────────────────────────
// AuditService and SecurityService use module-level singletons (if (!_instance)).
// This means once createSecurityRoutes is called, subsequent calls with different
// DB instances still use the first singleton. To avoid this, we use a single
// shared db/app and clean the data between tests.

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  // Pre-create all tables so they exist for both the service constructors and our seeding
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT    NOT NULL,
      details    TEXT    NOT NULL DEFAULT '',
      ip         TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

    CREATE TABLE IF NOT EXISTS security_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

// Create one shared db and app at module level to sidestep singleton issues
const sharedDb = createTestDb();

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/security", createSecurityRoutes(deps));
  return app;
}

const sharedApp = buildApp(sharedDb);

// ── Seed helpers ──────────────────────────────────────────────────────

function seedAuditEntry(
  db: Database.Database,
  opts: {
    action?: string;
    details?: string;
    ip?: string | null;
    userAgent?: string | null;
    createdAt?: number;
  } = {}
): void {
  const action = opts.action ?? "other";
  const details = opts.details ?? "Test action";
  const ip = opts.ip ?? null;
  const userAgent = opts.userAgent ?? null;
  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);

  db.prepare(
    "INSERT INTO audit_log (action, details, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(action, details, ip, userAgent, createdAt);
}

function clearAuditLog(db: Database.Database): void {
  db.prepare("DELETE FROM audit_log").run();
}

function clearSecuritySettings(db: Database.Database): void {
  db.prepare("DELETE FROM security_settings").run();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /security/audit", () => {
  beforeEach(() => {
    clearAuditLog(sharedDb);
  });

  it("returns empty audit log when no entries exist", async () => {
    const res = await sharedApp.request("/security/audit");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.entries).toEqual([]);
    expect(json.data.total).toBe(0);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(50);
  });

  it("returns audit log entries with expected fields", async () => {
    const now = Math.floor(Date.now() / 1000);
    seedAuditEntry(sharedDb, {
      action: "config_change",
      details: "Changed setting X",
      ip: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      createdAt: now,
    });

    const res = await sharedApp.request("/security/audit");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(1);
    const entry = json.data.entries[0];
    expect(entry.action).toBe("config_change");
    expect(entry.details).toBe("Changed setting X");
    expect(entry.ip).toBe("192.168.1.1");
    expect(entry.user_agent).toBe("Mozilla/5.0");
    expect(typeof entry.id).toBe("number");
  });

  it("supports pagination via page and limit params", async () => {
    for (let i = 0; i < 10; i++) {
      seedAuditEntry(sharedDb, { action: "other", details: `Entry ${i}` });
    }

    const res = await sharedApp.request("/security/audit?page=1&limit=5");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.entries.length).toBe(5);
    expect(json.data.total).toBe(10);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(5);
  });

  it("returns second page of results", async () => {
    for (let i = 0; i < 7; i++) {
      seedAuditEntry(sharedDb, { action: "other", details: `Entry ${i}` });
    }

    const res = await sharedApp.request("/security/audit?page=2&limit=5");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.entries.length).toBe(2);
    expect(json.data.page).toBe(2);
  });

  it("filters by action type", async () => {
    seedAuditEntry(sharedDb, { action: "config_change", details: "Config changed" });
    seedAuditEntry(sharedDb, { action: "tool_toggle", details: "Tool toggled" });
    seedAuditEntry(sharedDb, { action: "config_change", details: "Another config change" });

    const res = await sharedApp.request("/security/audit?type=config_change");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(2);
    for (const entry of json.data.entries) {
      expect(entry.action).toBe("config_change");
    }
  });

  it("filters by since timestamp", async () => {
    const now = Math.floor(Date.now() / 1000);
    seedAuditEntry(sharedDb, { action: "other", details: "Old entry", createdAt: now - 7200 });
    seedAuditEntry(sharedDb, { action: "other", details: "Recent entry", createdAt: now });

    const res = await sharedApp.request(`/security/audit?since=${now - 3600}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(1);
    expect(json.data.entries[0].details).toBe("Recent entry");
  });

  it("filters by until timestamp", async () => {
    const now = Math.floor(Date.now() / 1000);
    seedAuditEntry(sharedDb, { action: "other", details: "Old entry", createdAt: now - 7200 });
    seedAuditEntry(sharedDb, { action: "other", details: "Recent entry", createdAt: now });

    const res = await sharedApp.request(`/security/audit?until=${now - 3600}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(1);
    expect(json.data.entries[0].details).toBe("Old entry");
  });

  it("defaults to page=1 when page param is omitted", async () => {
    const res = await sharedApp.request("/security/audit");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.page).toBe(1);
  });

  it("defaults to limit=50 when limit param is omitted", async () => {
    const res = await sharedApp.request("/security/audit");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.limit).toBe(50);
  });

  it("caps limit at 200 even if higher value is requested", async () => {
    const res = await sharedApp.request("/security/audit?limit=999");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.limit).toBe(200);
  });
});

describe("GET /security/audit/export", () => {
  beforeEach(() => {
    clearAuditLog(sharedDb);
  });

  it("returns CSV content type header", async () => {
    const res = await sharedApp.request("/security/audit/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });

  it("returns Content-Disposition attachment header", async () => {
    const res = await sharedApp.request("/security/audit/export");
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("audit-log-");
    expect(disposition).toContain(".csv");
  });

  it("returns CSV with header row when no entries exist", async () => {
    const res = await sharedApp.request("/security/audit/export");
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("id,action,details,ip,user_agent,created_at");
  });

  it("returns CSV rows for existing audit entries", async () => {
    seedAuditEntry(sharedDb, {
      action: "config_change",
      details: "Some config update",
      ip: "10.0.0.1",
    });

    const res = await sharedApp.request("/security/audit/export");
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("config_change");
    expect(csv).toContain("Some config update");
    expect(csv).toContain("10.0.0.1");
  });

  it("filters CSV export by action type", async () => {
    seedAuditEntry(sharedDb, { action: "config_change", details: "config" });
    seedAuditEntry(sharedDb, { action: "tool_toggle", details: "tool" });

    const res = await sharedApp.request("/security/audit/export?type=config_change");
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // Header + 1 data row
    expect(lines.length).toBe(2);
    expect(csv).toContain("config_change");
    expect(csv).not.toContain("tool_toggle");
  });

  it("escapes double quotes in CSV details field", async () => {
    seedAuditEntry(sharedDb, { action: "other", details: 'Value with "quotes" inside' });

    const res = await sharedApp.request("/security/audit/export");
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('""quotes""');
  });
});

describe("GET /security/settings", () => {
  beforeEach(() => {
    clearSecuritySettings(sharedDb);
  });

  it("returns default settings when none have been set", async () => {
    const res = await sharedApp.request("/security/settings");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.session_timeout_minutes).toBeNull();
    expect(json.data.ip_allowlist).toEqual([]);
    expect(json.data.rate_limit_rpm).toBeNull();
  });

  it("returns settings with expected fields", async () => {
    const res = await sharedApp.request("/security/settings");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty("session_timeout_minutes");
    expect(json.data).toHaveProperty("ip_allowlist");
    expect(json.data).toHaveProperty("rate_limit_rpm");
  });
});

describe("PUT /security/settings", () => {
  beforeEach(() => {
    clearSecuritySettings(sharedDb);
  });

  it("updates session_timeout_minutes successfully", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: 30 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.session_timeout_minutes).toBe(30);
  });

  it("sets session_timeout_minutes to null", async () => {
    // First set a value
    await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: 60 }),
    });

    // Then clear it
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: null }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("updates ip_allowlist successfully", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip_allowlist: ["192.168.1.0", "10.0.0.0"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ip_allowlist).toEqual(["192.168.1.0", "10.0.0.0"]);
  });

  it("updates rate_limit_rpm successfully", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate_limit_rpm: 60 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.rate_limit_rpm).toBe(60);
  });

  it("returns 400 when session_timeout_minutes is not a positive number", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: -5 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("session_timeout_minutes");
  });

  it("returns 400 when session_timeout_minutes is zero", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: 0 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 when ip_allowlist is not an array", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip_allowlist: "192.168.1.0" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("ip_allowlist");
  });

  it("returns 400 when ip_allowlist contains non-string values", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip_allowlist: [123, "192.168.1.0"] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 when rate_limit_rpm is not a positive number", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate_limit_rpm: -10 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("rate_limit_rpm");
  });

  it("allows setting rate_limit_rpm to null", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate_limit_rpm: null }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("allows updating multiple settings at once", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_timeout_minutes: 120,
        ip_allowlist: ["10.0.0.1"],
        rate_limit_rpm: 100,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.session_timeout_minutes).toBe(120);
    expect(json.data.ip_allowlist).toEqual(["10.0.0.1"]);
    expect(json.data.rate_limit_rpm).toBe(100);
  });

  it("returns 500 for invalid JSON body", async () => {
    const res = await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("persists settings that can be retrieved via GET", async () => {
    await sharedApp.request("/security/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_timeout_minutes: 45, rate_limit_rpm: 30 }),
    });

    const res = await sharedApp.request("/security/settings");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.session_timeout_minutes).toBe(45);
    expect(json.data.rate_limit_rpm).toBe(30);
  });
});
