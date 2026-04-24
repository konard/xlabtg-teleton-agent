import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { BehaviorTracker } from "../../services/behavior-tracker.js";
import { createTemporalRoutes } from "../routes/temporal.js";
import type { WebUIServerDeps } from "../types.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
    agent: {
      getConfig: () => ({
        temporal_context: {
          enabled: true,
          timezone: "UTC",
          pattern_min_frequency: 2,
          pattern_confidence_threshold: 0.5,
          context_patterns_limit: 5,
          weighting: {
            enabled: true,
            decay_curve: "exponential",
            recency_half_life_days: 30,
            temporal_relevance_weight: 0.2,
          },
        },
      }),
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/context", createTemporalRoutes(deps));
  return app;
}

describe("Temporal WebUI routes", () => {
  let db: Database.Database;
  let tracker: BehaviorTracker;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createDb();
    tracker = new BehaviorTracker(db);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it("GET /context/temporal returns current temporal context", async () => {
    const res = await app.request("/context/temporal?time=2026-04-24T09:00:00Z");
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.metadata.dayName).toBe("Friday");
    expect(json.data.metadata.hourOfDay).toBe(9);
  });

  it("GET /context/patterns returns detected temporal patterns", async () => {
    tracker.recordMessage({
      sessionId: "s1",
      chatId: "chat-1",
      text: "weekly review",
      timestamp: Date.parse("2026-04-24T09:00:00Z") / 1000,
    });
    tracker.recordMessage({
      sessionId: "s2",
      chatId: "chat-1",
      text: "weekly review",
      timestamp: Date.parse("2026-05-01T09:00:00Z") / 1000,
    });

    const res = await app.request("/context/patterns?includeDisabled=true");
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].description).toContain("weekly review");
  });

  it("PUT /context/patterns/:id updates a stored pattern", async () => {
    tracker.recordMessage({
      sessionId: "s1",
      chatId: "chat-1",
      text: "deploy check",
      timestamp: Date.parse("2026-04-24T09:00:00Z") / 1000,
    });
    tracker.recordMessage({
      sessionId: "s2",
      chatId: "chat-1",
      text: "deploy check",
      timestamp: Date.parse("2026-05-01T09:00:00Z") / 1000,
    });

    const patternsRes = await app.request("/context/patterns?includeDisabled=true");
    const patternsJson = await patternsRes.json();
    const id = patternsJson.data[0].id as string;

    const updateRes = await app.request(`/context/patterns/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(updateRes.status).toBe(200);
    const json = await updateRes.json();
    expect(json.data.enabled).toBe(false);
  });

  it("GET /context/timeline returns indexed temporal metadata", async () => {
    tracker.recordMessage({
      sessionId: "s1",
      chatId: "chat-1",
      text: "timeline item",
      timestamp: Date.parse("2026-04-24T01:00:00Z") / 1000,
    });

    const res = await app.request("/context/timeline?limit=5");
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data[0].entityType).toBe("behavior");
  });
});
