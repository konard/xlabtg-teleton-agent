import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

import { createFeedbackRoutes } from "../routes/feedback.js";
import { createDepsAdapter } from "../../api/deps.js";
import type { ApiServerDeps } from "../../api/deps.js";
import type { WebUIServerDeps } from "../types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tg_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      is_from_agent INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
  `);
  return db;
}

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
    agent: {
      getConfig: () => ({
        feedback: {
          enabled: true,
          implicit_signals: true,
          prompt_adjustments: true,
          min_feedback_for_prompt: 2,
        },
      }),
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/feedback", createFeedbackRoutes(deps));
  return app;
}

describe("Feedback WebUI routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it("POST /feedback records explicit feedback", async () => {
    const res = await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        messageId: "message-1",
        type: "positive",
        rating: 5,
        text: "Helpful",
        tags: ["helpful"],
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.sessionId).toBe("session-1");

    const row = db
      .prepare("SELECT type, rating FROM feedback WHERE message_id = ?")
      .get("message-1") as { type: string; rating: number } | undefined;
    expect(row).toEqual({ type: "positive", rating: 5 });
  });

  it("GET /feedback filters by session", async () => {
    await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", messageId: "a", type: "negative" }),
    });
    await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2", messageId: "b", type: "positive" }),
    });

    const res = await app.request("/feedback?session=session-1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.feedback).toHaveLength(1);
    expect(json.data.feedback[0].sessionId).toBe("session-1");
  });

  it("GET /feedback/analytics and /feedback/themes expose aggregates", async () => {
    await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        messageId: "a",
        type: "negative",
        text: "Too long",
        tags: ["too_long"],
      }),
    });

    const analytics = await app.request("/feedback/analytics");
    expect(analytics.status).toBe(200);
    const analyticsJson = await analytics.json();
    expect(analyticsJson.data.totalFeedback).toBe(1);

    const themes = await app.request("/feedback/themes");
    expect(themes.status).toBe(200);
    const themesJson = await themes.json();
    expect(themesJson.data[0].theme).toBe("too_verbose");
  });

  it("GET and PUT /feedback/preferences manage manual preference overrides", async () => {
    const update = await app.request("/feedback/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseLength: "concise", interactionStyle: "direct" }),
    });
    expect(update.status).toBe(200);

    const res = await app.request("/feedback/preferences");
    const json = await res.json();
    expect(json.data.responseLength.value).toBe("concise");
    expect(json.data.responseLength.source).toBe("manual");
    expect(json.data.interactionStyle.value).toBe("direct");
  });

  it("rejects invalid feedback payloads", async () => {
    const res = await app.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "", type: "bad" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("uses default capture options when runtime agent config is unavailable", async () => {
    const adaptedDeps = createDepsAdapter({
      agent: null,
      memory: { db },
      config: {},
      configPath: "",
    } as unknown as ApiServerDeps);
    const proxyApp = new Hono();
    proxyApp.route("/feedback", createFeedbackRoutes(adaptedDeps));

    const res = await proxyApp.request("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", messageId: "m1", type: "positive" }),
    });

    expect(res.status).toBe(201);
  });
});
