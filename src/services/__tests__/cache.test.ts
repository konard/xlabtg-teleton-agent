import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceCacheService } from "../cache.js";

describe("ResourceCacheService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches resources by stable resource id and config hash", async () => {
    const cache = new ResourceCacheService({
      enabled: true,
      max_entries: 10,
      ttl: {
        tools_ms: 300_000,
        prompts_ms: 60_000,
        embeddings_ms: 1_800_000,
        api_responses_ms: 300_000,
      },
    });
    const load = vi.fn(async () => ({ value: "tools" }));

    await expect(cache.getOrSet("tools", "registry", { scope: "dm" }, load)).resolves.toEqual({
      value: "tools",
    });
    await expect(cache.getOrSet("tools", "registry", { scope: "dm" }, load)).resolves.toEqual({
      value: "tools",
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.getStats()).toMatchObject({
      hits: 1,
      misses: 1,
      size: 1,
    });
  });

  it("expires entries using the configured resource type ttl", async () => {
    const cache = new ResourceCacheService({
      enabled: true,
      max_entries: 10,
      ttl: {
        tools_ms: 300_000,
        prompts_ms: 1_000,
        embeddings_ms: 1_800_000,
        api_responses_ms: 300_000,
      },
    });
    const load = vi.fn(async () => "prompt");

    await cache.getOrSet("prompts", "SOUL.md", {}, load);
    vi.advanceTimersByTime(1_001);
    await cache.getOrSet("prompts", "SOUL.md", {}, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.getStats().expirations).toBe(1);
  });

  it("invalidates entries by type and by exact generated key", async () => {
    const cache = new ResourceCacheService({
      enabled: true,
      max_entries: 10,
      ttl: {
        tools_ms: 300_000,
        prompts_ms: 60_000,
        embeddings_ms: 1_800_000,
        api_responses_ms: 300_000,
      },
    });

    const toolsKey = cache.makeKey("tools", "registry", { scope: "dm" });
    const promptKey = cache.makeKey("prompts", "SOUL.md", {});
    cache.set("tools", "registry", { scope: "dm" }, ["tool"]);
    cache.set("prompts", "SOUL.md", {}, "prompt");

    expect(cache.invalidate({ key: toolsKey })).toBe(1);
    expect(cache.peekByKey(toolsKey)).toBeUndefined();
    expect(cache.peekByKey(promptKey)).toBe("prompt");

    expect(cache.invalidate({ type: "prompts" })).toBe(1);
    expect(cache.getStats().size).toBe(0);
  });
});
