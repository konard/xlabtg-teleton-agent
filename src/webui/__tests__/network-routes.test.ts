import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { AutonomousTaskManager } from "../../autonomous/manager.js";
import type { LoopDependencies } from "../../autonomous/loop.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { ensureSchema } from "../../memory/schema.js";
import { signNetworkMessage } from "../../services/network/messenger.js";
import { createAgentNetworkIngressRoutes, createNetworkRoutes } from "../routes/network.js";
import type { WebUIServerDeps } from "../types.js";

const { privateKey: localPrivateKey } = generateKeyPairSync("ed25519");
const LOCAL_PRIVATE_KEY = localPrivateKey.export({ format: "pem", type: "pkcs8" }).toString();
type SigningKey = Parameters<typeof signNetworkMessage>[1];

function buildDeps(
  db: InstanceType<typeof Database>,
  networkConfigOverrides: Partial<NonNullable<WebUIServerDeps["networkConfig"]>> = {},
  depsOverrides: Partial<WebUIServerDeps> = {}
): WebUIServerDeps {
  const deps: WebUIServerDeps = {
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
      getAll: vi.fn(() => [{ name: "web_search" }, { name: "workspace_write" }]),
    } as unknown as WebUIServerDeps["toolRegistry"],
    plugins: [],
    mcpServers: [],
    networkConfig: {
      enabled: true,
      agent_id: "primary",
      agent_name: "Primary Agent",
      endpoint: null,
      discovery_mode: "central",
      registry_url: null,
      known_peers: [],
      public_key: null,
      private_key: LOCAL_PRIVATE_KEY,
      allowlist: [],
      blocklist: [],
      default_trust_level: "untrusted",
      message_timeout_ms: 5000,
      max_clock_skew_seconds: 300,
      ...networkConfigOverrides,
    },
  };
  return { ...deps, ...depsOverrides };
}

function hangingLoopDeps(): LoopDependencies {
  return {
    planNextAction: vi.fn().mockImplementation(() => new Promise(() => {})),
    executeTool: vi.fn().mockResolvedValue({ success: true, durationMs: 1 }),
    evaluateSuccess: vi.fn().mockResolvedValue(false),
    selfReflect: vi.fn().mockResolvedValue({ progressSummary: "", isStuck: false }),
    escalate: vi.fn().mockResolvedValue(undefined),
  };
}

async function signedTaskRequest(app: Hono, privateKey: SigningKey, from = "agent-003") {
  const message = {
    type: "task_request" as const,
    from,
    to: "primary",
    correlationId: "route-corr-1",
    timestamp: new Date().toISOString(),
    payload: { description: "Handle delegated work", payload: { source: "test" } },
  };

  return app.request("/api/agent-network", {
    method: "POST",
    body: JSON.stringify(signNetworkMessage(message, privateKey)),
    headers: { "Content-Type": "application/json" },
  });
}

