import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { initAnalytics } from "../../services/analytics.js";
import { BehaviorTracker } from "../../services/behavior-tracker.js";
import { createDataSourceCatalog } from "../../services/data-source-catalog.js";
import { initMetrics } from "../../services/metrics.js";
import type { GeneratedWidgetDefinition } from "../../services/widget-generator.js";
import { createWidgetGeneratorRoutes } from "../routes/widget-generator.js";
import type { WebUIServerDeps } from "../types.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
    agent: {
      getConfig: () => ({
        agent: {
          model: "test-model",
          provider: "test-provider",
        },
        predictions: {
          enabled: true,
          confidence_threshold: 0.6,
          max_suggestions: 5,
        },
      }),
    },
    toolRegistry: {
      getAll: () => [{ name: "search" }, { name: "read_file" }],
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/widgets", createWidgetGeneratorRoutes(deps));
  return app;
}

function createDefinition(sourceId: string): GeneratedWidgetDefinition {
  const source = createDataSourceCatalog().get(sourceId);
  if (!source) throw new Error(`missing test data source: ${sourceId}`);
  const now = new Date().toISOString();

  return {
    id: `generated:test-${sourceId}`,
    title: source.name,
    description: source.description,
    renderer: "table",
    dataSource: {
      id: source.id,
      endpoint: source.endpoint,
      method: source.method,
      params: source.params ? { period: "7d" } : undefined,
      refreshInterval: 30_000,
    },
    config: {
      columns: source.fields.map((field) => field.key),
    },
    style: {
      palette: "default",
    },
    defaultSize: {
      w: 6,
      h: 5,
    },
    generatedFrom: `Preview ${source.name}`,
    refinementHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function seedPreviewData(db: Database.Database) {
  const metrics = initMetrics(db);
  metrics.recordToolCall("search");
  metrics.recordTokenUsage(1_000, 0.05);

  db.exec(`
    CREATE TABLE knowledge (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE chats (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE tasks (
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO knowledge (id) VALUES (?)").run("knowledge-1");
  db.prepare("INSERT INTO messages (id) VALUES (?)").run("message-1");
  db.prepare("INSERT INTO chats (id) VALUES (?)").run("chat-1");
  db.prepare("INSERT INTO sessions (id) VALUES (?)").run("session-1");
  db.prepare(
    "INSERT INTO tasks (description, status, priority, created_at) VALUES (?, ?, ?, ?)"
  ).run("Review preview parity", "pending", 1, Math.floor(Date.now() / 1000));

  initAnalytics(db).recordRequestMetric({
    toolName: "search",
    durationMs: 200,
    success: true,
  });
  initAnalytics(db).recordRequestMetric({
    toolName: "read_file",
    durationMs: 500,
    success: false,
    errorMessage: "failed",
  });

  const tracker = new BehaviorTracker(db);
  for (let i = 0; i < 2; i++) {
    tracker.recordMessage({ sessionId: `prediction-${i}`, chatId: "chat-1", text: "check status" });
    tracker.recordMessage({ sessionId: `prediction-${i}`, chatId: "chat-1", text: "run tests" });
  }
  tracker.recordMessage({
    sessionId: "prediction-preview",
    chatId: "chat-1",
    text: "check status",
  });
}

describe("widget generator routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    app = buildApp(db);
  });

  it("lists generation templates and available data sources", async () => {
    const templates = await app.request("/widgets/templates");
    const sources = await app.request("/widgets/data-sources");

    expect(templates.status).toBe(200);
    expect(sources.status).toBe(200);
    expect(
      (await templates.json()).data.some((entry: { id: string }) => entry.id === "compare")
    ).toBe(true);
    expect(
      (await sources.json()).data.some((entry: { id: string }) => entry.id === "metrics.tools")
    ).toBe(true);
  });

  it("generates widget definitions from natural language", async () => {
    const res = await app.request("/widgets/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Compare tool usage over the last 7 days" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.definition.dataSource.id).toBe("metrics.tools");
    expect(json.data.definition.config.chartType).toBe("bar");
  });

  it("rejects empty generation prompts", async () => {
    const res = await app.request("/widgets/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "   " }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("prompt is required");
  });

  it("previews generated widgets with real metric data", async () => {
    const metrics = initMetrics(db);
    metrics.recordToolCall("search");
    metrics.recordToolCall("search");
    metrics.recordToolCall("read_file");

    const generateRes = await app.request("/widgets/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Show tool usage as a pie chart" }),
      headers: { "Content-Type": "application/json" },
    });
    const generated = await generateRes.json();

    const previewRes = await app.request("/widgets/preview", {
      method: "POST",
      body: JSON.stringify({ definition: generated.data.definition }),
      headers: { "Content-Type": "application/json" },
    });

    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.success).toBe(true);
    expect(preview.data.data).toEqual([
      { tool: "search", count: 2 },
      { tool: "read_file", count: 1 },
    ]);
  });

  it("returns preview rows for every advertised data source", async () => {
    seedPreviewData(db);

    for (const source of createDataSourceCatalog().list()) {
      const previewRes = await app.request("/widgets/preview", {
        method: "POST",
        body: JSON.stringify({ definition: createDefinition(source.id) }),
        headers: { "Content-Type": "application/json" },
      });

      expect(previewRes.status, source.id).toBe(200);
      const preview = await previewRes.json();
      expect(preview.success, source.id).toBe(true);
      expect(
        preview.data.fields.map((field: { key: string }) => field.key),
        source.id
      ).toEqual(source.fields.map((field) => field.key));
      expect(preview.data.data.length, source.id).toBeGreaterThan(0);
    }
  });
});
