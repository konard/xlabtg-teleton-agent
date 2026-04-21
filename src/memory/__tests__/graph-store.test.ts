import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MemoryGraphStore } from "../graph-store.js";
import { MemoryGraphQuery } from "../graph-query.js";

describe("MemoryGraphStore", () => {
  let db: InstanceType<typeof Database>;
  let store: MemoryGraphStore;
  let query: MemoryGraphQuery;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    store = new MemoryGraphStore(db);
    query = new MemoryGraphQuery(store);
  });

  afterEach(() => {
    db.close();
  });

  it("deduplicates similar nodes and merges metadata", () => {
    const first = store.upsertNode({
      type: "entity",
      label: "https://example.com/docs",
      metadata: { source: "first" },
    });
    const second = store.upsertNode({
      type: "entity",
      label: "HTTPS://EXAMPLE.COM/DOCS/",
      metadata: { seenAgain: true },
    });

    expect(second.id).toBe(first.id);
    expect(second.metadata).toMatchObject({ source: "first", seenAgain: true });
    expect(store.listNodes({ type: "entity" }).nodes).toHaveLength(1);
  });

  it("traverses related nodes up to the requested depth", () => {
    const conversation = store.upsertNode({ type: "conversation", label: "Chat 1" });
    const task = store.upsertNode({ type: "task", label: "Review TON wallet setup" });
    const tool = store.upsertNode({ type: "tool", label: "telegram_send_message" });

    store.upsertEdge({ sourceId: conversation.id, targetId: task.id, relation: "ABOUT" });
    store.upsertEdge({ sourceId: conversation.id, targetId: tool.id, relation: "USED_TOOL" });

    const related = query.getRelated(conversation.id, { depth: 1 });

    expect(related.nodes.map((node) => node.id).sort()).toEqual(
      [conversation.id, task.id, tool.id].sort()
    );
    expect(related.edges.map((edge) => edge.relation).sort()).toEqual(["ABOUT", "USED_TOOL"]);
  });

  it("finds the shortest path between connected nodes", () => {
    const task = store.upsertNode({ type: "task", label: "Ship graph memory" });
    const conversation = store.upsertNode({ type: "conversation", label: "Chat 2" });
    const tool = store.upsertNode({ type: "tool", label: "workspace_read" });

    store.upsertEdge({ sourceId: conversation.id, targetId: task.id, relation: "ABOUT" });
    store.upsertEdge({ sourceId: conversation.id, targetId: tool.id, relation: "USED_TOOL" });

    const path = query.findShortestPath(task.id, tool.id);

    expect(path?.nodes.map((node) => node.id)).toEqual([task.id, conversation.id, tool.id]);
    expect(path?.edges).toHaveLength(2);
  });

  it("builds task context by graph node id or task metadata id", () => {
    const task = store.upsertNode({
      type: "task",
      label: "Schedule recurring check",
      metadata: { taskId: "task-123" },
    });
    const outcome = store.upsertNode({ type: "outcome", label: "Scheduled every hour" });
    store.upsertEdge({ sourceId: task.id, targetId: outcome.id, relation: "PRODUCED" });

    const byNodeId = query.getTaskContext(task.id, { depth: 1 });
    const byMetadataId = query.getTaskContext("task-123", { depth: 1 });

    expect(byNodeId.nodes.map((node) => node.id).sort()).toEqual([outcome.id, task.id].sort());
    expect(byMetadataId.nodes.map((node) => node.id).sort()).toEqual([outcome.id, task.id].sort());
  });
});
