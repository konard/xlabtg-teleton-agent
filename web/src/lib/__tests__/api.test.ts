import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, setup, SETUP_AGENT_LAUNCH_TIMEOUT_MS } from "../api";

describe("web API client CSRF handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
  });

  it("sends the CSRF cookie value when stopping the agent", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { cookie: "teleton_csrf=csrf-token-123; theme=dark" },
    });

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ state: "stopping" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.agentStop()).resolves.toEqual({ state: "stopping" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/stop",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token-123",
        }),
      })
    );
  });
});

describe("setup API client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes setup status requests through /api/setup", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { configExists: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(setup.getStatus()).resolves.toEqual({ configExists: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("sends the setup launch nonce header", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { token: "agent-token" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(setup.launch("nonce-123")).resolves.toEqual({ token: "agent-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup/launch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Setup-Nonce": "nonce-123",
        }),
      })
    );
  });

  it("keeps polling long enough for a slow first WebUI handoff", async () => {
    vi.useFakeTimers();

    let healthChecks = 0;
    const fetchMock = vi.fn(async () => {
      healthChecks += 1;
      const ready = healthChecks >= 31;
      return new Response(
        JSON.stringify({
          success: true,
          data: ready ? { authenticated: false } : { setup: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const poll = setup.pollHealth();
    await vi.advanceTimersByTimeAsync(35_000);

    await expect(poll).resolves.toBeUndefined();
    expect(SETUP_AGENT_LAUNCH_TIMEOUT_MS).toBeGreaterThan(30_000);
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/check",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(healthChecks).toBeGreaterThanOrEqual(31);
  });
});

describe("SSE helpers error callbacks", () => {
  let fakeEventSource: {
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onerror: ((e: Event) => void) | null;
    emitError: () => void;
  };

  beforeEach(() => {
    fakeEventSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      onerror: null,
      emitError() {
        this.onerror?.(new Event("error"));
      },
    };
    // Use a regular function so `new EventSourceMock()` works as a constructor
    const EventSourceMock = vi.fn(function () {
      return fakeEventSource;
    });
    vi.stubGlobal("EventSource", EventSourceMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes the onError callback when the connectNotifications SSE connection fails", () => {
    const onError = vi.fn();
    const stop = api.connectNotifications(() => {}, onError);
    fakeEventSource.emitError();
    expect(onError).toHaveBeenCalledOnce();
    stop();
    expect(fakeEventSource.close).toHaveBeenCalledOnce();
  });

  it("does not throw when connectNotifications has no onError callback", () => {
    const stop = api.connectNotifications(() => {});
    expect(() => fakeEventSource.emitError()).not.toThrow();
    stop();
  });

  it("invokes the onError callback when the connectEvents SSE connection fails", () => {
    const onError = vi.fn();
    const stop = api.connectEvents(() => {}, onError);
    fakeEventSource.emitError();
    expect(onError).toHaveBeenCalledOnce();
    stop();
    expect(fakeEventSource.close).toHaveBeenCalledOnce();
  });

  it("does not throw when connectEvents has no onError callback", () => {
    const stop = api.connectEvents(() => {});
    expect(() => fakeEventSource.emitError()).not.toThrow();
    stop();
  });

  it("invokes the onError callback when the connectLogs SSE connection fails", () => {
    const onError = vi.fn();
    const stop = api.connectLogs(() => {}, onError);
    fakeEventSource.emitError();
    expect(onError).toHaveBeenCalledOnce();
    stop();
    expect(fakeEventSource.close).toHaveBeenCalledOnce();
  });
});
