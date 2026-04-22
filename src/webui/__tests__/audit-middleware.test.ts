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

// Reset the AuditService singleton between tests
vi.mock("../../services/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/audit.js")>();
  let instance: InstanceType<typeof actual.AuditService> | null = null;
  return {
    ...actual,
    initAudit: (db: Database.Database) => {
      instance = new actual.AuditService(db);
      return instance;
    },
  };
});

import { createAuditMiddleware } from "../middleware/audit.js";
import { AuditService } from "../../services/audit.js";
import type { WebUIServerDeps } from "../types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  new AuditService(db); // ensure table exists
  return db;
}

function buildApp(db: Database.Database) {
  const deps = { memory: { db } } as unknown as WebUIServerDeps;
  const app = new Hono();
  app.use("/api/*", createAuditMiddleware(deps));
  return app;
}

// ── createAuditMiddleware ──────────────────────────────────────────────────────

describe("createAuditMiddleware", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  function auditRows() {
    return db.prepare("SELECT * FROM audit_log ORDER BY id DESC").all() as Array<
      Record<string, unknown>
    >;
  }

  it("logs a successful (2xx) PUT mutation", async () => {
    app.put("/api/config", (c) => c.json({ ok: true }, 200));

    const res = await app.request("/api/config", { method: "PUT" });
    expect(res.status).toBe(200);

    const rows = auditRows();
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("config_change");
    expect(rows[0].details).toContain("PUT /api/config");
  });

  it("logs a 403 PUT mutation", async () => {
    app.put("/api/config", (c) => c.json({ error: "Forbidden" }, 403));

    const res = await app.request("/api/config", { method: "PUT" });
    expect(res.status).toBe(403);

    const rows = auditRows();
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("config_change");

    const details = JSON.parse(rows[0].details as string);
    expect(details.status).toBe(403);
    expect(details.request).toContain("PUT /api/config");
  });

  it("logs a 500 POST mutation with status in details", async () => {
    app.post("/api/config", (c) => c.json({ error: "Internal Server Error" }, 500));

    const res = await app.request("/api/config", { method: "POST" });
    expect(res.status).toBe(500);

    const rows = auditRows();
    expect(rows.length).toBe(1);

    const details = JSON.parse(rows[0].details as string);
    expect(details.status).toBe(500);
    expect(details.request).toContain("POST /api/config");
  });

  it("does not log GET requests", async () => {
    app.get("/api/config", (c) => c.json({ ok: true }, 200));

    await app.request("/api/config", { method: "GET" });

    expect(auditRows().length).toBe(0);
  });

  it("does not log requests outside /api/", async () => {
    app.post("/auth/login", (c) => c.json({ ok: true }, 200));

    await app.request("/auth/login", { method: "POST" });

    expect(auditRows().length).toBe(0);
  });

  it("logs ip and user-agent from request headers", async () => {
    app.put("/api/config", (c) => c.json({ ok: true }, 200));

    await app.request("/api/config", {
      method: "PUT",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "test-agent/1.0",
      },
    });

    const rows = auditRows();
    expect(rows.length).toBe(1);
    expect(rows[0].ip).toBe("1.2.3.4");
    expect(rows[0].user_agent).toBe("test-agent/1.0");
  });

  it("logs a 4xx DELETE mutation", async () => {
    app.delete("/api/sessions/123", (c) => c.json({ error: "Not found" }, 404));

    const res = await app.request("/api/sessions/123", { method: "DELETE" });
    expect(res.status).toBe(404);

    const rows = auditRows();
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("session_delete");

    const details = JSON.parse(rows[0].details as string);
    expect(details.status).toBe(404);
  });
});
