import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeightedLRUCache, getAdaptiveCacheSize } from "../weighted-lru-cache";

describe("WeightedLRUCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic get/set", () => {
    it("stores and retrieves values", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("returns undefined for missing keys", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      expect(cache.get("missing")).toBeUndefined();
    });

    it("overwrites existing keys in place", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      cache.set("a", 2);
      expect(cache.get("a")).toBe(2);
      expect(cache.size).toBe(1);
    });

    it("delete() removes the entry", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
    });

    it("clear() empties the cache", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe("TTL", () => {
    it("expires entries after ttlMs", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      vi.advanceTimersByTime(999);
      expect(cache.get("a")).toBe(1);
      vi.advanceTimersByTime(2);
      expect(cache.get("a")).toBeUndefined();
    });

    it("counts TTL-expired lookups as misses, not hits", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 500 });
      cache.set("a", 1);
      vi.advanceTimersByTime(600);
      cache.get("a");
      expect(cache.getMetrics().misses).toBe(1);
      expect(cache.getMetrics().expirations).toBe(1);
      expect(cache.getMetrics().hits).toBe(0);
    });

    it("pruneExpired removes all expired entries in one pass", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 100 });
      cache.set("a", 1);
      cache.set("b", 2);
      vi.advanceTimersByTime(200);
      cache.set("c", 3); // fresh entry after expiry
      const removed = cache.pruneExpired();
      expect(removed).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("peek() does not update recency or metrics", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      expect(cache.peek("a")).toBe(1);
      expect(cache.getMetrics().hits).toBe(0);
      expect(cache.getMetrics().misses).toBe(0);
    });
  });

  describe("pure LRU eviction (frequencyWeightMs=0)", () => {
    it("evicts the oldest untouched entry when over capacity", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 3, ttlMs: 10_000 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4); // evicts "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("touching an entry with get() moves it to the end of insertion order", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 3, ttlMs: 10_000 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Touch "a" — now "b" is oldest
      cache.get("a");
      cache.set("d", 4);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
    });
  });

  describe("weighted LRU eviction", () => {
    it("prefers keeping frequently-accessed entries over recently-inserted ones", () => {
      const cache = new WeightedLRUCache<string, number>({
        maxSize: 3,
        ttlMs: 10_000,
        frequencyWeightMs: 5 * 60 * 1000,
      });
      cache.set("hot", 1);
      // Touch "hot" 10 times to build up frequency
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(10);
        cache.get("hot");
      }
      cache.set("b", 2);
      cache.set("c", 3);
      // At this moment all three are present. Inserting "d" triggers eviction.
      // "hot" has high access count, "b" and "c" have zero — one of them should be evicted.
      cache.set("d", 4);
      expect(cache.peek("hot")).toBe(1);
      expect(cache.size).toBe(3);
      // The entry with the lowest score (oldest + zero accesses) should be gone.
      const bGone = cache.peek("b") === undefined;
      const cGone = cache.peek("c") === undefined;
      expect(bGone || cGone).toBe(true);
    });

    it("still respects maxSize (one-in, one-out)", () => {
      const cache = new WeightedLRUCache<string, number>({
        maxSize: 2,
        ttlMs: 10_000,
        frequencyWeightMs: 60_000,
      });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.size).toBe(2);
      expect(cache.getMetrics().evictions).toBe(1);
    });
  });

  describe("metrics", () => {
    it("tracks hits, misses, evictions, hitRatio", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 2, ttlMs: 10_000 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("c"); // miss
      cache.set("d", 4); // evicts "b" (pure LRU)
      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(1);
      expect(metrics.evictions).toBe(1);
      expect(metrics.hitRatio).toBeCloseTo(2 / 3, 5);
      expect(metrics.size).toBe(2);
    });

    it("hitRatio is 0 when no lookups have happened", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      expect(cache.getMetrics().hitRatio).toBe(0);
    });

    it("resetMetrics() zeros counters but keeps entries", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 10, ttlMs: 1000 });
      cache.set("a", 1);
      cache.get("a");
      cache.resetMetrics();
      expect(cache.getMetrics().hits).toBe(0);
      expect(cache.get("a")).toBe(1);
    });
  });

  describe("adaptive sizing", () => {
    it("honors maxSize when no adaptive config is given", () => {
      const cache = new WeightedLRUCache<string, number>({ maxSize: 5, ttlMs: 1000 });
      expect(cache.maxSize).toBe(5);
    });

    it("initializes maxSize from adaptive tiers", () => {
      const cache = new WeightedLRUCache<string, number>({
        adaptiveSize: { low: 10, normal: 20, high: 40 },
        ttlMs: 1000,
      });
      expect([10, 20, 40]).toContain(cache.maxSize);
    });

    it("throws if neither maxSize nor adaptiveSize is provided", () => {
      expect(() => new WeightedLRUCache<string, number>({ ttlMs: 1000 } as never)).toThrow(
        /maxSize or adaptiveSize/
      );
    });
  });

  describe("getAdaptiveCacheSize", () => {
    it("returns a value from the configured tiers", () => {
      const size = getAdaptiveCacheSize(100, 200, 400);
      expect([100, 200, 400]).toContain(size);
    });
  });
});
