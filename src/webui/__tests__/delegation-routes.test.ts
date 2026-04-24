import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { createTasksRoutes } from "../routes/tasks.js";
import type { WebUIServerDeps } from "../types.js";

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function buildDeps(db: InstanceType<typeof Database>): WebUIServerDeps {
  return {
    configPath: "/tmp/teleton/config.yaml",
    config: {
      auth_token: "test",
      cors_origins: ["*"],
      log_requests: false,
    } as WebUIServerDeps["config"],
    memory: {
      db,
      embedder: {} as WebUIServerDeps["memory"]["embedder"],
      knowledge: {} as WebUIServerDeps["memory"]["knowledge"],
    },
    agent: {
      getConfig: vi.fn(() => ({
        agent: { provider: "anthropic", model: "claude-opus-4-6" },
        telegram: {},
        meta: {},
      })),
    } as unknown as WebUIServerDeps["agent"],
    bridge: {} as WebUIServerDeps["bridge"],
    toolRegistry: {
      getAll: vi.fn(() => [{ name: "workspace_write" }, { name: "web_search" }]),
    } as unknown as WebUIServerDeps["toolRegistry"],
    plugins: [],
    mcpServers: [],
    agentManager: {
      listAgentSnapshots: vi.fn(() => [
        {
          id: "code-agent",
          name: "Code Agent",
          type: "CodeAgent",
          description: "Implements, reviews, debugs, and tests code changes.",
          tools: ["workspace_read", "workspace_write"],
          state: "running",
          pendingMessages: 0,
          resources: { maxConcurrentTasks: 6 },
        },
      ]),
      sendMessage: vi.fn(() => ({
        id: "msg-1",
        fromId: "primary",
        toId: "code-agent",
        text: "delegated",
        createdAt: "2026-04-24T00:00:00.000Z",
        deliveredAt: null,
      })),
    } as unknown as WebUIServerDeps["agentManager"],
  };
}

describe("task delegation routes", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;
  let taskId: string;

  beforeEach(() => {
    db = createDb();
    taskId = getTaskStore(db).createTask({ description: "Implement search and tests" }).id;
    app = new Hono();
    app.route("/api/tasks", createTasksRoutes(buildDeps(db)));
  });

  afterEach(() => {
    db.close();
  });

  it("decomposes a task into assigned subtasks and returns the tree", async () => {
    const res = await app.request(`/api/tasks/${taskId}/decompose`, {
      method: "POST",
      body: JSON.stringify({
        subtasks: [
          {
            planId: "code",
            description: "Implement the code change",
            requiredSkills: ["code"],
            requiredTools: ["workspace_write"],
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subtasks[0].agentId).toBe("code-agent");
    expect(body.data.tree.subtasks).toHaveLength(1);
  });

  it("manually delegates an existing subtask", async () => {
    const createRes = await app.request(`/api/tasks/${taskId}/decompose`, {
      method: "POST",
      body: JSON.stringify({ subtasks: [{ description: "Review output" }] }),
      headers: { "Content-Type": "application/json" },
    });
    const created = await createRes.json();
    const subtaskId = created.data.subtasks[0].id;

    const res = await app.request(`/api/tasks/${taskId}/delegate`, {
      method: "POST",
      body: JSON.stringify({ subtaskId, agentId: "primary" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subtask.agentId).toBe("primary");
    expect(body.data.subtask.status).toBe("delegated");
  });
});
