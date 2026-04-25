import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructedOptions: Array<Record<string, unknown>> = [];
const constructedSessions: string[] = [];
const { mockConnect, mockDisconnect, mockGetMe } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockGetMe: vi.fn(),
}));

vi.mock("telegram", () => {
  class TelegramClient {
    connect = mockConnect;
    disconnect = mockDisconnect;
    getMe = mockGetMe;

    constructor(
      _session: unknown,
      _apiId: number,
      _apiHash: string,
      options: Record<string, unknown>
    ) {
      constructedOptions.push(options);
    }
  }

  return { TelegramClient };
});

vi.mock("telegram/extensions/Logger.js", () => ({
  Logger: class {},
  LogLevel: { NONE: 0 },
}));

vi.mock("telegram/sessions/index.js", () => ({
  StringSession: class {
    constructor(value?: string) {
      constructedSessions.push(value ?? "");
    }
  },
}));

vi.mock("../../constants/timeouts.js", () => ({
  MTPROTO_PROXY_STATUS_TIMEOUT_MS: 100,
}));

import { checkMtprotoProxies, checkMtprotoProxy } from "../mtproto-proxy-health.js";

const PROXY = { server: "proxy.example.com", port: 443, secret: "a".repeat(32) };

describe("MTProto proxy health checks", () => {
  beforeEach(() => {
    constructedOptions.length = 0;
    constructedSessions.length = 0;
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockGetMe.mockResolvedValue({ id: 12345 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an available proxy with latency and safe proxy details", async () => {
    const status = await checkMtprotoProxy(12345, "hash", PROXY, 0, { activeProxyIndex: 0 });

    expect(status.status).toBe("available");
    expect(status.available).toBe(true);
    expect(status.active).toBe(true);
    expect(status.server).toBe(PROXY.server);
    expect(status.port).toBe(PROXY.port);
    expect(status.latencyMs).toEqual(expect.any(Number));
    expect(status.error).toBeNull();
    expect(constructedOptions[0].proxy).toEqual({
      ip: PROXY.server,
      port: PROXY.port,
      secret: PROXY.secret,
      MTProxy: true,
    });
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("reports an authenticated proxy as available when getMe succeeds through the saved session", async () => {
    const status = await checkMtprotoProxy(12345, "hash", PROXY, 0, {
      activeProxyIndex: 0,
      sessionString: "saved-session",
    });

    expect(status.status).toBe("available");
    expect(status.available).toBe(true);
    expect(constructedSessions[0]).toBe("saved-session");
    expect(mockGetMe).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("passes the saved session to every bulk proxy health check", async () => {
    const statuses = await checkMtprotoProxies({
      apiId: 12345,
      apiHash: "hash",
      proxies: [PROXY, { server: "proxy2.example.com", port: 8443, secret: "b".repeat(32) }],
      activeProxyIndex: 1,
      sessionString: "saved-session",
    });

    expect(statuses).toHaveLength(2);
    expect(statuses.every((status) => status.status === "available")).toBe(true);
    expect(constructedSessions).toEqual(["saved-session", "saved-session"]);
    expect(mockGetMe).toHaveBeenCalledTimes(2);
  });

  it("reports an unavailable proxy when connection succeeds but authenticated validation fails", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("getMe timed out"));

    const status = await checkMtprotoProxy(12345, "hash", PROXY, 0, {
      sessionString: "saved-session",
    });

    expect(status.status).toBe("unavailable");
    expect(status.available).toBe(false);
    expect(status.error).toContain("getMe timed out");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockGetMe).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable proxy when the MTProto connection fails", async () => {
    mockConnect.mockRejectedValueOnce(new Error("proxy refused connection"));

    const status = await checkMtprotoProxy(12345, "hash", PROXY, 1);

    expect(status.status).toBe("unavailable");
    expect(status.available).toBe(false);
    expect(status.active).toBe(false);
    expect(status.latencyMs).toBeNull();
    expect(status.error).toContain("proxy refused connection");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("times out a hanging proxy check and disconnects the client", async () => {
    mockConnect.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Intentionally never resolves.
        })
    );
    vi.useFakeTimers();

    const checkPromise = checkMtprotoProxy(12345, "hash", PROXY, 0, { timeoutMs: 100 });
    await vi.runAllTimersAsync();
    const status = await checkPromise;

    expect(status.status).toBe("unavailable");
    expect(status.available).toBe(false);
    expect(status.error).toContain("timed out");
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
