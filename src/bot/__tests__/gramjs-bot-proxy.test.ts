/**
 * Tests for GramJSBotClient MTProto proxy connection logic.
 * Verifies that proxies are tried in order with a per-proxy timeout,
 * abandoned clients are disconnected, and failover to direct works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../telegram/flood-retry.js", () => ({
  withFloodRetry: (fn: () => unknown) => fn(),
}));

const { mockStart, mockDisconnect, mockExistsSync } = vi.hoisted(() => {
  const mockStart = vi.fn();
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockExistsSync = vi.fn();
  return { mockStart, mockDisconnect, mockExistsSync };
});

vi.mock("telegram", () => {
  class MockTelegramClient {
    session: { save: () => string };
    connected = true;
    constructor() {
      this.session = { save: () => "" };
    }
    start = mockStart;
    disconnect = mockDisconnect;
    connect = vi.fn();
    getMe = vi.fn();
    invoke = vi.fn();
  }

  return {
    TelegramClient: MockTelegramClient,
    Api: {
      messages: {
        SetInlineBotResults: class {},
        EditInlineBotMessage: class {},
      },
      InputBotInlineMessageID: class {},
      InputBotInlineMessageID64: class {},
    },
  };
});

vi.mock("telegram/extensions/Logger.js", () => ({
  Logger: class {},
  LogLevel: { NONE: 0 },
}));

vi.mock("telegram/sessions/index.js", () => ({
  StringSession: class {
    constructor(public value: string = "") {}
    save() {
      return this.value;
    }
  },
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("path", () => ({
  dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
}));

// Use a short timeout (100 ms) so timeout tests complete quickly
vi.mock("../../constants/timeouts.js", () => ({
  GRAMJS_RETRY_DELAY_MS: 10,
  GRAMJS_CONNECT_RETRY_DELAY_MS: 10,
  MTPROTO_PROXY_CONNECT_TIMEOUT_MS: 100,
}));

vi.mock("../../constants/limits.js", () => ({
  TELEGRAM_CONNECTION_RETRIES: 2,
}));

vi.mock("../../utils/gramjs-bigint.js", () => ({
  toLong: (v: unknown) => v,
}));

import { GramJSBotClient } from "../gramjs-bot.js";

const BOT_TOKEN = "123456:ABC-DEF";

describe("GramJSBotClient — proxy timeout and cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockStart.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects via first proxy on success", async () => {
    const client = new GramJSBotClient(12345, "hash", "/tmp/session", [
      { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
    ]);

    await client.connect(BOT_TOKEN);

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);
  });

  it("times out a hanging proxy and falls back to the next one", async () => {
    mockStart
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      )
      .mockResolvedValueOnce(undefined);

    vi.useFakeTimers();

    const client = new GramJSBotClient(12345, "hash", "/tmp/session", [
      { server: "hanging.example.com", port: 443, secret: "a".repeat(32) },
      { server: "good.example.com", port: 443, secret: "b".repeat(32) },
    ]);

    const connectPromise = client.connect(BOT_TOKEN);
    await vi.runAllTimersAsync();
    await connectPromise;

    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);
    // Timed-out proxy client must be disconnected
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("times out all proxies and falls back to direct connection", async () => {
    mockStart
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      )
      .mockResolvedValueOnce(undefined);

    vi.useFakeTimers();

    const client = new GramJSBotClient(12345, "hash", "/tmp/session", [
      { server: "hang1.example.com", port: 443, secret: "a".repeat(32) },
      { server: "hang2.example.com", port: 443, secret: "b".repeat(32) },
    ]);

    const connectPromise = client.connect(BOT_TOKEN);
    await vi.runAllTimersAsync();
    await connectPromise;

    // proxy1 (timeout) + proxy2 (timeout) + direct (success) = 3 calls
    expect(mockStart).toHaveBeenCalledTimes(3);
    expect(client.isConnected()).toBe(true);
    // Both timed-out proxy clients must be disconnected
    expect(mockDisconnect).toHaveBeenCalledTimes(2);
  });

  it("disconnects failed proxy client on connection error", async () => {
    mockStart
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(undefined);

    const client = new GramJSBotClient(12345, "hash", "/tmp/session", [
      { server: "bad.example.com", port: 443, secret: "a".repeat(32) },
      { server: "good.example.com", port: 443, secret: "b".repeat(32) },
    ]);

    await client.connect(BOT_TOKEN);

    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
