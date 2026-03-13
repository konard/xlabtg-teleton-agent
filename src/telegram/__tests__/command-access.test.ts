import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelegramConfig } from "../../config/schema.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { TelegramBridge } from "../bridge.js";
import { AdminHandler } from "../admin.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  isVerbose: vi.fn(() => false),
  setVerbose: vi.fn(),
}));

vi.mock("../../ton/wallet-service.js", () => ({
  getWalletAddress: vi.fn(() => null),
  getWalletBalance: vi.fn(() => null),
}));

vi.mock("../../workspace/manager.js", () => ({
  loadTemplate: vi.fn(() => "bootstrap content"),
}));

vi.mock("../../sdk/secrets.js", () => ({
  writePluginSecret: vi.fn(),
  deletePluginSecret: vi.fn(() => false),
  listPluginSecretKeys: vi.fn(() => []),
}));

vi.mock("../../deals/config.js", () => ({
  DEALS_CONFIG: {
    strategy: { buyMaxMultiplier: 0.95, sellMinMultiplier: 1.05 },
  },
}));

function makeConfig(overrides: Partial<TelegramConfig["command_access"]> = {}): TelegramConfig {
  return {
    api_id: 123,
    api_hash: "hash",
    phone: "+1234567890",
    session_name: "test",
    session_path: "~/.teleton",
    dm_policy: "allowlist",
    allow_from: [],
    group_policy: "open",
    group_allow_from: [],
    require_mention: false,
    max_message_length: 4096,
    typing_simulation: false,
    rate_limit_messages_per_second: 1,
    rate_limit_groups_per_minute: 20,
    admin_ids: [100],
    agent_channel: null,
    debounce_ms: 0,
    command_access: {
      commands_enabled: true,
      admin_only_commands: false,
      allowed_user_ids: [],
      allowed_chat_ids: [],
      unknown_command_reply: true,
      ...overrides,
    },
  } as TelegramConfig;
}

function makeHandler(
  configOverrides: Partial<TelegramConfig["command_access"]> = {}
): AdminHandler {
  const config = makeConfig(configOverrides);
  const bridge = {} as TelegramBridge;
  const agent = {
    getActiveChatIds: vi.fn(() => []),
    getConfig: vi.fn(() => ({
      agent: { provider: "anthropic", model: "claude-opus-4-6", max_agentic_iterations: 5 },
      tool_rag: { enabled: true, top_k: 25, always_include: [] },
    })),
    clearHistory: vi.fn(),
  } as unknown as AgentRuntime;
  return new AdminHandler(bridge, config, agent);
}

// ── isCommandAllowed tests ─────────────────────────────────────────────

describe("AdminHandler.isCommandAllowed", () => {
  describe("admin always has access", () => {
    it("admin bypasses commands_enabled=false", () => {
      const h = makeHandler({ commands_enabled: false });
      expect(h.isCommandAllowed(100, "42")).toBe(true);
    });

    it("admin bypasses admin_only_commands=true", () => {
      const h = makeHandler({ admin_only_commands: true });
      expect(h.isCommandAllowed(100, "42")).toBe(true);
    });

    it("admin bypasses allowed_user_ids restriction", () => {
      const h = makeHandler({ allowed_user_ids: [999] });
      expect(h.isCommandAllowed(100, "42")).toBe(true);
    });

    it("admin bypasses allowed_chat_ids restriction", () => {
      const h = makeHandler({ allowed_chat_ids: [777] });
      expect(h.isCommandAllowed(100, "999")).toBe(true);
    });
  });

  describe("commands_enabled=false blocks non-admins", () => {
    it("blocks non-admin when commands disabled", () => {
      const h = makeHandler({ commands_enabled: false });
      expect(h.isCommandAllowed(200, "42")).toBe(false);
    });

    it("allows non-admin when commands enabled", () => {
      const h = makeHandler({ commands_enabled: true });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });
  });

  describe("admin_only_commands blocks non-admins", () => {
    it("blocks non-admin when admin_only_commands=true", () => {
      const h = makeHandler({ admin_only_commands: true });
      expect(h.isCommandAllowed(200, "42")).toBe(false);
    });

    it("allows non-admin when admin_only_commands=false", () => {
      const h = makeHandler({ admin_only_commands: false });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });
  });

  describe("allowed_user_ids restriction", () => {
    it("allows user in allowed_user_ids", () => {
      const h = makeHandler({ allowed_user_ids: [200, 300] });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });

    it("blocks user not in allowed_user_ids when list is non-empty", () => {
      const h = makeHandler({ allowed_user_ids: [300] });
      expect(h.isCommandAllowed(200, "42")).toBe(false);
    });

    it("allows any user when allowed_user_ids is empty", () => {
      const h = makeHandler({ allowed_user_ids: [] });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });
  });

  describe("allowed_chat_ids restriction", () => {
    it("allows chat in allowed_chat_ids", () => {
      const h = makeHandler({ allowed_chat_ids: [42, 99] });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });

    it("blocks chat not in allowed_chat_ids when list is non-empty", () => {
      const h = makeHandler({ allowed_chat_ids: [99] });
      expect(h.isCommandAllowed(200, "42")).toBe(false);
    });

    it("allows any chat when allowed_chat_ids is empty", () => {
      const h = makeHandler({ allowed_chat_ids: [] });
      expect(h.isCommandAllowed(200, "42")).toBe(true);
    });
  });
});

// ── unknown_command_reply tests ────────────────────────────────────────

describe("AdminHandler.handleCommand — unknown_command_reply", () => {
  it("returns non-empty reply for unknown command when unknown_command_reply=true", async () => {
    const h = makeHandler({ unknown_command_reply: true });
    const result = await h.handleCommand(
      { command: "nonexistent", args: [], chatId: "1", senderId: 100 },
      "1",
      100
    );
    expect(result).toContain("Unknown command");
    expect(result).toContain("/help");
  });

  it("returns empty string for unknown command when unknown_command_reply=false", async () => {
    const h = makeHandler({ unknown_command_reply: false });
    const result = await h.handleCommand(
      { command: "nonexistent", args: [], chatId: "1", senderId: 100 },
      "1",
      100
    );
    expect(result).toBe("");
  });

  it("still returns response for known commands regardless of unknown_command_reply", async () => {
    const h = makeHandler({ unknown_command_reply: false });
    const result = await h.handleCommand(
      { command: "ping", args: [], chatId: "1", senderId: 100 },
      "1",
      100
    );
    expect(result).toBe("🏓 Pong!");
  });
});
