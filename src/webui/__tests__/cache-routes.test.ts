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

import { BehaviorTracker } from "../../services/behavior-tracker.js";
import { initCache } from "../../services/cache.js";
import { initPredictions } from "../../services/predictions.js";
import { initPreloader } from "../../services/preloader.js";
import { createCacheRoutes } from "../routes/cache.js";
import type { WebUIServerDeps } from "../types.js";

function buildDeps(db: Database.Database): WebUIServerDeps {
  const registry = {
    getForContext: vi.fn(() => [{ name: "logs_search", description: "Search logs" }]),
    warmTools: vi.fn((names: string[]) => names.filter((name) => name === "logs_search")),
  };
  const config = {
    predictions: {
      enabled: true,
      confidence_threshold: 0.6,
      proactive_suggestions: false,
      max_suggestions: 5,
      history_limit: 5000,
    },
  };

  return {
    memory: { db },
    toolRegistry: registry,
    agent: {
      getConfig: () => config,
    },
  } as unknown as WebUIServerDeps;
}

describe("Cache WebUI routes", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    initCache({
      enabled: true,
      max_entries: 20,
      ttl: {
        tools_ms: 300_000,
        prompts_ms: 60_000,
        embeddings_ms: 1_800_000,
        api_responses_ms: 300_000,
      },
    });
    initPredictions(db);

    const deps = buildDeps(db);
    initPreloader({
      db,
      config: deps.agent.getConfig(),
      toolRegistry: deps.toolRegistry,
    });

    app = new Hono();
    app.route("/cache", createCacheRoutes(deps));
  });

  afterEach(() => {
    db.close();
  });

  it("GET /cache/stats returns cache metrics and entries", async () => {
    const res = await app.request("/cache/stats");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      enabled: true,
      size: 0,
      byType: expect.any(Object),
      entries: expect.any(Array),
    });
  });

  it("POST /cache/warm warms predicted tools without blocking request handling", async () => {
    const tracker = new BehaviorTracker(db);
    tracker.recordMessage({ sessionId: "s1", chatId: "chat-1", text: "inspect logs" });
    tracker.recordToolInvocation({ sessionId: "s1", chatId: "chat-1", toolName: "logs_search" });

    const res = await app.request("/cache/warm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "inspect logs", chatId: "chat-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.warmed.tools).toContain("logs_search");
  });

  it("POST /cache/invalidate removes a specific entry", async () => {
    const warmRes = await app.request("/cache/warm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "inspect logs", chatId: "chat-1" }),
    });
    expect(warmRes.status).toBe(200);

    const statsRes = await app.request("/cache/stats");
    const stats = await statsRes.json();
    const key = stats.data.entries[0].key;

    const invalidateRes = await app.request(`/cache/invalidate?key=${encodeURIComponent(key)}`, {
      method: "POST",
    });
    expect(invalidateRes.status).toBe(200);

    const json = await invalidateRes.json();
    expect(json.success).toBe(true);
    expect(json.data.invalidated).toBe(1);
  });
});
