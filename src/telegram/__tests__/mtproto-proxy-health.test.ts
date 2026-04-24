import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructedOptions: Array<Record<string, unknown>> = [];
const { mockConnect, mockDisconnect } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("telegram", () => {
  class TelegramClient {
    connect = mockConnect;
    disconnect = mockDisconnect;

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
    constructor(_value?: string) {}
  },
}));

vi.mock("../../constants/timeouts.js", () => ({
  MTPROTO_PROXY_STATUS_TIMEOUT_MS: 100,
}));

import { checkMtprotoProxy } from "../mtproto-proxy-health.js";

const PROXY = { server: "proxy.example.com", port: 443, secret: "a".repeat(32) };

describe("MTProto proxy health checks", () => {
  beforeEach(() => {
    constructedOptions.length = 0;
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
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
