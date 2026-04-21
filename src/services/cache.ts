import { createHash } from "node:crypto";

export type CacheResourceType = "tools" | "prompts" | "embeddings" | "api_responses";

export interface CacheTtlConfig {
  tools_ms: number;
  prompts_ms: number;
  embeddings_ms: number;
  api_responses_ms: number;
}

export interface ResourceCacheConfig {
  enabled: boolean;
  max_entries: number;
  ttl: CacheTtlConfig;
}

export interface CacheEntryInfo {
  key: string;
  type: CacheResourceType;
  resourceId: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hits: number;
  sizeBytes: number;
  estimatedLatencyMs: number;
}

export interface CacheTypeStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  memoryBytes: number;
}

export interface ResourceCacheStats {
  enabled: boolean;
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  hitRate: number;
  memoryBytes: number;
  latencySavedMs: number;
  byType: Record<CacheResourceType, CacheTypeStats>;
  entries: CacheEntryInfo[];
}

interface CacheEntry<T> {
  key: string;
  type: CacheResourceType;
  resourceId: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hits: number;
  sizeBytes: number;
  estimatedLatencyMs: number;
}

const DEFAULT_CACHE_CONFIG: ResourceCacheConfig = {
  enabled: true,
  max_entries: 512,
  ttl: {
    tools_ms: 5 * 60 * 1000,
    prompts_ms: 60 * 1000,
    embeddings_ms: 30 * 60 * 1000,
    api_responses_ms: 5 * 60 * 1000,
  },
};

const RESOURCE_TYPES: CacheResourceType[] = ["tools", "prompts", "embeddings", "api_responses"];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function estimateSizeBytes(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value);
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function emptyTypeStats(): CacheTypeStats {
  return {
    size: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    memoryBytes: 0,
  };
}

export class ResourceCacheService {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private config: ResourceCacheConfig;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;
  private latencySavedMs = 0;
  private typeStats: Record<CacheResourceType, CacheTypeStats>;

