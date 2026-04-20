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

// Mock the goal-parser module to avoid real LLM calls.
vi.mock("../../autonomous/goal-parser.js", () => ({
  parseGoalFromNaturalLanguage: vi.fn(),
}));

import { createAutonomousRoutes } from "../routes/autonomous.js";
import { ensureSchema } from "../../memory/schema.js";
import { parseGoalFromNaturalLanguage } from "../../autonomous/goal-parser.js";
import type { WebUIServerDeps } from "../types.js";

function createTestDb(): Database.Database {
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
        agent: {
          provider: "anthropic",
          api_key: "sk-ant-test",
          model: "claude-opus-4-6",
          utility_model: "claude-haiku-4-5-20251001",
        },
      }),
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/autonomous", createAutonomousRoutes(deps));
  return app;
}

describe("POST /autonomous/parse-goal", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.mocked(parseGoalFromNaturalLanguage).mockReset();
    db = createTestDb();
    app = buildApp(db);
  });

  it("returns parsed task spec when the LLM succeeds", async () => {
    vi.mocked(parseGoalFromNaturalLanguage).mockResolvedValue({
      goal: "Monitor new DeDust pools every 5 minutes",
      successCriteria: ["at least one pool recorded"],
      failureConditions: [],
      constraints: { maxIterations: 60 },
      suggestedStrategy: "balanced",
      suggestedPriority: "medium",
      confidence: 0.91,
    });

    const res = await app.request("/autonomous/parse-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        naturalLanguage: "Следи за новыми пулами DeDust каждые 5 минут",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.goal).toBe("Monitor new DeDust pools every 5 minutes");
    expect(json.data.confidence).toBe(0.91);
    expect(json.data.suggestedStrategy).toBe("balanced");
    expect(parseGoalFromNaturalLanguage).toHaveBeenCalledWith(
      "Следи за новыми пулами DeDust каждые 5 минут",
      expect.objectContaining({ provider: "anthropic", api_key: "sk-ant-test" })
    );
  });

  it("rejects an empty naturalLanguage with 400", async () => {
    const res = await app.request("/autonomous/parse-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ naturalLanguage: "   " }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/naturalLanguage/);
    expect(parseGoalFromNaturalLanguage).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is missing the field entirely", async () => {
    const res = await app.request("/autonomous/parse-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("surfaces parser errors as 500 with the message", async () => {
    vi.mocked(parseGoalFromNaturalLanguage).mockRejectedValue(
      new Error("LLM call failed: 429 rate limited")
    );

    const res = await app.request("/autonomous/parse-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ naturalLanguage: "do the thing" }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("429 rate limited");
  });
});
