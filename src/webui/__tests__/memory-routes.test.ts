import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createMemoryRoutes } from "../routes/memory.js";
import type { WebUIServerDeps } from "../types.js";

function createTestApp(overrides: Partial<WebUIServerDeps>) {
  const deps = {
    memory: {
      db: {},
      knowledge: {
        indexAll: vi.fn(),
      },
      vectorStore: {
        isConfigured: false,
        namespace: "teleton-memory",
        healthCheck: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/api/memory", createMemoryRoutes(deps));
  return app;
}

describe("memory routes", () => {
  it("syncs old memory files to vector memory when Upstash is online", async () => {
    const indexAll = vi.fn().mockResolvedValue({ indexed: 2, skipped: 1 });
    const healthCheck = vi
      .fn()
      .mockResolvedValueOnce({ mode: "online", vectorCount: 4 })
      .mockResolvedValueOnce({ mode: "online", vectorCount: 6 });

    const app = createTestApp({
      memory: {
        db: {} as WebUIServerDeps["memory"]["db"],
        embedder: {} as WebUIServerDeps["memory"]["embedder"],
        knowledge: { indexAll } as unknown as WebUIServerDeps["memory"]["knowledge"],
        vectorStore: {
          isConfigured: true,
          namespace: "teleton-memory",
          healthCheck,
        } as unknown as WebUIServerDeps["memory"]["vectorStore"],
      },
    });

    const res = await app.request("/api/memory/sync-vector", { method: "POST" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(indexAll).toHaveBeenCalledWith({ force: true });
    expect(json.success).toBe(true);
    expect(json.data.synced).toBe(true);
    expect(json.data.indexed).toBe(2);
    expect(json.data.skipped).toBe(1);
    expect(json.data.status.mode).toBe("online");
  });

  it("keeps local memory active and skips vector sync when Upstash is not configured", async () => {
    const indexAll = vi.fn();
    const healthCheck = vi.fn().mockResolvedValue({
      mode: "standby",
      reason: "UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN are not configured",
    });

    const app = createTestApp({
      memory: {
        db: {} as WebUIServerDeps["memory"]["db"],
        embedder: {} as WebUIServerDeps["memory"]["embedder"],
        knowledge: { indexAll } as unknown as WebUIServerDeps["memory"]["knowledge"],
        vectorStore: {
          isConfigured: false,
          namespace: "teleton-memory",
          healthCheck,
        } as unknown as WebUIServerDeps["memory"]["vectorStore"],
      },
    });

    const res = await app.request("/api/memory/sync-vector", { method: "POST" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(indexAll).not.toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.data.synced).toBe(false);
    expect(json.data.status.mode).toBe("standby");
    expect(json.data.message).toContain("not configured");
  });
});
