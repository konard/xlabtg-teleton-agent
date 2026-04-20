import { describe, it, expect } from "vitest";
import { MessageDedupCache } from "../message-dedup-cache.js";

describe("MessageDedupCache", () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      advance(ms: number) {
        t += ms;
      },
      set(ms: number) {
        t = ms;
      },
    };
  }

  it("reports unseen ids as not present", () => {
    const cache = new MessageDedupCache();
    expect(cache.has("a")).toBe(false);
  });

  it("reports added ids as present within TTL", () => {
    const c = clock();
    const cache = new MessageDedupCache(100, 1_000, c.now);
    cache.add("a");
    expect(cache.has("a")).toBe(true);
  });

  it("expires entries after TTL elapses", () => {
    const c = clock();
    const cache = new MessageDedupCache(100, 1_000, c.now);
    cache.add("a");
    c.advance(1_000);
    expect(cache.has("a")).toBe(false);
  });

  it("keeps entries just before TTL boundary", () => {
    const c = clock();
    const cache = new MessageDedupCache(100, 1_000, c.now);
    cache.add("a");
    c.advance(999);
    expect(cache.has("a")).toBe(true);
  });

  it("evicts oldest entry when size exceeds max", () => {
    const c = clock();
    const cache = new MessageDedupCache(3, 10_000, c.now);
    cache.add("a");
    c.advance(1);
    cache.add("b");
    c.advance(1);
    cache.add("c");
    c.advance(1);
    cache.add("d");

    expect(cache.size).toBe(3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });

  it("readds an id as most-recent so it survives eviction", () => {
    const c = clock();
    const cache = new MessageDedupCache(3, 10_000, c.now);
    cache.add("a");
    c.advance(1);
    cache.add("b");
    c.advance(1);
    cache.add("c");
    c.advance(1);
    cache.add("a"); // promote a to newest
    c.advance(1);
    cache.add("d"); // should evict b (now oldest)

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });

  it("opportunistically evicts expired entries on add", () => {
    const c = clock();
    const cache = new MessageDedupCache(100, 1_000, c.now);
    cache.add("old-1");
    cache.add("old-2");
    c.advance(2_000);
    cache.add("fresh");

    expect(cache.size).toBe(1);
    expect(cache.has("fresh")).toBe(true);
  });

  it("bounds memory well below unbounded growth across many adds", () => {
    const c = clock();
    const cache = new MessageDedupCache(500, 60 * 60 * 1000, c.now);
    for (let i = 0; i < 10_000; i++) {
      cache.add(`id-${i}`);
      c.advance(1);
    }
    expect(cache.size).toBeLessThanOrEqual(500);
  });

  it("does not retain entries older than TTL even under heavy churn", () => {
    const c = clock();
    const cache = new MessageDedupCache(10_000, 1_000, c.now);
    for (let i = 0; i < 100; i++) {
      cache.add(`id-${i}`);
      c.advance(100);
    }
    // Entries added >= 1000 ms ago are expired.
    expect(cache.has("id-0")).toBe(false);
    expect(cache.has("id-99")).toBe(true);
  });

  it("getStats returns zero-size when empty", () => {
    const cache = new MessageDedupCache();
    expect(cache.getStats()).toEqual({ size: 0 });
  });

  it("getStats reports size and timestamp range", () => {
    const c = clock();
    const cache = new MessageDedupCache(100, 10_000, c.now);
    c.set(1000);
    cache.add("a");
    c.set(1500);
    cache.add("b");
    c.set(2000);
    cache.add("c");

    const stats = cache.getStats();
    expect(stats.size).toBe(3);
    expect(stats.oldestTimestamp).toBe(1000);
    expect(stats.newestTimestamp).toBe(2000);
  });
});