describe("network routes", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;
  let managers: AutonomousTaskManager[] = [];

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    app = new Hono();
    const deps = buildDeps(db);
    app.route("/api/network", createNetworkRoutes(deps));
    app.route("/api/agent-network", createAgentNetworkIngressRoutes(deps));
  });

  afterEach(() => {
    for (const manager of managers) manager.stopAll();
    managers = [];
    vi.unstubAllGlobals();
    db.close();
  });

  it("registers remote agents and updates trust", async () => {
    const registerRes = await app.request("/api/network/agents", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-001",
        name: "ResearchBot",
        endpoint: "https://agent-001.example.com/api/agent-network",
        capabilities: ["web-search", "summarization"],
        status: "available",
        load: 0.3,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(registerRes.status).toBe(201);

    const trustRes = await app.request("/api/network/agents/agent-001/trust", {
      method: "PUT",
      body: JSON.stringify({ trustLevel: "verified" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(trustRes.status).toBe(200);

    const listRes = await app.request("/api/network/agents");
    const listBody = await listRes.json();
    expect(listBody.data.agents[0]).toMatchObject({
      id: "agent-001",
      trustLevel: "verified",
      status: "available",
    });
  });

  it("delegates task requests through the network API and exposes the message log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }))
    );

    await app.request("/api/network/agents", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-002",
        name: "Remote Summarizer",
        endpoint: "https://agent-002.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.1,
        trustLevel: "verified",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const taskRes = await app.request("/api/network/agents/agent-002/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Summarize this document",
        requiredCapabilities: ["summarization"],
        payload: { documentId: "doc-1" },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(taskRes.status).toBe(202);
    const taskBody = await taskRes.json();
    expect(taskBody.data.agent.id).toBe("agent-002");

    const messagesRes = await app.request("/api/network/messages?to=agent-002");
    const messagesBody = await messagesRes.json();
    expect(messagesBody.data.messages).toHaveLength(1);
    expect(messagesBody.data.messages[0]).toMatchObject({
      type: "task_request",
      from: "primary",
      to: "agent-002",
      status: "sent",
    });
  });

  it("accepts signed ingress task requests and rejects unsigned ones", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await app.request("/api/network/agents", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-003",
        name: "Remote Worker",
        endpoint: "https://agent-003.example.com/api/agent-network",
        capabilities: ["task-delegation"],
        status: "available",
        load: 0.2,
        trustLevel: "verified",
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      }),
      headers: { "Content-Type": "application/json" },
    });
    const message = {
      type: "task_request" as const,
      from: "agent-003",
      to: "primary",
      correlationId: "route-corr-1",
      timestamp: new Date().toISOString(),
      payload: { description: "Handle delegated work", payload: { source: "test" } },
    };

    const acceptedRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signNetworkMessage(message, privateKey)),
      headers: { "Content-Type": "application/json" },
    });
    expect(acceptedRes.status).toBe(202);
    const acceptedBody = await acceptedRes.json();
    expect(acceptedBody.data.taskId).toEqual(expect.any(String));
    expect(acceptedBody.data).toMatchObject({
      taskRuntime: "manual_inbox",
      taskStatus: "pending",
      execution: {
        mode: "manual_inbox",
        state: "queued",
      },
    });
    expect(getTaskStore(db).getTask(acceptedBody.data.taskId)).toMatchObject({
      status: "pending",
      createdBy: "network:agent-003",
    });

    const unsignedRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(message),
      headers: { "Content-Type": "application/json" },
    });
    expect(unsignedRes.status).toBe(400);
  });

  it("dispatches signed ingress task requests to the autonomous manager when available", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await app.request("/api/network/agents", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-004",
        name: "Remote Autonomous Worker",
        endpoint: "https://agent-004.example.com/api/agent-network",
        capabilities: ["task-delegation"],
        status: "available",
        load: 0.2,
        trustLevel: "verified",
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      }),
      headers: { "Content-Type": "application/json" },
    });

    const manager = new AutonomousTaskManager(db, hangingLoopDeps());
    managers.push(manager);
    const ingressApp = new Hono();
    ingressApp.route(
      "/api/agent-network",
      createAgentNetworkIngressRoutes(buildDeps(db, {}, { autonomousManager: manager }))
    );

    const acceptedRes = await signedTaskRequest(ingressApp, privateKey, "agent-004");
    expect(acceptedRes.status).toBe(202);
    const acceptedBody = await acceptedRes.json();
    expect(acceptedBody.data).toMatchObject({
      accepted: true,
      taskRuntime: "autonomous",
      taskStatus: "running",
      execution: { mode: "autonomous", state: "dispatched" },
    });

    const task = getAutonomousTaskStore(db).getTask(acceptedBody.data.taskId);
    expect(task).toMatchObject({
      goal: "Handle delegated work",
      context: {
        network: {
          from: "agent-004",
          correlationId: "route-corr-1",
        },
        payload: { source: "test" },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAutonomousTaskStore(db).getTask(acceptedBody.data.taskId)?.status).toBe("running");
    expect(manager.isTaskRunning(acceptedBody.data.taskId)).toBe(true);
  });

  it("rejects remote ingress when the network is disabled", async () => {
    const disabledApp = new Hono();
    const deps = buildDeps(db, { enabled: false });
    disabledApp.route("/api/agent-network", createAgentNetworkIngressRoutes(deps));

    const res = await disabledApp.request("/api/agent-network", { method: "POST" });

    expect(res.status).toBe(403);
  });
});
