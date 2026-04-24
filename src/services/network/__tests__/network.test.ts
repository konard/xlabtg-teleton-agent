import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../memory/schema.js";
import { NetworkTaskCoordinator } from "../coordinator.js";
import { getAgentNetworkStore } from "../discovery.js";
import { NetworkMessenger, signNetworkMessage, verifyNetworkMessage } from "../messenger.js";
import { NetworkTrustService } from "../trust.js";
import type { AgentNetworkAdvertisement } from "../types.js";

describe("agent network services", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("registers advertised agents and summarizes network health", () => {
    const store = getAgentNetworkStore(db);
    const advertisement: AgentNetworkAdvertisement = {
      agentId: "research-remote",
      name: "Remote Research",
      endpoint: "https://remote.example.com/api/agent-network",
      capabilities: ["web-search", "summarization"],
      status: "available",
      load: 0.2,
      publicKey: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
    };

    const registered = store.registerAgent(advertisement, { trustLevel: "verified" });

    expect(registered.id).toBe("research-remote");
    expect(registered.capabilities).toEqual(["web-search", "summarization"]);
    expect(registered.trustLevel).toBe("verified");
    expect(store.listAgents()).toHaveLength(1);
    expect(store.getNetworkStatus()).toMatchObject({
      totalAgents: 1,
      availableAgents: 1,
      trustedAgents: 1,
    });
  });

  it("rejects non-local HTTP peer endpoints", () => {
    const store = getAgentNetworkStore(db);

    expect(() =>
      store.registerAgent({
        agentId: "plain-http-agent",
        name: "Plain HTTP Agent",
        endpoint: "http://remote.example.com/api/agent-network",
        capabilities: [],
        status: "available",
        load: 0,
      })
    ).toThrow("must use HTTPS");
  });

  it("signs and verifies canonical network messages", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const message = {
      type: "heartbeat" as const,
      from: "research-remote",
      to: "primary",
      correlationId: "corr-1",
      timestamp: "2026-04-24T00:00:00.000Z",
      payload: { status: "available", load: 0.1 },
    };

    const signed = signNetworkMessage(message, privateKey);

    expect(signed.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifyNetworkMessage(signed, publicKey)).toBe(true);
    expect(verifyNetworkMessage({ ...signed, payload: { status: "offline" } }, publicKey)).toBe(
      false
    );
  });

  it("requires valid signatures for inbound messages", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const store = getAgentNetworkStore(db);
    store.registerAgent(
      {
        agentId: "research-remote",
        name: "Remote Research",
        endpoint: "https://remote.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.2,
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
      { trustLevel: "verified" }
    );
    const messenger = new NetworkMessenger({ store, localAgentId: "primary" });
    const message = {
      type: "task_request" as const,
      from: "research-remote",
      to: "primary",
      correlationId: "corr-2",
      timestamp: new Date().toISOString(),
      payload: { description: "Summarize this document" },
    };

    const record = messenger.receiveMessage(signNetworkMessage(message, privateKey));

    expect(record.status).toBe("received");
    expect(() => messenger.receiveMessage(message)).toThrow("Invalid signature");
  });

  it("rejects inbound messages addressed to another local agent", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const store = getAgentNetworkStore(db);
    store.registerAgent(
      {
        agentId: "research-remote",
        name: "Remote Research",
        endpoint: "https://remote.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.2,
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
      { trustLevel: "verified" }
    );
    const messenger = new NetworkMessenger({ store, localAgentId: "primary" });
    const message = {
      type: "task_request" as const,
      from: "research-remote",
      to: "other-local-agent",
      correlationId: "corr-wrong-recipient",
      timestamp: new Date().toISOString(),
      payload: { description: "Summarize this document" },
    };

    expect(() => messenger.receiveMessage(signNetworkMessage(message, privateKey))).toThrow(
      "not addressed to local agent"
    );
    expect(store.listMessages({ from: "research-remote" })).toHaveLength(0);
  });

  it("applies configured inbound trust policy before logging received messages", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const store = getAgentNetworkStore(db);
    store.registerAgent(
      {
        agentId: "research-remote",
        name: "Remote Research",
        endpoint: "https://remote.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.2,
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
      { trustLevel: "verified" }
    );
    const messenger = new NetworkMessenger({
      store,
      localAgentId: "primary",
      trustService: new NetworkTrustService({ allowlist: ["other-agent"] }),
    });
    const message = {
      type: "task_request" as const,
      from: "research-remote",
      to: "primary",
      correlationId: "corr-not-allowlisted",
      timestamp: new Date().toISOString(),
      payload: { description: "Summarize this document" },
    };

    expect(() => messenger.receiveMessage(signNetworkMessage(message, privateKey))).toThrow(
      "not allowlisted"
    );
    expect(store.listMessages({ from: "research-remote" })).toHaveLength(0);
  });

  it("delegates work to the least-loaded verified capable agent and logs the message", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const store = getAgentNetworkStore(db);
    store.registerAgent(
      {
        agentId: "busy-agent",
        name: "Busy Agent",
        endpoint: "https://busy.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.9,
      },
      { trustLevel: "verified" }
    );
    store.registerAgent(
      {
        agentId: "idle-agent",
        name: "Idle Agent",
        endpoint: "https://idle.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.1,
      },
      { trustLevel: "trusted" }
    );
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })
    );
    const coordinator = new NetworkTaskCoordinator({
      store,
      fetcher,
      localAgentId: "primary",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    });

    const result = await coordinator.delegateTask({
      description: "Summarize the research brief",
      requiredCapabilities: ["summarization"],
      payload: { briefId: "brief-1" },
    });

    expect(result.agent.id).toBe("idle-agent");
    expect(fetcher).toHaveBeenCalledWith(
      "https://idle.example.com/api/agent-network",
      expect.objectContaining({ method: "POST" })
    );
    expect(store.listMessages({ to: "idle-agent" })).toHaveLength(1);
  });

  it("logs failed outbound deliveries once", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const store = getAgentNetworkStore(db);
    const agent = store.registerAgent(
      {
        agentId: "failing-agent",
        name: "Failing Agent",
        endpoint: "https://failing.example.com/api/agent-network",
        capabilities: ["summarization"],
        status: "available",
        load: 0.1,
      },
      { trustLevel: "verified" }
    );
    const messenger = new NetworkMessenger({
      store,
      localAgentId: "primary",
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      fetcher: vi.fn(
        async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })
      ),
    });

    await expect(
      messenger.sendMessage(agent, {
        type: "task_request",
        payload: { description: "Summarize this document" },
      })
    ).rejects.toThrow("HTTP 503");

    const messages = store.listMessages({ to: "failing-agent" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: "failed", error: "HTTP 503" });
  });
});
