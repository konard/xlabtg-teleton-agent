import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createMemoryRoutes } from "../routes/memory.js";
import type { WebUIServerDeps } from "../types.js";
import { ensureSchema } from "../../memory/schema.js";
import { MemoryGraphStore } from "../../memory/graph-store.js";

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
  let db: InstanceType<typeof Database> | null = null;

  beforeEach(() => {
    db = null;
  });

  afterEach(() => {
    db?.close();
  });

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

  it("exposes memory graph nodes, related traversal, path, and task context", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    const store = new MemoryGraphStore(db);
    const conversation = store.upsertNode({ type: "conversation", label: "Telegram chat 42" });
    const task = store.upsertNode({
      type: "task",
      label: "Review wallet setup",
      metadata: { taskId: "task-42" },
    });
    const tool = store.upsertNode({ type: "tool", label: "telegram_send_message" });
    store.upsertEdge({ sourceId: conversation.id, targetId: task.id, relation: "ABOUT" });
    store.upsertEdge({ sourceId: conversation.id, targetId: tool.id, relation: "USED_TOOL" });

    const app = createTestApp({
      memory: {
        db,
        embedder: {} as WebUIServerDeps["memory"]["embedder"],
        knowledge: { indexAll: vi.fn() } as unknown as WebUIServerDeps["memory"]["knowledge"],
      },
    });

    const nodesRes = await app.request("/api/memory/graph/nodes?type=tool&q=telegram");
    const nodesJson = await nodesRes.json();
    expect(nodesRes.status).toBe(200);
    expect(nodesJson.data.nodes).toHaveLength(1);
    expect(nodesJson.data.nodes[0].label).toBe("telegram_send_message");

    const relatedRes = await app.request(`/api/memory/graph/node/${conversation.id}/related`);
    const relatedJson = await relatedRes.json();
    expect(relatedRes.status).toBe(200);
    expect(
      relatedJson.data.edges.map((edge: { relation: string }) => edge.relation).sort()
    ).toEqual(["ABOUT", "USED_TOOL"]);

    const pathRes = await app.request(`/api/memory/graph/path?from=${task.id}&to=${tool.id}`);
    const pathJson = await pathRes.json();
    expect(pathRes.status).toBe(200);
    expect(pathJson.data.nodes.map((node: { id: string }) => node.id)).toEqual([
      task.id,
      conversation.id,
      tool.id,
    ]);

    const contextRes = await app.request("/api/memory/graph/context?task_id=task-42");
    const contextJson = await contextRes.json();
    expect(contextRes.status).toBe(200);
    expect(contextJson.data.nodes.map((node: { id: string }) => node.id)).toContain(task.id);
  });

  it("filters memory search by minimum score and exposes priority management endpoints", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    db.prepare(
      `
      INSERT INTO knowledge (id, source, text, hash)
      VALUES
        ('route-low', 'memory', 'route priority search target', 'h-low'),
        ('route-high', 'memory', 'route priority search target', 'h-high')
    `
    ).run();
    db.prepare(
      `
      INSERT INTO memory_scores (memory_id, score, recency, frequency, impact, explicit, centrality, updated_at)
      VALUES
        ('route-low', 0.1, 0.1, 0, 0, 0, 0, unixepoch()),
        ('route-high', 0.9, 0.9, 0, 0, 0, 0, unixepoch())
    `
    ).run();

    const app = createTestApp({
      memory: {
        db,
        embedder: {} as WebUIServerDeps["memory"]["embedder"],
        knowledge: { indexAll: vi.fn() } as unknown as WebUIServerDeps["memory"]["knowledge"],
      },
    });

    const searchRes = await app.request(
      "/api/memory/search?q=route%20priority%20search%20target&min_score=0.5"
    );
    const searchJson = await searchRes.json();
    expect(searchRes.status).toBe(200);
    expect(searchJson.data.map((result: { id: string }) => result.id)).toContain("route-high");
    expect(searchJson.data.map((result: { id: string }) => result.id)).not.toContain("route-low");

    const pinRes = await app.request("/api/memory/scores/route-low/pin", {
      method: "POST",
      body: JSON.stringify({ pinned: true }),
      headers: { "Content-Type": "application/json" },
    });
    const pinJson = await pinRes.json();
    expect(pinRes.status).toBe(200);
    expect(pinJson.data.pinned).toBe(true);

    const cleanupRes = await app.request("/api/memory/cleanup?dry_run=true", { method: "POST" });
    const cleanupJson = await cleanupRes.json();
    expect(cleanupRes.status).toBe(200);
    expect(cleanupJson.data.dryRun).toBe(true);
  });
});
