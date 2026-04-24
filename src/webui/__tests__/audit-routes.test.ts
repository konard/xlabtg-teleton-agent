import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuditRoutes } from "../routes/audit.js";
import { AuditTrailService } from "../../services/audit-trail.js";
import type { WebUIServerDeps } from "../types.js";

function buildApp(db: Database.Database) {
  const deps = { memory: { db } } as unknown as WebUIServerDeps;
  const app = new Hono();
  app.route("/audit", createAuditRoutes(deps));
  return app;
}

describe("Audit routes", () => {
  let db: InstanceType<typeof Database>;
  let service: AuditTrailService;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    service = new AuditTrailService(db);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it("GET /audit/events returns filtered audit events", async () => {
    service.recordEvent({
      eventType: "llm.request",
      actor: "agent",
      sessionId: "s1",
      payload: { model: "claude" },
    });
    service.recordEvent({
      eventType: "tool.result",
      actor: "agent",
      sessionId: "s1",
      payload: { toolName: "web_fetch", success: true },
    });

    const res = await app.request("/audit/events?type=tool.result&session=s1");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.entries[0].event_type).toBe("tool.result");
  });

  it("GET /audit/chain/:event_id returns root-to-leaf chain", async () => {
    const root = service.recordEvent({
      eventType: "agent.decision",
      actor: "agent",
      payload: { decision: "select_tools" },
    });
    const child = service.recordEvent({
      eventType: "tool.invoke",
      actor: "agent",
      parentEventId: root.id,
      payload: { toolName: "web_fetch" },
    });

    const res = await app.request(`/audit/chain/${child.id}`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.events.map((event: { id: string }) => event.id)).toEqual([root.id, child.id]);
  });

  it("POST /audit/verify verifies the hash chain", async () => {
    service.recordEvent({
      eventType: "user.action",
      actor: "webui",
      payload: { method: "POST", path: "/api/security/settings" },
    });

    const res = await app.request("/audit/verify", { method: "POST" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.valid).toBe(true);
    expect(json.data.checked).toBe(1);
  });

  it("GET /audit/reports/:type returns compliance reports", async () => {
    service.recordEvent({
      eventType: "security.validation",
      actor: "system",
      payload: { allowed: false, reason: "blocked" },
    });

    const res = await app.request("/audit/reports/security_events?period=24");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.type).toBe("security_events");
    expect(json.data.rows.length).toBe(1);
  });

  it("POST /audit/export returns a signed export bundle", async () => {
    service.recordEvent({
      eventType: "session.lifecycle",
      actor: "agent",
      payload: { phase: "start" },
    });

    const res = await app.request("/audit/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "json" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.events.length).toBe(1);
    expect(json.signature.value).toMatch(/^[a-f0-9]{64}$/);
  });
});
