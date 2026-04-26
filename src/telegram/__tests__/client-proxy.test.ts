/**
 * Tests for TelegramUserClient MTProto proxy connection logic.
 * Verifies that proxies are tried in order, auth flow is triggered when
 * no session exists (whether via proxy or direct), and failover works.
 * Also tests the connection timeout that prevents indefinite hangs on
 * unresponsive proxies, and the getActiveProxyIndex() accessor.
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

vi.mock("../formatting.js", () => ({
  markdownToTelegramHtml: (s: string) => s,
}));

vi.mock("../flood-retry.js", () => ({
  withFloodRetry: (fn: () => unknown) => fn(),
}));

// Use vi.hoisted so variables are available inside vi.mock factories
const {
  mockConnect,
  mockDisconnect,
  mockGetMe,
  mockInvoke,
  mockExistsSync,
  mockReadFileSync,
  mockUnlinkSync,
  constructedOptions,
  constructedSessions,
} = vi.hoisted(() => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetMe = vi.fn();
  const mockInvoke = vi.fn();
  const mockExistsSync = vi.fn();
  const mockReadFileSync = vi.fn();
  const mockUnlinkSync = vi.fn();
  const constructedOptions: Array<Record<string, unknown>> = [];
  const constructedSessions: string[] = [];
  return {
    mockConnect,
    mockDisconnect,
    mockGetMe,
    mockInvoke,
    mockExistsSync,
    mockReadFileSync,
    mockUnlinkSync,
    constructedOptions,
    constructedSessions,
  };
});

vi.mock("telegram", () => {
  class MockTelegramClient {
    session: { save: () => string };
    constructor(
      session: { value?: string },
      _apiId: number,
      _apiHash: string,
      options: Record<string, unknown> = {}
    ) {
      constructedOptions.push(options);
      this.session = { save: () => session.value ?? "" };
    }
    connect = mockConnect;
    disconnect = mockDisconnect;
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
    constructor(public value: string = "") {
      constructedSessions.push(value);
    }
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
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock("path", () => ({
  dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
}));

// Use a short timeout (100 ms) so timeout tests complete quickly without real delays
vi.mock("../../constants/timeouts.js", () => ({
  MTPROTO_PROXY_CONNECT_TIMEOUT_MS: 100,
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
    constructedOptions.length = 0;
    constructedSessions.length = 0;
    mockConnect.mockResolvedValue(undefined);
    mockGetMe.mockResolvedValue(MOCK_ME);
    mockReadFileSync.mockReturnValue("");
  });

  describe("with existing session", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("connects via first proxy when session exists", async () => {
      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
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
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
        ],
      });

      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(client.isConnected()).toBe(true);
    });

    it("falls back to second proxy when first connects but getMe fails with a network error", async () => {
      mockGetMe.mockRejectedValueOnce(new Error("getMe timed out")).mockResolvedValueOnce(MOCK_ME);

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
        ],
      });

      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockGetMe).toHaveBeenCalledTimes(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(client.getActiveProxyIndex()).toBe(1);
      expect(client.isConnected()).toBe(true);
    });

    it("keeps first proxy and triggers auth flow when getMe fails with auth error (401)", async () => {
      // getMe returns an auth error — proxy transport is fine, session just expired
      const authError = Object.assign(new Error("401: UNAUTHORIZED"), {
        code: 401,
        errorMessage: "UNAUTHORIZED",
      });
      mockGetMe.mockRejectedValueOnce(authError);
      // Auth flow calls SendCode via invoke — throw to detect it was reached
      mockInvoke.mockRejectedValueOnce(new Error("test: auth flow reached via proxy"));

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
        ],
      });

      await expect(client.connect()).rejects.toThrow("test: auth flow reached via proxy");

      // Only proxy1 was used. It is reconnected with a fresh session instead of trying proxy2.
      expect(mockConnect).toHaveBeenCalledTimes(2);
      // getMe was only tried once on proxy1
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      // Stale-session client is disconnected before the fresh-session auth flow.
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      // Active proxy index is 0 (first proxy)
      expect(client.getActiveProxyIndex()).toBe(0);
      // Auth flow was reached (invoke was called)
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("keeps first proxy and triggers auth flow when getMe fails with AUTH_KEY error (406)", async () => {
      const authKeyError = Object.assign(new Error("406: AUTH_KEY_UNREGISTERED"), {
        code: 406,
        errorMessage: "AUTH_KEY_UNREGISTERED",
      });
      mockGetMe.mockRejectedValueOnce(authKeyError);
      mockInvoke.mockRejectedValueOnce(new Error("test: auth flow reached via proxy"));

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
        ],
      });

      await expect(client.connect()).rejects.toThrow("test: auth flow reached via proxy");

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(client.getActiveProxyIndex()).toBe(0);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("rebuilds a fresh session on the same proxy before re-authentication after auth-key failure", async () => {
      mockReadFileSync.mockReturnValue("stale-session");
      const authKeyError = Object.assign(new Error("AUTH_KEY_UNREGISTERED"), {
        code: 406,
        errorMessage: "AUTH_KEY_UNREGISTERED",
      });
      mockGetMe.mockRejectedValueOnce(authKeyError);
      mockInvoke.mockRejectedValueOnce(
        new Error("test: auth flow reached via fresh proxy session")
      );

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
        ],
      });

      await expect(client.connect()).rejects.toThrow(
        "test: auth flow reached via fresh proxy session"
      );

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(client.getActiveProxyIndex()).toBe(0);
      expect(mockUnlinkSync).toHaveBeenCalledWith(BASE_CONFIG.sessionPath);
      expect(constructedSessions).toEqual(["stale-session", "stale-session", ""]);
      expect(constructedOptions[1].proxy).toEqual(constructedOptions[2].proxy);
    });

    // Regression test for xlabtg/teleton-agent#439:
    // when one proxy in the configured list is disabled (refuses connections),
    // the user client must automatically switch to the next entry in the list.
    it("switches to the next proxy when one entry in the list is disabled", async () => {
      mockConnect
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // proxy1 disabled
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // proxy2 disabled
        .mockResolvedValueOnce(undefined); //               proxy3 reachable

      const client = new TelegramUserClient({
        ...BASE_CONFIG,
        mtprotoProxies: [
          { server: "disabled1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "disabled2.example.com", port: 443, secret: "b".repeat(32) },
          { server: "reachable.example.com", port: 443, secret: "c".repeat(32) },
        ],
      });

      await client.connect();

      // All three proxies should have been tried in order
      expect(mockConnect).toHaveBeenCalledTimes(3);
      // Both disabled proxies' clients should have been disconnected on failure
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
      // The active proxy index points at the third (reachable) entry
      expect(client.getActiveProxyIndex()).toBe(2);
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
          { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
          { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
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
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
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
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
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
        mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
      });

      await expect(client.connect()).rejects.toThrow("network unreachable");

      // proxy (fails) + direct (fails) = 2 connection attempts
      expect(mockConnect).toHaveBeenCalledTimes(2);
      // Auth flow should NOT be triggered if even direct failed
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });
});

describe("TelegramUserClient — proxy timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMe.mockResolvedValue(MOCK_ME);
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out a hanging proxy and falls back to the next one", async () => {
    // First proxy hangs forever; second succeeds immediately
    mockConnect
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      )
      .mockResolvedValueOnce(undefined);

    vi.useFakeTimers();

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [
        { server: "hanging.example.com", port: 443, secret: "a".repeat(32) },
        { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
      ],
    });

    const connectPromise = client.connect();
    // Advance past the 100 ms mock timeout
    await vi.runAllTimersAsync();

    await connectPromise;

    // connect called twice: proxy1 (timeout → failed) + proxy2 (success)
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);
    // The timed-out proxy's client must be disconnected to stop background retries
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("times out all proxies and falls back to direct connection", async () => {
    // Both proxies hang; direct succeeds
    mockConnect
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

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [
        { server: "hanging1.example.com", port: 443, secret: "a".repeat(32) },
        { server: "hanging2.example.com", port: 443, secret: "b".repeat(32) },
      ],
    });

    const connectPromise = client.connect();
    await vi.runAllTimersAsync();

    await connectPromise;

    // proxy1 (timeout) + proxy2 (timeout) + direct (success) = 3 calls
    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(client.isConnected()).toBe(true);
    // Both timed-out proxy clients must be disconnected
    expect(mockDisconnect).toHaveBeenCalledTimes(2);
  });

  it("disconnects failed proxy client on connection error (not just timeout)", async () => {
    mockConnect
      .mockRejectedValueOnce(new Error("proxy1 connection refused"))
      .mockResolvedValueOnce(undefined);

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [
        { server: "bad.example.com", port: 443, secret: "a".repeat(32) },
        { server: "good.example.com", port: 443, secret: "b".repeat(32) },
      ],
    });

    await client.connect();

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);
    // The failed proxy's client must be disconnected to clean up resources
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

describe("TelegramUserClient — getActiveProxyIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMe.mockResolvedValue(MOCK_ME);
    mockExistsSync.mockReturnValue(true);
  });

  it("returns undefined before connecting", () => {
    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
    });
    expect(client.getActiveProxyIndex()).toBeUndefined();
  });

  it("returns 0 after connecting via first proxy", async () => {
    mockConnect.mockResolvedValue(undefined);

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [
        { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
        { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
      ],
    });

    await client.connect();

    expect(client.getActiveProxyIndex()).toBe(0);
  });

  it("returns 1 when first proxy fails and second succeeds", async () => {
    mockConnect
      .mockRejectedValueOnce(new Error("proxy1 unreachable"))
      .mockResolvedValueOnce(undefined);

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [
        { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
        { server: "proxy2.example.com", port: 443, secret: "b".repeat(32) },
      ],
    });

    await client.connect();

    expect(client.getActiveProxyIndex()).toBe(1);
  });

  it("returns undefined when all proxies fail and direct connection is used", async () => {
    mockConnect
      .mockRejectedValueOnce(new Error("proxy1 unreachable"))
      .mockResolvedValueOnce(undefined);

    const client = new TelegramUserClient({
      ...BASE_CONFIG,
      mtprotoProxies: [{ server: "proxy1.example.com", port: 443, secret: "a".repeat(32) }],
    });

    await client.connect();

    expect(client.getActiveProxyIndex()).toBeUndefined();
  });
});
