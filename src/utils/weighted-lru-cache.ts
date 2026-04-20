import os from "node:os";

/**
 * Snapshot of cache behavior for monitoring.
 * Hit ratio = hits / (hits + misses); 1 means every lookup was served from cache.
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  maxSize: number;
  hitRatio: number;
}

/**
 * Returns an adaptive cache size based on current host memory pressure.
 * Used as the default sizer when callers don't pass a fixed maxSize.
 */
export function getAdaptiveCacheSize(low: number, normal: number, high: number): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) return normal;
  const usedRatio = (total - free) / total;
  if (usedRatio > 0.8) return low;
  if (usedRatio > 0.6) return normal;
  return high;
}

interface WeightedEntry<V> {
  value: V;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface WeightedLRUCacheOptions {
  /** Fixed upper bound on entries. If omitted, `adaptiveSize` is used. */
  maxSize?: number;
  /** Adaptive sizing tier (low/normal/high). Evaluated on construction and on every set(). */
  adaptiveSize?: { low: number; normal: number; high: number };
  /** Default TTL (ms) applied to set() when no per-call TTL is given. */
  ttlMs: number;
  /**
   * How strongly access frequency biases eviction. 0 = pure LRU, higher = stickier hot entries.
   * Eviction score = lastAccessed + frequencyWeightMs * log2(accessCount + 1).
   */
  frequencyWeightMs?: number;
}

/**
 * TTL-bounded cache with a weighted LRU eviction policy.
 *
 * Eviction considers both recency and access frequency: `lastAccessed + weight * log2(accessCount + 1)`.
 * Pure LRU (frequencyWeightMs=0) keeps the original `delete+set` reinsertion semantics.
 * When `adaptiveSize` is configured, the size ceiling is recomputed on every `set()` so the cache
 * shrinks/grows with host memory pressure without needing an external trigger.
 */
export class WeightedLRUCache<K, V> {
  private readonly store: Map<K, WeightedEntry<V>> = new Map();
  private readonly ttlMs: number;
  private readonly adaptiveSize?: { low: number; normal: number; high: number };
  private readonly frequencyWeightMs: number;
  private currentMaxSize: number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;

  constructor(options: WeightedLRUCacheOptions) {
    if (options.maxSize === undefined && options.adaptiveSize === undefined) {
      throw new Error("WeightedLRUCache requires either maxSize or adaptiveSize");
    }
    this.ttlMs = options.ttlMs;
    this.adaptiveSize = options.adaptiveSize;
    this.frequencyWeightMs = options.frequencyWeightMs ?? 0;
    this.currentMaxSize = options.maxSize ?? this.computeAdaptiveSize();
  }

  /** Resolve current adaptive max size (or the fixed one if adaptiveSize is unset). */
  private computeAdaptiveSize(): number {
    if (this.adaptiveSize) {
      return getAdaptiveCacheSize(
        this.adaptiveSize.low,
        this.adaptiveSize.normal,
        this.adaptiveSize.high
      );
    }
    return this.currentMaxSize;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.expirations++;
      this.misses++;
      return undefined;
    }
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    // Refresh insertion order for pure-LRU fallback when frequencyWeightMs=0
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /** Peek without updating recency/frequency or hit/miss counters. */
  peek(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) return undefined;
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.adaptiveSize) {
      this.currentMaxSize = this.computeAdaptiveSize();
    }
    const existing = this.store.get(key);
    const now = Date.now();
    const entry: WeightedEntry<V> = {
      value,
      expiresAt: now + (ttlMs ?? this.ttlMs),
      accessCount: existing ? existing.accessCount : 0,
      lastAccessed: now,
    };
    this.store.delete(key);
    this.store.set(key, entry);
    this.evictIfNeeded();
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  get maxSize(): number {
    return this.currentMaxSize;
  }

  /**
   * Sweep expired entries in one pass. Long-running sessions call this periodically
   * to prevent hot keys from keeping stale neighbors alive past their TTL.
   */
  pruneExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.expirations++;
        removed++;
      }
    }
    return removed;
  }

  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      size: this.store.size,
      maxSize: this.currentMaxSize,
      hitRatio: total === 0 ? 0 : this.hits / total,
    };
  }

  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  private evictIfNeeded(): void {
    if (this.store.size <= this.currentMaxSize) return;

    // Pure-LRU fast path: oldest insertion = lowest eviction score.
    if (this.frequencyWeightMs === 0) {
      while (this.store.size > this.currentMaxSize) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
        this.evictions++;
      }
      return;
    }

    while (this.store.size > this.currentMaxSize) {
      let victimKey: K | undefined;
      let victimScore = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.store) {
        const score =
          entry.lastAccessed + this.frequencyWeightMs * Math.log2(entry.accessCount + 1);
        if (score < victimScore) {
          victimScore = score;
          victimKey = key;
        }
      }
      if (victimKey === undefined) break;
      this.store.delete(victimKey);
      this.evictions++;
    }
  }
}
