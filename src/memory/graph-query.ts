import type { MemoryGraph, MemoryGraphEdge, MemoryGraphNode } from "./graph-store.js";
import type { MemoryGraphStore } from "./graph-store.js";

function clampDepth(depth: number | undefined, fallback: number, max = 4): number {
  if (!Number.isFinite(depth)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(depth as number)));
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit as number)));
}

function edgeOtherNode(edge: MemoryGraphEdge, nodeId: string): string {
  return edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
}

export class MemoryGraphQuery {
  constructor(private store: MemoryGraphStore) {}

  getRelated(
    nodeId: string,
    opts: { depth?: number; limit?: number } = {}
  ): MemoryGraph & { root: MemoryGraphNode | null } {
    const root = this.store.getNode(nodeId);
    if (!root) return { root: null, nodes: [], edges: [] };

    const depth = clampDepth(opts.depth, 1);
    const limit = clampLimit(opts.limit, 100);
    const nodes = new Map<string, MemoryGraphNode>([[root.id, root]]);
    const edges = new Map<string, MemoryGraphEdge>();
    const visited = new Set<string>([root.id]);
    let frontier = [root.id];

    for (let level = 0; level < depth && frontier.length > 0; level++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        for (const edge of this.store.getEdgesForNode(currentId)) {
          edges.set(edge.id, edge);
          const otherId = edgeOtherNode(edge, currentId);
          if (!visited.has(otherId)) {
            const node = this.store.getNode(otherId);
            if (node) {
              nodes.set(node.id, node);
              visited.add(node.id);
              nextFrontier.push(node.id);
              if (nodes.size >= limit) break;
            }
          }
        }
        if (nodes.size >= limit) break;
      }

      frontier = nextFrontier;
      if (nodes.size >= limit) break;
    }

    return {
      root,
      nodes: [...nodes.values()],
      edges: [...edges.values()].filter(
        (edge) => nodes.has(edge.sourceId) && nodes.has(edge.targetId)
      ),
    };
  }

  findShortestPath(
    fromId: string,
    toId: string,
    opts: { maxDepth?: number } = {}
  ): MemoryGraph | null {
    const from = this.store.getNode(fromId);
    const to = this.store.getNode(toId);
    if (!from || !to) return null;
    if (from.id === to.id) return { nodes: [from], edges: [] };

    const maxDepth = clampDepth(opts.maxDepth, 6, 8);
    const visited = new Set<string>([from.id]);
    const previous = new Map<string, { nodeId: string; edge: MemoryGraphEdge }>();
    let frontier = [from.id];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        for (const edge of this.store.getEdgesForNode(currentId)) {
          const otherId = edgeOtherNode(edge, currentId);
          if (visited.has(otherId)) continue;

          visited.add(otherId);
          previous.set(otherId, { nodeId: currentId, edge });

          if (otherId === to.id) {
            return this.buildPath(from.id, to.id, previous);
          }

          nextFrontier.push(otherId);
        }
      }

      frontier = nextFrontier;
    }

    return null;
  }

  getTaskContext(
    taskId: string,
    opts: { depth?: number; limit?: number } = {}
  ): MemoryGraph & { root: MemoryGraphNode | null } {
    const task = this.store.findTaskNode(taskId);
    if (!task) return { root: null, nodes: [], edges: [] };
    return this.getRelated(task.id, { depth: opts.depth ?? 2, limit: opts.limit });
  }

  private buildPath(
    fromId: string,
    toId: string,
    previous: Map<string, { nodeId: string; edge: MemoryGraphEdge }>
  ): MemoryGraph | null {
    const nodeIds: string[] = [toId];
    const edges: MemoryGraphEdge[] = [];
    let current = toId;

    while (current !== fromId) {
      const step = previous.get(current);
      if (!step) return null;
      edges.push(step.edge);
      current = step.nodeId;
      nodeIds.push(current);
    }

    nodeIds.reverse();
    edges.reverse();

    const nodes = nodeIds
      .map((nodeId) => this.store.getNode(nodeId))
      .filter((node): node is MemoryGraphNode => node !== null);

    return nodes.length === nodeIds.length ? { nodes, edges } : null;
  }
}
