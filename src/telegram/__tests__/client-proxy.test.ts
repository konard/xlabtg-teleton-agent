/**
 * Tests for TelegramUserClient MTProto proxy connection logic.
 * Verifies that proxies are tried in order, auth flow is triggered when
 * no session exists (whether via proxy or direct), and failover works.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../formatting.js", () => ({
  markdownToTelegramHtml: (s: string) => s,
}));

vi.mock("../flood-retry.js", () => ({
  withFloodRetry: (fn: () => unknown) => fn(),
}));

// Use vi.hoisted so variables are available inside vi.mock factories
const { mockConnect, mockGetMe, mockInvoke, mockExistsSync } = vi.hoisted(() => {
  const mockConnect = vi.fn();
  const mockGetMe = vi.fn();
  const mockInvoke = vi.fn();
  const mockExistsSync = vi.fn();
  return { mockConnect, mockGetMe, mockInvoke, mockExistsSync };
});

vi.mock("telegram", () => {
  class MockTelegramClient {
    session: { save: () => string };
    constructor(_session: unknown, _apiId: number, _apiHash: string) {
      this.session = { save: () => "" };
    }
    connect = mockConnect;
    disconnect = vi.fn();
    getMe = mockGetMe;
    invoke = mockInvoke;
    connected = true;
    addEventHandler = vi.fn();
  }

  class SentCode {
    phoneCodeHash = "hash123";
  }
  class SentCodeSuccess {}
  class SentCodeTypeFragmentSms {}
  class SendCode {}
  class SignIn {}
  class CheckPassword {}
  class GetPassword {}
  class CodeSettings {}
  class User {}

  return {
    TelegramClient: MockTelegramClient,
    Api: {
      User,
      auth: { SendCode, SentCode, SentCodeSuccess, SentCodeTypeFragmentSms, SignIn, CheckPassword },
      account: { GetPassword },
      CodeSettings,
      messages: { SetTyping: class {} },
      SendMessageTypingAction: class {},
      contacts: { ResolveUsername: class {} },
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

vi.mock("telegram/events/index.js", () => ({
  NewMessage: class {},
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

import { TelegramUserClient } from "../client.js";

const BASE_CONFIG = {
  apiId: 12345,
  apiHash: "testhash",
  phone: "+1234567890",
  sessionPath: "/test/session.txt",
};

const MOCK_ME = {
  id: { toString: () => "12345" },
  username: "testuser",
  firstName: "Test",
  lastName: undefined,
  phone: "+1234567890",
  bot: false,
};

describe("TelegramUserClient — proxy connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockGetMe.mockResolvedValue(MOCK_ME);
  });

  describe("with existing session", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("connects via first proxy when session exists", async () => {
      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "aabbcc" }],
      });

      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toBe(true);
    });

    it("falls back to second proxy when first fails (session present)", async () => {
      mockConnect
        .mockRejectedValueOnce(new Error("proxy1 unreachable"))
        .mockResolvedValueOnce(undefined);

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "aabbcc" },
          { server: "proxy2.example.com", port: 443, secret: "ddeeff" },
        ],
      });

      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(client.isConnected()).toBe(true);
    });

    it("falls back to direct connection when all proxies fail (session present)", async () => {
      mockConnect
        .mockRejectedValueOnce(new Error("proxy1 unreachable"))
        .mockRejectedValueOnce(new Error("proxy2 unreachable"))
        .mockResolvedValueOnce(undefined);

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "aabbcc" },
          { server: "proxy2.example.com", port: 443, secret: "ddeeff" },
        ],
      });

      await client.connect();

      // connect called: proxy1 (fails), proxy2 (fails), direct (succeeds)
      expect(mockConnect).toHaveBeenCalledTimes(3);
      expect(client.isConnected()).toBe(true);
    });

    it("connects directly when no proxies configured and session exists", async () => {
      const client = new TelegramUserClient(BASE_CONFIG);

      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toBe(true);
    });

    it("does not reconnect when already connected", async () => {
      const client = new TelegramUserClient(BASE_CONFIG);

      await client.connect();
      await client.connect(); // second call should be a no-op

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("without existing session (auth flow required)", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(false);
    });

    it("triggers auth flow (invoke) after proxy connection when no session", async () => {
      // invoke throws so we can detect it was called without completing the full auth flow
      mockInvoke.mockRejectedValueOnce(new Error("test: SendCode called via proxy"));

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "aabbcc" }],
      });

      await expect(client.connect()).rejects.toThrow("test: SendCode called via proxy");

      // connect was called once (proxy TCP connection)
      expect(mockConnect).toHaveBeenCalledTimes(1);
      // invoke was called (auth flow was reached after proxy TCP connection)
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("triggers auth flow after direct connection when no session and no proxies", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("test: SendCode called directly"));

      const client = new TelegramUserClient(BASE_CONFIG);

      await expect(client.connect()).rejects.toThrow("test: SendCode called directly");

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("triggers auth flow via direct fallback when all proxies fail and no session", async () => {
      mockConnect
        .mockRejectedValueOnce(new Error("proxy unreachable"))
        .mockResolvedValueOnce(undefined); // direct connection succeeds
      mockInvoke.mockRejectedValueOnce(new Error("test: SendCode called after direct fallback"));

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "aabbcc" }],
      });

      await expect(client.connect()).rejects.toThrow("test: SendCode called after direct fallback");

      // connect called: proxy (fails) + direct (succeeds) = 2 times
      expect(mockConnect).toHaveBeenCalledTimes(2);
      // auth flow was reached
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("fails when all proxies fail and direct also fails (no session)", async () => {
      // All connections fail
      mockConnect.mockRejectedValue(new Error("network unreachable"));

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "aabbcc" }],
      });

      await expect(client.connect()).rejects.toThrow("network unreachable");

      // proxy (fails) + direct (fails) = 2 connection attempts
      expect(mockConnect).toHaveBeenCalledTimes(2);
      // Auth flow should NOT be triggered if even direct failed
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });
});
