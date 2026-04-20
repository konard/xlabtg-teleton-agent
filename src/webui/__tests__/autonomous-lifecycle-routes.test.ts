import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { createAutonomousRoutes } from "../routes/autonomous.js";
import { ensureSchema } from "../../memory/schema.js";
import { AutonomousTaskManager } from "../../autonomous/manager.js";
import type { LoopDependencies } from "../../autonomous/loop.js";
import type { WebUIServerDeps } from "../types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function stubLoopDeps(): LoopDependencies {
  return {
    planNextAction: vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // never resolves — keeps the task in "running" status so we can
          // assert lifecycle transitions without racing with completion.
        })
    ),
    executeTool: vi.fn().mockResolvedValue({ success: true, durationMs: 1 }),
    evaluateSuccess: vi.fn().mockResolvedValue(false),
    selfReflect: vi.fn().mockResolvedValue({ progressSummary: "", isStuck: false }),
    escalate: vi.fn().mockResolvedValue(undefined),
  };
}

function buildApp(db: Database.Database, manager: AutonomousTaskManager) {
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
    autonomousManager: manager,
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/autonomous", createAutonomousRoutes(deps));
  return app;
}

describe("Autonomous lifecycle routes start the loop", () => {
  let db: Database.Database;
  let manager: AutonomousTaskManager;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    manager = new AutonomousTaskManager(db, stubLoopDeps());
    app = buildApp(db, manager);
  });

  afterEach(() => {
    manager.stopAll();
    db.close();
  });

  it("POST / creates a task and starts execution (status becomes running)", async () => {
    const res = await app.request("/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Monitor pools" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    const taskId = json.data.id;

    // Give the async loop a tick to call updateTaskStatus("running")
    await new Promise((r) => setTimeout(r, 20));

    const getRes = await app.request(`/autonomous/${taskId}`);
    const getJson = await getRes.json();
    expect(getJson.data.status).toBe("running");
    expect(manager.isTaskRunning(taskId)).toBe(true);
  });

  it("POST /:id/resume re-starts the loop for a paused task", async () => {
    // Create a task
    const createRes = await app.request("/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Resumable" }),
    });
    const { data: created } = await createRes.json();
    const taskId = created.id;
    await new Promise((r) => setTimeout(r, 20));

    // Pause
    const pauseRes = await app.request(`/autonomous/${taskId}/pause`, { method: "POST" });
    expect(pauseRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));

    let getJson = await (await app.request(`/autonomous/${taskId}`)).json();
    expect(getJson.data.status).toBe("paused");
    expect(manager.isTaskRunning(taskId)).toBe(false);

    // Resume — this must actually restart the loop, not just set status=pending
    const resumeRes = await app.request(`/autonomous/${taskId}/resume`, { method: "POST" });
    expect(resumeRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));

    getJson = await (await app.request(`/autonomous/${taskId}`)).json();
    expect(getJson.data.status).toBe("running");
    expect(manager.isTaskRunning(taskId)).toBe(true);
  });

  it("POST /:id/stop cancels the task and stops the loop", async () => {
    const createRes = await app.request("/autonomous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Stoppable" }),
    });
    const { data: created } = await createRes.json();
    const taskId = created.id;
    await new Promise((r) => setTimeout(r, 20));

    const stopRes = await app.request(`/autonomous/${taskId}/stop`, { method: "POST" });
    expect(stopRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));

    const getJson = await (await app.request(`/autonomous/${taskId}`)).json();
    expect(getJson.data.status).toBe("cancelled");
    expect(manager.isTaskRunning(taskId)).toBe(false);
  });
});
