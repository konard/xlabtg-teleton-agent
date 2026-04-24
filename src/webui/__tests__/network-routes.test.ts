import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { ensureSchema } from "../../memory/schema.js";
import { getAgentNetworkStore } from "../../services/network/discovery.js";
import { signNetworkMessage } from "../../services/network/messenger.js";
import { createAgentNetworkIngressRoutes, createNetworkRoutes } from "../routes/network.js";
import type { WebUIServerDeps } from "../types.js";

const { privateKey: localPrivateKey } = generateKeyPairSync("ed25519");
const LOCAL_PRIVATE_KEY = localPrivateKey.export({ format: "pem", type: "pkcs8" }).toString();

function buildDeps(
  db: InstanceType<typeof Database>,
  networkConfigOverrides: Partial<NonNullable<WebUIServerDeps["networkConfig"]>> = {}
): WebUIServerDeps {
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
}

async function registerSignedPeer(
  app: Hono,
  input: {
    agentId: string;
    publicKey: string;
    capabilities?: string[];
  }
): Promise<void> {
  const res = await app.request("/api/network/agents", {
    method: "POST",
    body: JSON.stringify({
      agentId: input.agentId,
      name: input.agentId,
      endpoint: `https://${input.agentId}.example.com/api/agent-network`,
      capabilities: input.capabilities ?? ["task-delegation"],
      status: "available",
      load: 0.2,
      trustLevel: "verified",
      publicKey: input.publicKey,
    }),
    headers: { "Content-Type": "application/json" },
  });

  expect(res.status).toBe(201);
}

describe("network routes", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;

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
    await registerSignedPeer(app, {
      agentId: "agent-003",
      publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
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

    const unsignedRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(message),
      headers: { "Content-Type": "application/json" },
    });
    expect(unsignedRes.status).toBe(400);
  });

  it("rejects replayed signed task requests before creating duplicate tasks", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedPeer(app, {
      agentId: "agent-004",
      publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    });
    const signed = signNetworkMessage(
      {
        type: "task_request",
        from: "agent-004",
        to: "primary",
        correlationId: "route-corr-replay-task",
        timestamp: new Date().toISOString(),
        payload: { description: "Handle delegated work", payload: { source: "test" } },
      },
      privateKey
    );

    const firstRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });
    const replayRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });

    expect(firstRes.status).toBe(202);
    expect(replayRes.status).toBe(409);
    const replayBody = await replayRes.json();
    expect(replayBody.error).toMatch(/replay/i);
    expect(getTaskStore(db).listTasks({ createdBy: "network:agent-004" })).toHaveLength(1);
    expect(
      getAgentNetworkStore(db).listMessages({ from: "agent-004", to: "primary" })
    ).toHaveLength(1);
  });

  it("rejects replayed signed heartbeats", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedPeer(app, {
      agentId: "agent-005",
      publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    });
    const signed = signNetworkMessage(
      {
        type: "heartbeat",
        from: "agent-005",
        to: "primary",
        correlationId: "route-corr-replay-heartbeat",
        timestamp: new Date().toISOString(),
        payload: { status: "available", load: 0.1 },
      },
      privateKey
    );

    const firstRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });
    const replayRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });

    expect(firstRes.status).toBe(200);
    expect(replayRes.status).toBe(409);
    expect(
      getAgentNetworkStore(db).listMessages({ from: "agent-005", to: "primary" })
    ).toHaveLength(1);
  });

  it("rejects replayed signed task responses", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedPeer(app, {
      agentId: "agent-006",
      publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    });
    const signed = signNetworkMessage(
      {
        type: "task_response",
        from: "agent-006",
        to: "primary",
        correlationId: "route-corr-replay-response",
        timestamp: new Date().toISOString(),
        payload: { status: "done", result: "ok" },
      },
      privateKey
    );

    const firstRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });
    const replayRes = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signed),
      headers: { "Content-Type": "application/json" },
    });

    expect(firstRes.status).toBe(200);
    expect(replayRes.status).toBe(409);
    expect(
      getAgentNetworkStore(db).listMessages({ from: "agent-006", to: "primary" })
    ).toHaveLength(1);
  });

  it("rejects remote ingress when the network is disabled", async () => {
    const disabledApp = new Hono();
    const deps = buildDeps(db, { enabled: false });
    disabledApp.route("/api/agent-network", createAgentNetworkIngressRoutes(deps));

    const res = await disabledApp.request("/api/agent-network", { method: "POST" });

    expect(res.status).toBe(403);
  });
});
