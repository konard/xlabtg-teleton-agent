import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, resetCacheForTests } from "../../services/cache.js";
import { fetchWithTimeout } from "../fetch.js";

describe("fetchWithTimeout API response cache", () => {
  beforeEach(() => {
    initCache({
      enabled: true,
      max_entries: 10,
      ttl: {
        tools_ms: 300_000,
        prompts_ms: 60_000,
        embeddings_ms: 1_800_000,
        api_responses_ms: 300_000,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCacheForTests();
  });

  it("caches successful GET responses when cacheTtlMs is set", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchWithTimeout("https://example.test/data", { cacheTtlMs: 60_000 });
    const second = await fetchWithTimeout("https://example.test/data", { cacheTtlMs: 60_000 });

    await expect(first.json()).resolves.toEqual({ ok: true });
    await expect(second.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
