import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createCacheRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // Clear in-memory caches (agent context cache, tool RAG cache, peer cache via bridge reconnect)
  app.post("/clear", async (c) => {
    try {
      const cleared: string[] = [];

      // Clear agent's tool RAG / context caches if available
      if (
        deps.agent &&
        typeof (deps.agent as unknown as Record<string, unknown>).clearCache === "function"
      ) {
        (deps.agent as unknown as Record<string, () => void>).clearCache();
        cleared.push("agent");
      }

      // Clear knowledge embedder cache if available
      if (
        deps.memory?.embedder &&
        typeof (deps.memory.embedder as unknown as Record<string, unknown>).clearCache ===
          "function"
      ) {
        (deps.memory.embedder as unknown as Record<string, () => void>).clearCache();
        cleared.push("embedder");
      }

      // Clear tool registry cache if available
      if (
        deps.toolRegistry &&
        typeof (deps.toolRegistry as unknown as Record<string, unknown>).clearCache === "function"
      ) {
        (deps.toolRegistry as unknown as Record<string, () => void>).clearCache();
        cleared.push("toolRegistry");
      }

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
