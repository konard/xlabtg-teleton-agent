import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AgentLifecycle } from "../../agent/lifecycle.js";
import { createAgentsRoutes } from "../routes/agents.js";
import type { WebUIServerDeps } from "../types.js";

const telegramAuthMocks = vi.hoisted(() => ({
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  verifyPassword: vi.fn(),
  resendCode: vi.fn(),
  startQrSession: vi.fn(),
  refreshQrToken: vi.fn(),
  cancelSession: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../services/audit.js", () => ({
  initAudit: vi.fn(() => ({
    log: vi.fn(),
  })),
}));

vi.mock("../setup-auth.js", () => ({
  TelegramAuthManager: vi.fn(function TelegramAuthManager() {
    return telegramAuthMocks;
  }),
}));

function managedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "support-copy",
    name: "Support Copy",
    mode: "personal",
    memoryPolicy: "isolated",
    resources: {
      maxMemoryMb: 512,
      maxConcurrentTasks: 10,
      rateLimitPerMinute: 60,
      llmRateLimitPerMinute: 30,
      restartOnCrash: true,
      maxRestarts: 3,
      restartBackoffMs: 5000,
    },
    messaging: {
      enabled: true,
      allowlist: ["primary"],
      maxMessagesPerMinute: 30,
    },
    security: {
      personalAccountAccessConfirmedAt: "2026-04-23T00:00:00.000Z",
    },
    connection: {
      botUsername: null,
    },
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
    hasPersonalCredentials: true,
    hasPersonalSession: true,
    personalPhoneMasked: "+********90",
    state: "stopped",
    pid: null,
    startedAt: null,
    uptimeMs: null,
    lastError: null,
    transport: "mtproto",
    health: "stopped",
    restartCount: 0,
    lastExitAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    pendingMessages: 0,
    ...overrides,
  };
}

