import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { getCache, initCache, resetCacheForTests } from "../../../services/cache.js";
import { ensureSchema } from "../../schema.js";
import { CachedEmbeddingProvider } from "../cached.js";
import type { EmbeddingProvider } from "../provider.js";
import { deserializeEmbedding, hashText, serializeEmbedding } from "../utils.js";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("CachedEmbeddingProvider", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
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
    db.close();
    resetCacheForTests();
  });

  it("does not cache empty embedQuery results from a transient provider failure", async () => {
    const text = "transient provider failure";
    const recoveredEmbedding = [0.25, 0.5, 0.75];
    const embedQuery = vi
      .fn<(value: string) => Promise<number[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(recoveredEmbedding);
    const inner: EmbeddingProvider = {
      id: "test-provider",
      model: "test-model",
      dimensions: recoveredEmbedding.length,
      embedQuery,
      embedBatch: vi.fn(async (texts: string[]) => texts.map(() => recoveredEmbedding)),
    };
    const provider = new CachedEmbeddingProvider(inner, db);

    await expect(provider.embedQuery(text)).resolves.toEqual([]);

    const count = db.prepare("SELECT COUNT(*) as count FROM embedding_cache").get() as {
      count: number;
    };
    expect(count.count).toBe(0);

    const resourceCache = getCache();
    expect(resourceCache).not.toBeNull();
    const key = resourceCache!.makeKey("embeddings", hashText(text), {
      provider: inner.id,
      model: inner.model,
    });
    expect(resourceCache!.peekByKey(key)).toBeUndefined();

    await expect(provider.embedQuery(text)).resolves.toEqual(recoveredEmbedding);
    expect(embedQuery).toHaveBeenCalledTimes(2);

    const persisted = db.prepare("SELECT COUNT(*) as count FROM embedding_cache").get() as {
      count: number;
    };
    expect(persisted.count).toBe(1);
  });

  it("treats existing empty embedQuery cache entries as misses", async () => {
    const text = "previously poisoned embedding";
    const recoveredEmbedding = [0.1, 0.2, 0.3];
    const inner: EmbeddingProvider = {
      id: "test-provider",
      model: "test-model",
      dimensions: recoveredEmbedding.length,
      embedQuery: vi.fn().mockResolvedValue(recoveredEmbedding),
      embedBatch: vi.fn(async (texts: string[]) => texts.map(() => recoveredEmbedding)),
    };
    const hash = hashText(text);
    const cacheConfig = { provider: inner.id, model: inner.model };

    db.prepare(
      `INSERT INTO embedding_cache (hash, model, provider, embedding, dims)
       VALUES (?, ?, ?, ?, ?)`
    ).run(hash, inner.model, inner.id, serializeEmbedding([]), inner.dimensions);

    const resourceCache = getCache();
    expect(resourceCache).not.toBeNull();
    const key = resourceCache!.set("embeddings", hash, cacheConfig, []);

    const provider = new CachedEmbeddingProvider(inner, db);

    await expect(provider.embedQuery(text)).resolves.toEqual(recoveredEmbedding);
    expect(inner.embedQuery).toHaveBeenCalledTimes(1);
    expect(resourceCache!.peekByKey(key)).toEqual(recoveredEmbedding);

    const row = db.prepare("SELECT embedding FROM embedding_cache WHERE hash = ?").get(hash) as {
      embedding: Buffer;
    };
    const storedEmbedding = deserializeEmbedding(row.embedding);
    expect(storedEmbedding).toHaveLength(recoveredEmbedding.length);
    storedEmbedding.forEach((value, index) => {
      expect(value).toBeCloseTo(recoveredEmbedding[index]);
    });
  });
});
