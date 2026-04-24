import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { initMetrics } from "../../services/metrics.js";
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
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/widgets", createWidgetGeneratorRoutes(deps));
  return app;
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
});