function buildDeps(): WebUIServerDeps {
  const lifecycle = new AgentLifecycle();
  lifecycle.registerCallbacks(
    async () => {},
    async () => {}
  );

  return {
    lifecycle,
    configPath: "/tmp/teleton/config.yaml",
    memory: {
      db: { prepare: vi.fn() } as unknown as WebUIServerDeps["memory"]["db"],
      embedder: {} as WebUIServerDeps["memory"]["embedder"],
      knowledge: {} as WebUIServerDeps["memory"]["knowledge"],
    },
    agent: {
      getConfig: vi.fn(() => ({
        meta: {
          created_at: "2026-04-23T00:00:00.000Z",
          last_modified_at: "2026-04-23T01:00:00.000Z",
        },
        agent: { provider: "anthropic", model: "claude-opus-4-6" },
        telegram: {
          owner_id: 123,
          admin_ids: [123],
          bot_token: undefined,
          bot_username: undefined,
        },
      })),
    },
    agentManager: {
      listAgentSnapshots: vi.fn(() => [managedSnapshot()]),
      createAgent: vi.fn(() =>
        managedSnapshot({
          id: "lab-copy",
          name: "Lab Copy",
          mode: "bot",
          hasBotToken: true,
          transport: "bot-api",
          connection: { botUsername: "lab_bot" },
        })
      ),
      updateAgent: vi.fn(() =>
        managedSnapshot({ id: "support-copy", name: "Support Copy Updated" })
      ),
      getAgentSnapshot: vi.fn(() => ({
        id: "support-copy",
        name: "Support Copy",
      })),
      resolvePersonalAuthTarget: vi.fn(() => ({
        configPath: "/tmp/teleton/agents/support-copy/config.yaml",
        sessionPath: "/tmp/teleton/agents/support-copy/telegram_session.txt",
        apiId: 12345,
        apiHash: "abcdef",
        phone: "+1234567890",
      })),
      recordPersonalAuth: vi.fn(() => managedSnapshot()),
      deleteAgent: vi.fn(),
      getRuntimeStatus: vi.fn(() => ({
        state: "running",
        pid: 4242,
        startedAt: "2026-04-23T00:21:00.000Z",
        uptimeMs: 5_000,
        lastError: null,
        transport: "mtproto",
        health: "healthy",
        restartCount: 0,
        lastExitAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        pendingMessages: 1,
      })),
      startAgent: vi.fn(() => ({
        state: "starting",
        pid: 4242,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
        transport: "bot-api",
        health: "starting",
        restartCount: 0,
        lastExitAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        pendingMessages: 0,
      })),
      stopAgent: vi.fn(() => ({
        state: "stopping",
        pid: 4242,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
        transport: "mtproto",
        health: "starting",
        restartCount: 0,
        lastExitAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        pendingMessages: 0,
      })),
      readLogs: vi.fn(() => ({
        lines: ["line one", "line two"],
        path: "/tmp/teleton/agents/support-copy/logs/agent.log",
      })),
      readMessages: vi.fn(() => ({
        messages: [
          {
            id: "msg-1",
            fromId: "primary",
            toId: "support-copy",
            text: "hello",
            createdAt: "2026-04-23T01:00:00.000Z",
            deliveredAt: null,
          },
        ],
      })),
      sendMessage: vi.fn(() => ({
        id: "msg-2",
        fromId: "primary",
        toId: "support-copy",
        text: "ship it",
        createdAt: "2026-04-23T01:10:00.000Z",
        deliveredAt: null,
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
    vi.clearAllMocks();
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

  it("creates a managed agent with mode-aware payload", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Lab Copy",
        mode: "bot",
        botToken: "123456:ABCDEF",
        botUsername: "lab_bot",
        memoryPolicy: "isolated",
        messaging: { enabled: true, allowlist: ["primary"] },
      }),
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
      botToken: "123456:ABCDEF",
      botUsername: "lab_bot",
      memoryPolicy: "isolated",
      resources: undefined,
      messaging: { enabled: true, allowlist: ["primary"] },
      acknowledgePersonalAccountAccess: undefined,
      personalConnection: undefined,
    });
  });

  it("creates a personal managed agent with standalone Telegram credentials", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Personal Lab",
        mode: "personal",
        personalConnection: {
          apiId: 23456,
          apiHash: "personal-hash",
          phone: "+15551234567",
        },
        acknowledgePersonalAccountAccess: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).createAgent
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Personal Lab",
        mode: "personal",
        personalConnection: {
          apiId: 23456,
          apiHash: "personal-hash",
          phone: "+15551234567",
        },
        acknowledgePersonalAccountAccess: true,
      })
    );
  });

  it("validates bot-token format before bot-mode setup", async () => {
    const res = await app.request("/api/agents/validate-bot-token", {
      method: "POST",
      body: JSON.stringify({ token: "not-a-token" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(false);
    expect(body.data.error).toContain("Invalid format");
  });

  it("explains why non-isolated managed agents cannot start", async () => {
    (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).listAgentSnapshots = vi.fn(
      () => [
        managedSnapshot({
          id: "shared-memory",
          memoryPolicy: "shared-read",
        }),
      ]
    );

    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.agents[1].canStart).toBe(false);
    expect(body.data.agents[1].canStartReason).toContain("shared-read");
  });

  it("updates a managed agent", async () => {
    const res = await app.request("/api/agents/support-copy", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Support Copy Updated",
        messaging: { enabled: true, allowlist: ["primary", "lab-copy"] },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).updateAgent
    ).toHaveBeenCalledWith("support-copy", {
      name: "Support Copy Updated",
      messaging: { enabled: true, allowlist: ["primary", "lab-copy"] },
    });
  });

  it("starts managed personal auth against the agent-specific config and session path", async () => {
    telegramAuthMocks.sendCode.mockResolvedValueOnce({
      authSessionId: "auth-1",
      codeDelivery: "app",
      codeLength: 5,
      expiresAt: Date.now() + 60_000,
    });

    const res = await app.request("/api/agents/support-copy/personal-auth/send-code", {
      method: "POST",
      body: JSON.stringify({
        apiId: 23456,
        apiHash: "personal-hash",
        phone: "+15551234567",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).resolvePersonalAuthTarget
    ).toHaveBeenCalledWith("support-copy", {
      apiId: 23456,
      apiHash: "personal-hash",
      phone: "+15551234567",
    });
    expect(telegramAuthMocks.sendCode).toHaveBeenCalledWith(12345, "abcdef", "+1234567890", {
      configPath: "/tmp/teleton/agents/support-copy/config.yaml",
      sessionPath: "/tmp/teleton/agents/support-copy/telegram_session.txt",
    });
  });

  it("records successful managed personal auth verification", async () => {
    telegramAuthMocks.verifyCode.mockResolvedValueOnce({
      status: "authenticated",
      user: { id: 123, firstName: "Alex", username: "alex" },
    });

    const res = await app.request("/api/agents/support-copy/personal-auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ authSessionId: "auth-1", code: "12345" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(telegramAuthMocks.verifyCode).toHaveBeenCalledWith("auth-1", "12345");
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).recordPersonalAuth
    ).toHaveBeenCalledWith("support-copy");
  });

  it("starts managed personal QR auth against the agent-specific config and session path", async () => {
    telegramAuthMocks.startQrSession.mockResolvedValueOnce({
      authSessionId: "qr-auth-1",
      token: "qr-token",
      expires: 1_714_000_000,
      expiresAt: Date.now() + 60_000,
    });

    const res = await app.request("/api/agents/support-copy/personal-auth/qr-start", {
      method: "POST",
      body: JSON.stringify({
        apiId: 23456,
        apiHash: "personal-hash",
        phone: "+15551234567",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).resolvePersonalAuthTarget
    ).toHaveBeenCalledWith("support-copy", {
      apiId: 23456,
      apiHash: "personal-hash",
      phone: "+15551234567",
    });
    expect(telegramAuthMocks.startQrSession).toHaveBeenCalledWith(12345, "abcdef", {
      configPath: "/tmp/teleton/agents/support-copy/config.yaml",
      sessionPath: "/tmp/teleton/agents/support-copy/telegram_session.txt",
    });
  });

  it("records successful managed personal QR authentication", async () => {
    telegramAuthMocks.refreshQrToken.mockResolvedValueOnce({
      status: "authenticated",
      user: { id: 123, firstName: "Alex", username: "alex" },
    });

    const res = await app.request("/api/agents/support-copy/personal-auth/qr-refresh", {
      method: "POST",
      body: JSON.stringify({ authSessionId: "qr-auth-1" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(telegramAuthMocks.refreshQrToken).toHaveBeenCalledWith("qr-auth-1");
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).recordPersonalAuth
    ).toHaveBeenCalledWith("support-copy");
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

  it("returns and appends managed inbox messages", async () => {
    const listRes = await app.request("/api/agents/support-copy/messages");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.messages).toHaveLength(1);

    const sendRes = await app.request("/api/agents/support-copy/messages", {
      method: "POST",
      body: JSON.stringify({ fromId: "primary", text: "ship it" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(sendRes.status).toBe(201);
    expect(
      (deps.agentManager as NonNullable<WebUIServerDeps["agentManager"]>).sendMessage
    ).toHaveBeenCalledWith("primary", "support-copy", "ship it");
  });
});
