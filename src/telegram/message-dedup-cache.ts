import { MESSAGE_DEDUP_MAX_SIZE, MESSAGE_DEDUP_TTL_MS } from "../constants/limits.js";

export interface DedupStats {
  size: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
}

/**
 * LRU + TTL cache for short-lived message deduplication.
 *
 * Relies on the insertion-order guarantee of ES2015 Map: inserting a new key
 * (or re-inserting an existing one) places it at the tail, so the first key
 * returned by `keys()` is always the oldest. Reads perform lazy TTL expiry;
 * writes enforce the size cap and amortized stale-entry cleanup.
 */
export class MessageDedupCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly maxSize: number = MESSAGE_DEDUP_MAX_SIZE,
    private readonly ttlMs: number = MESSAGE_DEDUP_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Returns true if `id` was seen within the TTL window. Expired entries are
   * dropped on read so stale hits never resurrect them.
   */
  has(id: string): boolean {
    const timestamp = this.entries.get(id);
    if (timestamp === undefined) return false;

    if (this.now() - timestamp >= this.ttlMs) {
      this.entries.delete(id);
      return false;
    }
    return true;
  }

  /**
   * Record `id` as seen. Evicts the oldest entry if the size cap is exceeded
   * and opportunistically trims TTL-expired entries from the head.
   */
  add(id: string): void {
    const now = this.now();
    // Re-insert to move to tail (LRU recency update).
    this.entries.delete(id);
    this.entries.set(id, now);

    this.evictExpired(now);

    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Stats useful for memory monitoring in long-running processes.
   */
  getStats(): DedupStats {
    if (this.entries.size === 0) return { size: 0 };

    let oldest = Infinity;
    let newest = -Infinity;
    for (const ts of this.entries.values()) {
      if (ts < oldest) oldest = ts;
      if (ts > newest) newest = ts;
    }
    return { size: this.entries.size, oldestTimestamp: oldest, newestTimestamp: newest };
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [id, ts] of this.entries) {
      if (ts >= cutoff) break; // Map preserves insertion order → rest are newer.
      this.entries.delete(id);
    }
  }
}
