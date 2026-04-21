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
import { createPredictionsRoutes } from "../routes/predictions.js";
import type { WebUIServerDeps } from "../types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      result TEXT,
      error TEXT,
      scheduled_for INTEGER,
      payload TEXT,
      reason TEXT,
      scheduled_message_id INTEGER,
      recurrence_interval INTEGER,
      recurrence_until INTEGER
    );

    CREATE TABLE task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id)
    );
  `);
  return db;
}

function buildApp(db: Database.Database) {
  const deps = {
    memory: { db },
    agent: {
      getConfig: () => ({
        predictions: {
          enabled: true,
          confidence_threshold: 0.6,
          proactive_suggestions: false,
          max_suggestions: 5,
          history_limit: 5000,
        },
      }),
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/predictions", createPredictionsRoutes(deps));
  return app;
}

describe("Prediction WebUI routes", () => {
  let db: Database.Database;
  let tracker: BehaviorTracker;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    tracker = new BehaviorTracker(db);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it("GET /predictions/next returns learned next actions", async () => {
    tracker.recordMessage({ sessionId: "s1", chatId: "chat-1", text: "check status" });
    tracker.recordMessage({ sessionId: "s1", chatId: "chat-1", text: "run tests" });
    tracker.recordMessage({ sessionId: "s2", chatId: "chat-1", text: "check status" });
    tracker.recordMessage({ sessionId: "s2", chatId: "chat-1", text: "run tests" });

    const res = await app.request("/predictions/next?context=check%20status");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data[0].action).toBe("run tests");
  });

  it("GET /predictions/tools returns likely tools for context", async () => {
    tracker.recordMessage({ sessionId: "s1", chatId: "chat-1", text: "inspect logs" });
    tracker.recordToolInvocation({ sessionId: "s1", chatId: "chat-1", toolName: "logs_search" });

    const res = await app.request("/predictions/tools?context=logs");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data[0].action).toBe("logs_search");
  });

  it("POST /predictions/feedback records helpfulness", async () => {
    const res = await app.request("/predictions/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "next",
        action: "run tests",
        confidence: 0.9,
        reason: "Usually follows check status",
        helpful: false,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const row = db
      .prepare("SELECT helpful FROM prediction_feedback WHERE action = ?")
      .get("run tests") as { helpful: number };
    expect(row.helpful).toBe(0);
  });

  it("POST /predictions/execute queues a task from a suggestion", async () => {
    const res = await app.request("/predictions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run tests",
        confidence: 0.9,
        reason: "Usually follows check status",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.description).toBe("run tests");
    expect(json.data.createdBy).toBe("prediction-engine");
  });
});
