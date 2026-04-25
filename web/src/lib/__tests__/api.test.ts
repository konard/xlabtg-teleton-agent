import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";

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