  constructor(config: Partial<ResourceCacheConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? DEFAULT_CACHE_CONFIG.enabled,
      max_entries: config.max_entries ?? DEFAULT_CACHE_CONFIG.max_entries,
      ttl: {
        ...DEFAULT_CACHE_CONFIG.ttl,
        ...(config.ttl ?? {}),
      },
    };
    this.typeStats = this.createEmptyTypeStats();
  }

  configure(config: Partial<ResourceCacheConfig>): void {
    this.config = {
      enabled: config.enabled ?? this.config.enabled,
      max_entries: config.max_entries ?? this.config.max_entries,
      ttl: {
        ...this.config.ttl,
        ...(config.ttl ?? {}),
      },
    };
    this.evictIfNeeded();
  }

  makeKey(
    type: CacheResourceType,
    resourceId: string,
    relevantConfig: unknown = {},
    version?: string | number
  ): string {
    return `${type}:${hash(stableStringify({ resourceId, relevantConfig, version }))}`;
  }

  async getOrSet<T>(
    type: CacheResourceType,
    resourceId: string,
    relevantConfig: unknown,
    loader: () => Promise<T> | T,
    opts: { ttlMs?: number; version?: string | number } = {}
  ): Promise<T> {
    if (!this.config.enabled) return loader();

    const key = this.makeKey(type, resourceId, relevantConfig, opts.version);
    const existing = this.getByKey<T>(key, true);
    if (existing !== undefined) return existing;

    const pending = this.inFlight.get(key);
    if (pending) return (await pending) as T;

    const startedAt = Date.now();
    const promise = Promise.resolve(loader()).then((value) => {
      const duration = Date.now() - startedAt;
      this.setByKey(key, type, resourceId, value, {
        ttlMs: opts.ttlMs,
        estimatedLatencyMs: duration,
      });
      return value;
    });

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  getOrSetSync<T>(
    type: CacheResourceType,
    resourceId: string,
    relevantConfig: unknown,
    loader: () => T,
    opts: { ttlMs?: number; version?: string | number } = {}
  ): T {
    if (!this.config.enabled) return loader();

    const key = this.makeKey(type, resourceId, relevantConfig, opts.version);
    const existing = this.getByKey<T>(key, true);
    if (existing !== undefined) return existing;

    const startedAt = Date.now();
    const value = loader();
    this.setByKey(key, type, resourceId, value, {
      ttlMs: opts.ttlMs,
      estimatedLatencyMs: Date.now() - startedAt,
    });
    return value;
  }

  set<T>(
    type: CacheResourceType,
    resourceId: string,
    relevantConfig: unknown,
    value: T,
    opts: { ttlMs?: number; version?: string | number; estimatedLatencyMs?: number } = {}
  ): string {
    const key = this.makeKey(type, resourceId, relevantConfig, opts.version);
    this.setByKey(key, type, resourceId, value, opts);
    return key;
  }

  peekByKey<T>(key: string): T | undefined {
    return this.getByKey<T>(key, false);
  }

  getCachedByKey<T>(key: string): T | undefined {
    return this.getByKey<T>(key, true);
  }

  invalidate(opts: { key?: string; type?: CacheResourceType } = {}): number {
    if (!opts.key && !opts.type) return this.clear();

    let removed = 0;
    if (opts.key) {
      const entry = this.entries.get(opts.key);
      if (entry) {
        this.entries.delete(opts.key);
        this.typeStats[entry.type].size--;
        this.typeStats[entry.type].memoryBytes -= entry.sizeBytes;
        removed++;
      }
    }

    if (opts.type) {
      for (const [key, entry] of this.entries) {
        if (entry.type === opts.type) {
          this.entries.delete(key);
          this.typeStats[entry.type].size--;
          this.typeStats[entry.type].memoryBytes -= entry.sizeBytes;
          removed++;
        }
      }
    }

    return removed;
  }

  clear(): number {
    const removed = this.entries.size;
    this.entries.clear();
    this.inFlight.clear();
    for (const type of RESOURCE_TYPES) {
      this.typeStats[type].size = 0;
      this.typeStats[type].memoryBytes = 0;
    }
    return removed;
  }

  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
    this.latencySavedMs = 0;
    for (const type of RESOURCE_TYPES) {
      this.typeStats[type].hits = 0;
      this.typeStats[type].misses = 0;
      this.typeStats[type].evictions = 0;
      this.typeStats[type].expirations = 0;
    }
  }

  getStats(): ResourceCacheStats {
    this.pruneExpired();
    const total = this.hits + this.misses;
    const byType = this.createEmptyTypeStats();
    for (const type of RESOURCE_TYPES) {
      byType[type] = { ...this.typeStats[type] };
    }
    const entries = Array.from(this.entries.values())
      .map((entry) => ({
        key: entry.key,
        type: entry.type,
        resourceId: entry.resourceId,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        lastAccessedAt: entry.lastAccessedAt,
        hits: entry.hits,
        sizeBytes: entry.sizeBytes,
        estimatedLatencyMs: entry.estimatedLatencyMs,
      }))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

    return {
      enabled: this.config.enabled,
      size: this.entries.size,
      maxEntries: this.config.max_entries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: total === 0 ? 0 : this.hits / total,
      memoryBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      latencySavedMs: this.latencySavedMs,
      byType,
      entries,
    };
  }

  private getByKey<T>(key: string, countMetrics: boolean): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      if (countMetrics) this.recordMiss(key);
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.recordExpiration(entry);
      if (countMetrics) this.recordMiss(key);
      return undefined;
    }

    if (countMetrics) {
      this.hits++;
      this.typeStats[entry.type].hits++;
      entry.hits++;
      this.latencySavedMs += entry.estimatedLatencyMs;
    }
    entry.lastAccessedAt = Date.now();
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  private setByKey<T>(
    key: string,
    type: CacheResourceType,
    resourceId: string,
    value: T,
    opts: { ttlMs?: number; estimatedLatencyMs?: number } = {}
  ): void {
    if (!this.config.enabled) return;

    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      this.typeStats[existing.type].size--;
      this.typeStats[existing.type].memoryBytes -= existing.sizeBytes;
    }

    const sizeBytes = estimateSizeBytes(value);
    const entry: CacheEntry<T> = {
      key,
      type,
      resourceId,
      value,
      createdAt: existing?.createdAt ?? now,
      expiresAt: now + (opts.ttlMs ?? this.ttlFor(type)),
      lastAccessedAt: now,
      hits: existing?.hits ?? 0,
      sizeBytes,
      estimatedLatencyMs: opts.estimatedLatencyMs ?? existing?.estimatedLatencyMs ?? 0,
    };

    this.entries.delete(key);
    this.entries.set(key, entry);
    this.typeStats[type].size++;
    this.typeStats[type].memoryBytes += sizeBytes;
    this.evictIfNeeded();
  }

  private recordMiss(key: string): void {
    this.misses++;
    const type = key.split(":", 1)[0] as CacheResourceType;
    if (RESOURCE_TYPES.includes(type)) {
      this.typeStats[type].misses++;
    }
  }

  private recordExpiration(entry: CacheEntry<unknown>): void {
    this.expirations++;
    this.typeStats[entry.type].expirations++;
    this.typeStats[entry.type].size--;
    this.typeStats[entry.type].memoryBytes -= entry.sizeBytes;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.config.max_entries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.evictions++;
        this.typeStats[oldest.type].evictions++;
        this.typeStats[oldest.type].size--;
        this.typeStats[oldest.type].memoryBytes -= oldest.sizeBytes;
      }
    }
  }

  private pruneExpired(): void {
    for (const [key, entry] of this.entries) {
      if (Date.now() > entry.expiresAt) {
        this.entries.delete(key);
        this.recordExpiration(entry);
      }
    }
  }

  private ttlFor(type: CacheResourceType): number {
    switch (type) {
      case "tools":
        return this.config.ttl.tools_ms;
      case "prompts":
        return this.config.ttl.prompts_ms;
      case "embeddings":
        return this.config.ttl.embeddings_ms;
      case "api_responses":
        return this.config.ttl.api_responses_ms;
    }
  }

  private createEmptyTypeStats(): Record<CacheResourceType, CacheTypeStats> {
    return {
      tools: emptyTypeStats(),
      prompts: emptyTypeStats(),
      embeddings: emptyTypeStats(),
      api_responses: emptyTypeStats(),
    };
  }
}

let instance: ResourceCacheService | null = null;

export function initCache(config: Partial<ResourceCacheConfig> = {}): ResourceCacheService {
  instance = new ResourceCacheService(config);
  return instance;
}

export function getCache(): ResourceCacheService | null {
  return instance;
}

export function resetCacheForTests(): void {
  instance = null;
}

export { DEFAULT_CACHE_CONFIG };
