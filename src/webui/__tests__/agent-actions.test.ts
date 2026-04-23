import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../memory/index.js", () => ({
  getDatabase: vi.fn(() => ({
    getDb: vi.fn(() => ({})),
  })),
}));

import { createAgentActionsRoutes } from "../routes/agent-actions.js";
import type { WebUIServerDeps } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function buildDeps(overrides: Partial<WebUIServerDeps> = {}): WebUIServerDeps {
  return {
    agent: {
      getConfig: vi.fn(() => ({
        heartbeat: { enabled: true, interval_ms: 300_000, prompt: "Check status" },
        telegram: { admin_ids: [12345] },
      })),
      processMessage: vi.fn(async () => ({ content: "NO_ACTION", toolCalls: [] })),
    },
    bridge: {
      isAvailable: vi.fn(() => true),
      sendMessage: vi.fn(async () => {}),
    },
    ...overrides,
  } as unknown as WebUIServerDeps;
}

function buildApp(deps: WebUIServerDeps) {
  const app = new Hono();
  app.route("/", createAgentActionsRoutes(deps));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("POST /heartbeat/trigger", () => {
  let deps: WebUIServerDeps;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = buildDeps();
    app = buildApp(deps);
  });

  it("returns 422 when heartbeat is disabled", async () => {
    deps = buildDeps({
      agent: {
        getConfig: vi.fn(() => ({
          heartbeat: { enabled: false, interval_ms: 300_000, prompt: "Check status" },
          telegram: { admin_ids: [12345] },
        })),
        processMessage: vi.fn(),
      } as unknown as WebUIServerDeps["agent"],
    });
    app = buildApp(deps);

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/disabled/i);
  });

  it("returns 422 when no admin_ids configured", async () => {
    deps = buildDeps({
      agent: {
        getConfig: vi.fn(() => ({
          heartbeat: { enabled: true, interval_ms: 300_000, prompt: "Check status" },
          telegram: { admin_ids: [] },
        })),
        processMessage: vi.fn(),
      } as unknown as WebUIServerDeps["agent"],
    });
    app = buildApp(deps);

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("suppresses NO_ACTION response and does not send to Telegram", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "NO_ACTION",
      toolCalls: [],
    });

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suppressed).toBe(true);
    expect(body.data.sentToTelegram).toBe(false);
    expect(deps.bridge.sendMessage).not.toHaveBeenCalled();
  });

  it("sends actionable response to Telegram when bridge is available", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Alert: disk usage is at 95%",
      toolCalls: [],
    });

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suppressed).toBe(false);
    expect(body.data.sentToTelegram).toBe(true);
    expect(deps.bridge.sendMessage).toHaveBeenCalledWith({
      chatId: "12345",
      text: "Alert: disk usage is at 95%",
    });
  });

  it("does not send to Telegram and reports sentToTelegram=false when bridge unavailable", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Alert: something is wrong",
      toolCalls: [],
    });
    (deps.bridge.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suppressed).toBe(false);
    expect(body.data.sentToTelegram).toBe(false);
    expect(deps.bridge.sendMessage).not.toHaveBeenCalled();
  });

  it("suppresses __SILENT__ response and does not send to Telegram", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "__SILENT__",
      toolCalls: [],
    });

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(true);
    expect(body.data.sentToTelegram).toBe(false);
  });

  it("returns 500 when processMessage throws", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM unavailable")
    );

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/LLM unavailable/i);
  });

  it("sentToTelegram reflects actual send, not a re-check of bridge availability", async () => {
    (deps.agent.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Something needs attention",
      toolCalls: [],
    });

    let callCount = 0;
    (deps.bridge.isAvailable as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // Returns true on first call (before send), false on any subsequent call
      return callCount++ === 0;
    });

    const res = await app.request("/heartbeat/trigger", { method: "POST" });
    const body = await res.json();
    // sentToTelegram must reflect the actual send, not a second isAvailable() call
    expect(body.data.sentToTelegram).toBe(true);
    expect(deps.bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
});
