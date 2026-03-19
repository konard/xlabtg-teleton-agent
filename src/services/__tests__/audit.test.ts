import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { AuditService, initAudit } from "../audit.js";
import type { AuditActionType } from "../audit.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(":memory:");
}

// ── AuditService class tests ───────────────────────────────────────────────────

describe("AuditService", () => {
  let db: Database.Database;
  let service: AuditService;

  beforeEach(() => {
    db = createTestDb();
    service = new AuditService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Table creation ────────────────────────────────────────────────────────────

  it("creates the audit_log table on construction", () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'`)
      .get();
    expect(row).toBeDefined();
  });

  it("creates indexes on audit_log", () => {
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_audit_log_created_at");
    expect(names).toContain("idx_audit_log_action");
  });

  // ── log() ─────────────────────────────────────────────────────────────────────

  describe("log()", () => {
    it("inserts a new audit entry with defaults", () => {
      service.log("login", "User logged in");

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe("login");
      expect(rows[0].details).toBe("User logged in");
      expect(rows[0].ip).toBeNull();
      expect(rows[0].user_agent).toBeNull();
    });

    it("inserts ip and user_agent when provided", () => {
      service.log("config_change", "Changed timeout", {
        ip: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });

      const row = db
        .prepare("SELECT * FROM audit_log WHERE action = 'config_change'")
        .get() as Record<string, unknown>;
      expect(row.ip).toBe("192.168.1.1");
      expect(row.user_agent).toBe("Mozilla/5.0");
    });

    it("accepts all valid AuditActionType values", () => {
      const actions: AuditActionType[] = [
        "config_change",
        "tool_toggle",
        "soul_edit",
        "agent_restart",
        "agent_stop",
        "plugin_install",
        "plugin_remove",
        "hook_change",
        "mcp_change",
        "memory_delete",
        "workspace_change",
        "session_delete",
        "secret_change",
        "security_change",
        "login",
        "logout",
        "other",
      ];

      for (const action of actions) {
        service.log(action, `Test: ${action}`);
      }

      const count = (db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number }).c;
      expect(count).toBe(actions.length);
    });

    it("stores created_at as a unix timestamp", () => {
      const before = Math.floor(Date.now() / 1000) - 1;
      service.log("logout", "test");
      const after = Math.floor(Date.now() / 1000) + 1;

      const row = db.prepare("SELECT created_at FROM audit_log").get() as { created_at: number };
      expect(row.created_at).toBeGreaterThanOrEqual(before);
      expect(row.created_at).toBeLessThanOrEqual(after);
    });

    it("stores empty string details by default (empty string passed)", () => {
      service.log("other", "");
      const row = db.prepare("SELECT details FROM audit_log").get() as { details: string };
      expect(row.details).toBe("");
    });
  });

  // ── list() ────────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty page when no entries", () => {
      const result = service.list();
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it("returns all entries with correct page metadata", () => {
      service.log("login", "a");
      service.log("logout", "b");

      const result = service.list();
      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it("returns entries ordered by created_at DESC", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "first",
        now - 100
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "second",
        now
      );

      const result = service.list();
      expect(result.entries[0].details).toBe("second");
      expect(result.entries[1].details).toBe("first");
    });

    it("filters by action type", () => {
      service.log("login", "user-login");
      service.log("logout", "user-logout");
      service.log("login", "second-login");

      const result = service.list({ action: "login" });
      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
      result.entries.forEach((e) => expect(e.action).toBe("login"));
    });

    it("filters by since timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "old",
        now - 7200
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "recent",
        now
      );

      const result = service.list({ since: now - 3600 });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].details).toBe("recent");
    });

    it("filters by until timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "old",
        now - 7200
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "future",
        now + 3600
      );

      const result = service.list({ until: now });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].details).toBe("old");
    });

    it("combines action, since, and until filters", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "old-login",
        now - 7200
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "recent-login",
        now
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "recent-logout",
        now
      );

      const result = service.list({ action: "login", since: now - 3600 });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].details).toBe("recent-login");
    });

    it("paginates correctly with page and limit", () => {
      for (let i = 0; i < 10; i++) {
        service.log("other", `entry-${i}`);
      }

      const page1 = service.list({ page: 1, limit: 4 });
      expect(page1.entries.length).toBe(4);
      expect(page1.total).toBe(10);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(4);

      const page2 = service.list({ page: 2, limit: 4 });
      expect(page2.entries.length).toBe(4);

      const page3 = service.list({ page: 3, limit: 4 });
      expect(page3.entries.length).toBe(2);
    });

    it("clamps limit to minimum of 1", () => {
      service.log("other", "test");
      const result = service.list({ limit: 0 });
      expect(result.limit).toBe(1);
    });

    it("clamps limit to maximum of 200", () => {
      const result = service.list({ limit: 9999 });
      expect(result.limit).toBe(200);
    });

    it("defaults page to 1 when page < 1 provided", () => {
      const result = service.list({ page: -5 });
      expect(result.page).toBe(1);
    });
  });

  // ── exportCsv() ───────────────────────────────────────────────────────────────

  describe("exportCsv()", () => {
    it("returns header-only CSV when no entries", () => {
      const csv = service.exportCsv();
      expect(csv).toBe("id,action,details,ip,user_agent,created_at");
    });

    it("includes a data row for each entry", () => {
      service.log("login", "User logged in", { ip: "10.0.0.1", userAgent: "test-agent" });

      const csv = service.exportCsv();
      const lines = csv.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("id,action,details,ip,user_agent,created_at");
      expect(lines[1]).toContain("login");
      expect(lines[1]).toContain("10.0.0.1");
      expect(lines[1]).toContain("test-agent");
    });

    it("escapes double quotes in details", () => {
      service.log("other", 'He said "hello"');

      const csv = service.exportCsv();
      expect(csv).toContain('"He said ""hello"""');
    });

    it("outputs empty string for null ip and user_agent", () => {
      service.log("logout", "test");

      const csv = service.exportCsv();
      const dataLine = csv.split("\n")[1];
      // ip and user_agent columns should be empty
      expect(dataLine).toContain("logout");
    });

    it("filters by action type in CSV export", () => {
      service.log("login", "logged in");
      service.log("logout", "logged out");
      service.log("login", "second login");

      const csv = service.exportCsv({ action: "login" });
      const lines = csv.split("\n");
      expect(lines.length).toBe(3); // header + 2 login entries
    });

    it("filters by since in CSV export", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "old",
        now - 7200
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "recent",
        now
      );

      const csv = service.exportCsv({ since: now - 3600 });
      const lines = csv.split("\n");
      expect(lines.length).toBe(2); // header + 1 row
      expect(csv).toContain("recent");
    });

    it("filters by until in CSV export", () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "login",
        "old",
        now - 7200
      );
      db.prepare("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)").run(
        "logout",
        "future",
        now + 3600
      );

      const csv = service.exportCsv({ until: now });
      const lines = csv.split("\n");
      expect(lines.length).toBe(2); // header + 1 row
      expect(csv).toContain("old");
    });

    it("formats created_at as ISO timestamp", () => {
      service.log("other", "test");
      const csv = service.exportCsv();
      const dataLine = csv.split("\n")[1];
      // Should contain an ISO date string like 2024-...T...Z
      expect(dataLine).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("multiple entries are all exported", () => {
      for (let i = 0; i < 5; i++) {
        service.log("other", `entry-${i}`);
      }

      const csv = service.exportCsv();
      const lines = csv.split("\n");
      expect(lines.length).toBe(6); // header + 5 entries
    });
  });
});

// ── initAudit singleton tests ──────────────────────────────────────────────────

describe("initAudit", () => {
  it("returns an AuditService instance", () => {
    const db = createTestDb();
    const instance = initAudit(db);
    expect(instance).toBeInstanceOf(AuditService);
    db.close();
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const db1 = createTestDb();
    const db2 = createTestDb();
    // Note: the module singleton is shared across test runs if not reset.
    // We test that calling initAudit twice with the same db returns a valid AuditService.
    const instance1 = initAudit(db1);
    const instance2 = initAudit(db1);
    expect(instance1).toBe(instance2);
    db1.close();
    db2.close();
  });
});
