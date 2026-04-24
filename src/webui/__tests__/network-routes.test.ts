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

function buildNetworkApp(
  db: InstanceType<typeof Database>,
  networkConfigOverrides: Partial<NonNullable<WebUIServerDeps["networkConfig"]>> = {}
): Hono {
  const networkApp = new Hono();
  const deps = buildDeps(db, networkConfigOverrides);
  networkApp.route("/api/network", createNetworkRoutes(deps));
  networkApp.route("/api/agent-network", createAgentNetworkIngressRoutes(deps));
  return networkApp;
}

async function registerSignedAgent(
  networkApp: Hono,
  agentId: string,
  publicKey: string
): Promise<void> {
  const res = await networkApp.request("/api/network/agents", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      name: "Remote Worker",
      endpoint: `https://${agentId}.example.com/api/agent-network`,
      capabilities: ["task-delegation"],
      status: "available",
      load: 0.2,
      trustLevel: "verified",
      publicKey,
    }),
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(201);
}

function signedTaskRequest(
  privateKey: Parameters<typeof signNetworkMessage>[1],
  overrides: Partial<Parameters<typeof signNetworkMessage>[0]> = {}
) {
  return signNetworkMessage(
    {
      type: "task_request",
      from: "agent-003",
      to: "primary",
      correlationId: "route-corr-1",
      timestamp: new Date().toISOString(),
      payload: { description: "Handle delegated work", payload: { source: "test" } },
      ...overrides,
    },
    privateKey
  );
}

describe("network routes", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    app = buildNetworkApp(db);
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
    await registerSignedAgent(
      app,
      "agent-003",
      publicKey.export({ format: "pem", type: "spki" }).toString()
    );
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

  it("rejects signed ingress task requests from senders outside the configured allowlist", async () => {
    const restrictedApp = buildNetworkApp(db, { allowlist: ["different-agent"] });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedAgent(
      restrictedApp,
      "agent-003",
      publicKey.export({ format: "pem", type: "spki" }).toString()
    );

    const res = await restrictedApp.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signedTaskRequest(privateKey)),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not allowlisted");
    expect(getTaskStore(db).listTasks({ createdBy: "network:agent-003" })).toHaveLength(0);
    expect(getAgentNetworkStore(db).listMessages({ from: "agent-003" })).toHaveLength(0);
  });

  it("rejects signed ingress task requests from senders on the configured blocklist", async () => {
    const restrictedApp = buildNetworkApp(db, { blocklist: ["agent-003"] });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedAgent(
      restrictedApp,
      "agent-003",
      publicKey.export({ format: "pem", type: "spki" }).toString()
    );

    const res = await restrictedApp.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signedTaskRequest(privateKey)),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("is blocked");
    expect(getTaskStore(db).listTasks({ createdBy: "network:agent-003" })).toHaveLength(0);
    expect(getAgentNetworkStore(db).listMessages({ from: "agent-003" })).toHaveLength(0);
  });

  it("rejects signed ingress task requests addressed to a different local agent", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await registerSignedAgent(
      app,
      "agent-003",
      publicKey.export({ format: "pem", type: "spki" }).toString()
    );

    const res = await app.request("/api/agent-network", {
      method: "POST",
      body: JSON.stringify(signedTaskRequest(privateKey, { to: "other-local-agent" })),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not addressed to local agent");
    expect(getTaskStore(db).listTasks({ createdBy: "network:agent-003" })).toHaveLength(0);
    expect(getAgentNetworkStore(db).listMessages({ from: "agent-003" })).toHaveLength(0);
  });

  it("rejects remote ingress when the network is disabled", async () => {
    const disabledApp = new Hono();
    const deps = buildDeps(db, { enabled: false });
    disabledApp.route("/api/agent-network", createAgentNetworkIngressRoutes(deps));

    const res = await disabledApp.request("/api/agent-network", { method: "POST" });

    expect(res.status).toBe(403);
  });
});
