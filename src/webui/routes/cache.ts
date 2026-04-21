import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import {
  DEFAULT_CACHE_CONFIG,
  getCache,
  type CacheResourceType,
  type ResourceCacheStats,
} from "../../services/cache.js";
import { getPreloader, initPreloader, type CacheWarmRequest } from "../../services/preloader.js";
import { getAnalytics } from "../../services/analytics.js";
import { clearPromptCache } from "../../soul/loader.js";

const VALID_CACHE_TYPES: CacheResourceType[] = ["tools", "prompts", "embeddings", "api_responses"];

function disabledStats(): ResourceCacheStats {
  const empty = {
    size: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    memoryBytes: 0,
  };
  return {
    enabled: false,
    size: 0,
    maxEntries: DEFAULT_CACHE_CONFIG.max_entries,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    hitRate: 0,
    memoryBytes: 0,
    latencySavedMs: 0,
    byType: {
      tools: { ...empty },
      prompts: { ...empty },
      embeddings: { ...empty },
      api_responses: { ...empty },
    },
    entries: [],
  };
}

function parseCacheType(value: string | undefined): CacheResourceType | undefined {
  if (!value) return undefined;
  if (VALID_CACHE_TYPES.includes(value as CacheResourceType)) {
    return value as CacheResourceType;
  }
  throw new Error(`Invalid cache type: ${value}`);
}

function recordStatsSnapshot(stats: ResourceCacheStats): void {
  getAnalytics()?.recordCacheSnapshot(stats);
}

function clearLegacyCaches(deps: WebUIServerDeps): string[] {
  const cleared: string[] = [];

  if (
    deps.agent &&
    typeof (deps.agent as unknown as Record<string, unknown>).clearCache === "function"
  ) {
    (deps.agent as unknown as Record<string, () => void>).clearCache();
    cleared.push("agent");
  }

  if (
    deps.memory?.embedder &&
    typeof (deps.memory.embedder as unknown as Record<string, unknown>).clearCache === "function"
  ) {
    (deps.memory.embedder as unknown as Record<string, () => void>).clearCache();
    cleared.push("embedder");
  }

  if (
    deps.toolRegistry &&
    typeof (deps.toolRegistry as unknown as Record<string, unknown>).clearCache === "function"
  ) {
    (deps.toolRegistry as unknown as Record<string, () => void>).clearCache();
    cleared.push("toolRegistry");
  }

  clearPromptCache();
  cleared.push("prompts");

  const removed = getCache()?.clear() ?? 0;
  cleared.push(`resources:${removed}`);

  return cleared;
}

export function createCacheRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.get("/stats", (c) => {
    try {
      const stats = getCache()?.getStats() ?? disabledStats();
      recordStatsSnapshot(stats);
      const response: APIResponse<ResourceCacheStats> = { success: true, data: stats };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  app.post("/invalidate", async (c) => {
    try {
      const body: { key?: string; type?: string } = await c.req
        .json<{ key?: string; type?: string }>()
        .catch(() => ({}));
      const key = body.key ?? c.req.query("key");
      const type = parseCacheType(body.type ?? c.req.query("type"));
      if (!key && !type) {
        const response: APIResponse = {
          success: false,
          error: "key or type is required",
        };
        return c.json(response, 400);
      }

      const invalidated = getCache()?.invalidate({ key, type }) ?? 0;
      const response: APIResponse<{ invalidated: number }> = {
        success: true,
        data: { invalidated },
      };
      return c.json(response);
    } catch (error) {
      const status = getErrorMessage(error).startsWith("Invalid cache type") ? 400 : 500;
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, status);
    }
  });

  app.post("/warm", async (c) => {
    try {
      const body = await c.req.json<CacheWarmRequest>().catch(() => ({}));
      const preloader =
        getPreloader() ??
        initPreloader({
          db: deps.memory.db,
          config: deps.agent.getConfig(),
          toolRegistry: deps.toolRegistry,
        });
      const result = await preloader.warm(body);
      const stats = getCache()?.getStats();
      if (stats) recordStatsSnapshot(stats);

      const response: APIResponse<typeof result> = {
        success: true,
        data: result,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  app.delete("/", (c) => {
    try {
      const cleared = clearLegacyCaches(deps);
      const response: APIResponse<{ cleared: string[]; message: string }> = {
        success: true,
        data: {
          cleared,
          message: `Cleared caches: ${cleared.join(", ")}`,
        },
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Clear in-memory caches (agent context cache, tool RAG cache, peer cache via bridge reconnect)
  app.post("/clear", async (c) => {
    try {
      const cleared = clearLegacyCaches(deps);

      const response: APIResponse<{ cleared: string[]; message: string }> = {
        success: true,
        data: {
          cleared,
          message:
            cleared.length > 0
              ? `Cleared caches: ${cleared.join(", ")}`
              : "Cache cleared (no active cache modules found)",
        },
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
