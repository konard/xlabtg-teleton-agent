import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AgentLifecycle } from "../../agent/lifecycle.js";
import { createAgentsRoutes } from "../routes/agents.js";
import type { WebUIServerDeps } from "../types.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function buildDeps(): WebUIServerDeps {
  const lifecycle = new AgentLifecycle();
  lifecycle.registerCallbacks(
    async () => {},
    async () => {}
  );

  return {
    lifecycle,
    configPath: "/tmp/teleton/config.yaml",
    agent: {
      getConfig: vi.fn(() => ({
        meta: {
          created_at: "2026-04-23T00:00:00.000Z",
          last_modified_at: "2026-04-23T01:00:00.000Z",
        },
        agent: { provider: "anthropic", model: "claude-opus-4-6" },
        telegram: { owner_id: 123, admin_ids: [123], bot_token: undefined },
      })),
    },
    agentManager: {
      listAgentSnapshots: vi.fn(() => [
        {
          id: "support-copy",
          name: "Support Copy",
          mode: "personal",
          homePath: "/tmp/teleton/agents/support-copy",
          configPath: "/tmp/teleton/agents/support-copy/config.yaml",
          workspacePath: "/tmp/teleton/agents/support-copy/workspace",
          logPath: "/tmp/teleton/agents/support-copy/logs/agent.log",
          createdAt: "2026-04-23T00:10:00.000Z",
          updatedAt: "2026-04-23T00:10:00.000Z",
          sourceId: null,
          provider: "anthropic",
          model: "claude-opus-4-6",
          ownerId: 123,
          adminIds: [123],
          hasBotToken: false,
          state: "stopped",
          pid: null,
          startedAt: null,
          uptimeMs: null,
          lastError: null,
        },
      ]),
      createAgent: vi.fn(() => ({
        id: "lab-copy",
        name: "Lab Copy",
        mode: "personal",
        homePath: "/tmp/teleton/agents/lab-copy",
        configPath: "/tmp/teleton/agents/lab-copy/config.yaml",
        workspacePath: "/tmp/teleton/agents/lab-copy/workspace",
        logPath: "/tmp/teleton/agents/lab-copy/logs/agent.log",
        createdAt: "2026-04-23T00:20:00.000Z",
        updatedAt: "2026-04-23T00:20:00.000Z",
        sourceId: null,
        provider: "anthropic",
        model: "claude-opus-4-6",
        ownerId: 123,
        adminIds: [123],
        hasBotToken: false,
        state: "stopped",
        pid: null,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
      })),
      getAgentSnapshot: vi.fn(() => ({
        id: "support-copy",
        name: "Support Copy",
      })),
      deleteAgent: vi.fn(),
      getRuntimeStatus: vi.fn(() => ({
        state: "running",
        pid: 4242,
        startedAt: "2026-04-23T00:21:00.000Z",
        uptimeMs: 5_000,
        lastError: null,
      })),
      startAgent: vi.fn(() => ({
        state: "starting",
        pid: 4242,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
      })),
      stopAgent: vi.fn(() => ({
        state: "stopping",
        pid: 4242,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
      })),
      readLogs: vi.fn(() => ({
        lines: ["line one", "line two"],
        path: "/tmp/teleton/agents/support-copy/logs/agent.log",
      })),
    },
  } as unknown as WebUIServerDeps;
}

function buildApp(deps: WebUIServerDeps) {
  const app = new Hono();
  app.route("/api/agents", createAgentsRoutes(deps));
  return app;
}

describe("Agents routes", () => {
  let deps: WebUIServerDeps;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    deps = buildDeps();
    app = buildApp(deps);
  });

  it("lists the primary and managed agents together", async () => {
    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.agents[0].id).toBe("primary");
    expect(body.data.agents[1].id).toBe("support-copy");
  });

  it("creates a managed agent from the request body", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Lab Copy", mode: "bot" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).createAgent
    ).toHaveBeenCalledWith({
      name: "Lab Copy",
      id: undefined,
      cloneFromId: undefined,
      mode: "bot",
    });
  });

  it("marks bot-mode managed agents as not startable in the overview", async () => {
    (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).listAgentSnapshots = vi.fn(
      () => [
        {
          id: "faq-bot",
          name: "FAQ Bot",
          mode: "bot",
          homePath: "/tmp/teleton/agents/faq-bot",
          configPath: "/tmp/teleton/agents/faq-bot/config.yaml",
          workspacePath: "/tmp/teleton/agents/faq-bot/workspace",
          logPath: "/tmp/teleton/agents/faq-bot/logs/agent.log",
          createdAt: "2026-04-23T00:10:00.000Z",
          updatedAt: "2026-04-23T00:10:00.000Z",
          sourceId: null,
          provider: "anthropic",
          model: "claude-opus-4-6",
          ownerId: 123,
          adminIds: [123],
          hasBotToken: true,
          state: "stopped",
          pid: null,
          startedAt: null,
          uptimeMs: null,
          lastError: null,
        },
      ]
    );

    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.agents[1].mode).toBe("bot");
    expect(body.data.agents[1].canStart).toBe(false);
  });

  it("starts the primary agent through the shared lifecycle", async () => {
    const res = await app.request("/api/agents/primary/start", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.state).toBe("starting");
  });

  it("rejects deleting the primary agent", async () => {
    const res = await app.request("/api/agents/primary", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("returns managed agent logs", async () => {
    const res = await app.request("/api/agents/support-copy/logs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.lines).toEqual(["line one", "line two"]);
  });
});
