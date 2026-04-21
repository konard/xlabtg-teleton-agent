import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

export const MEMORY_GRAPH_NODE_TYPES = [
  "conversation",
  "task",
  "tool",
  "topic",
  "entity",
  "outcome",
] as const;

export type MemoryGraphNodeType = (typeof MEMORY_GRAPH_NODE_TYPES)[number];
export type MemoryGraphMetadata = Record<string, unknown>;

export interface MemoryGraphNode {
  id: string;
  type: MemoryGraphNodeType;
  label: string;
  metadata: MemoryGraphMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  createdAt: number;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

interface GraphNodeRow {
  id: string;
  type: MemoryGraphNodeType;
  label: string;
  normalized_label: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

interface GraphEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  created_at: number;
}

function isMemoryGraphNodeType(value: string): value is MemoryGraphNodeType {
  return (MEMORY_GRAPH_NODE_TYPES as readonly string[]).includes(value);
}

function parseMetadata(value: string | null): MemoryGraphMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as MemoryGraphMetadata)
      : {};
  } catch {
    return {};
  }
}

function serializeMetadata(metadata: MemoryGraphMetadata | undefined): string {
  return JSON.stringify(metadata ?? {});
}

function mergeMetadata(
  existing: MemoryGraphMetadata,
  incoming: MemoryGraphMetadata | undefined
): MemoryGraphMetadata {
  if (!incoming) return existing;
  return { ...existing, ...incoming };
}

function normalizeUrlLabel(label: string): string | null {
  if (!/^https?:\/\//i.test(label)) return null;
  try {
    const url = new URL(label);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeGraphLabel(label: string): string {
  const cleaned = label.normalize("NFKC").trim().replace(/\s+/g, " ");
  const urlLabel = normalizeUrlLabel(cleaned);
  if (urlLabel) return urlLabel;
  return cleaned.toLowerCase().replace(/[.,;:!?]+$/g, "");
}

export function normalizeGraphRelation(relation: string): string {
  const normalized = relation
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "RELATED_TO";
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) return [compact];
  const result: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) {
    result.push(compact.slice(i, i + 2));
  }
  return result;
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  const left = bigrams(a);
  const right = new Map<string, number>();
  for (const pair of bigrams(b)) {
    right.set(pair, (right.get(pair) ?? 0) + 1);
  }

  let overlap = 0;
  for (const pair of left) {
    const count = right.get(pair) ?? 0;
    if (count > 0) {
      overlap++;
      right.set(pair, count - 1);
    }
  }

  return (2 * overlap) / (left.length + bigrams(b).length);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function rowToNode(row: GraphNodeRow): MemoryGraphNode {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: GraphEdgeRow): MemoryGraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    weight: row.weight,
    createdAt: row.created_at,
  };
}

export class MemoryGraphStore {
  constructor(private db: Database.Database) {}

  getNode(id: string): MemoryGraphNode | null {
    const row = this.db.prepare(`SELECT * FROM graph_nodes WHERE id = ?`).get(id) as
      | GraphNodeRow
      | undefined;
    return row ? rowToNode(row) : null;
  }

  getEdge(id: string): MemoryGraphEdge | null {
    const row = this.db.prepare(`SELECT * FROM graph_edges WHERE id = ?`).get(id) as
      | GraphEdgeRow
      | undefined;
    return row ? rowToEdge(row) : null;
  }

  upsertNode(input: {
    id?: string;
    type: MemoryGraphNodeType;
    label: string;
    metadata?: MemoryGraphMetadata;
  }): MemoryGraphNode {
    const label = input.label.trim();
    if (!label) {
      throw new Error("Graph node label is required");
    }
    if (!isMemoryGraphNodeType(input.type)) {
      throw new Error(`Unsupported graph node type: ${input.type}`);
    }

    const normalizedLabel = normalizeGraphLabel(label);
    const existing = this.findByNormalizedLabel(input.type, normalizedLabel);
    const fuzzy = existing ?? this.findFuzzyCandidate(input.type, normalizedLabel);

    if (fuzzy) {
      const metadata = mergeMetadata(fuzzy.metadata, input.metadata);
      this.db
        .prepare(
          `
          UPDATE graph_nodes
          SET metadata = ?, updated_at = unixepoch()
          WHERE id = ?
        `
        )
        .run(serializeMetadata(metadata), fuzzy.id);
      const updated = this.getNode(fuzzy.id);
      if (!updated) throw new Error(`Failed to reload graph node ${fuzzy.id}`);
      return updated;
    }

    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO graph_nodes (id, type, label, normalized_label, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `
      )
      .run(id, input.type, label, normalizedLabel, serializeMetadata(input.metadata));

    const node = this.getNode(id);
    if (!node) throw new Error(`Failed to create graph node ${id}`);
    return node;
  }

  upsertEdge(input: {
    id?: string;
    sourceId: string;
    targetId: string;
    relation: string;
    weight?: number;
  }): MemoryGraphEdge {
    if (input.sourceId === input.targetId) {
      throw new Error("Graph edge source and target must be different nodes");
    }
    const relation = normalizeGraphRelation(input.relation);
    const weight = input.weight ?? 1;
    const id = input.id ?? randomUUID();

    this.db
      .prepare(
        `
        INSERT INTO graph_edges (id, source_id, target_id, relation, weight, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
          weight = max(graph_edges.weight, excluded.weight)
      `
      )
      .run(id, input.sourceId, input.targetId, relation, weight);

    const row = this.db
      .prepare(
        `
        SELECT * FROM graph_edges
        WHERE source_id = ? AND target_id = ? AND relation = ?
      `
      )
      .get(input.sourceId, input.targetId, relation) as GraphEdgeRow | undefined;
    if (!row) {
      throw new Error(
        `Failed to create graph edge ${input.sourceId} ${relation} ${input.targetId}`
      );
    }
    return rowToEdge(row);
  }

  listNodes(
    opts: {
      type?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): { nodes: MemoryGraphNode[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.type) {
      if (!isMemoryGraphNodeType(opts.type)) {
        return { nodes: [], total: 0 };
      }
      conditions.push("type = ?");
      params.push(opts.type);
    }

    if (opts.q?.trim()) {
      const q = `%${escapeLike(opts.q.trim())}%`;
      const normalizedQ = `%${escapeLike(normalizeGraphLabel(opts.q.trim()))}%`;
      conditions.push("(label LIKE ? ESCAPE '\\' OR normalized_label LIKE ? ESCAPE '\\')");
      params.push(q, normalizedQ);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM graph_nodes ${where}`).get(...params) as {
        count: number;
      }
    ).count;
    const limit = clampInt(opts.limit, 1, 500, 50);
    const offset = clampInt(opts.offset, 0, 100_000, 0);
    const rows = this.db
      .prepare(
        `
        SELECT * FROM graph_nodes
        ${where}
        ORDER BY updated_at DESC, created_at DESC, label ASC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as GraphNodeRow[];

    return { nodes: rows.map(rowToNode), total };
  }

  getEdgesForNode(nodeId: string): MemoryGraphEdge[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM graph_edges
        WHERE source_id = ? OR target_id = ?
        ORDER BY weight DESC, created_at DESC
      `
      )
      .all(nodeId, nodeId) as GraphEdgeRow[];
    return rows.map(rowToEdge);
  }

  getEdgesBetweenNodeIds(nodeIds: string[]): MemoryGraphEdge[] {
    const uniqueIds = [...new Set(nodeIds)];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
        SELECT * FROM graph_edges
        WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
        ORDER BY weight DESC, created_at DESC
      `
      )
      .all(...uniqueIds, ...uniqueIds) as GraphEdgeRow[];
    return rows.map(rowToEdge);
  }

  getOverview(opts: { type?: string; q?: string; limit?: number } = {}): MemoryGraph & {
    total: number;
  } {
    const { nodes, total } = this.listNodes({
      type: opts.type,
      q: opts.q,
      limit: opts.limit ?? 120,
    });
    return {
      nodes,
      edges: this.getEdgesBetweenNodeIds(nodes.map((node) => node.id)),
      total,
    };
  }

  findTaskNode(taskId: string): MemoryGraphNode | null {
    const direct = this.getNode(taskId);
    if (direct?.type === "task") return direct;

    const normalized = normalizeGraphLabel(taskId);
    const exact = this.findByNormalizedLabel("task", normalized);
    if (exact) return exact;

    const rows = this.db
      .prepare(`SELECT * FROM graph_nodes WHERE type = 'task' ORDER BY updated_at DESC LIMIT 1000`)
      .all() as GraphNodeRow[];

    for (const row of rows) {
      const node = rowToNode(row);
      const metadataTaskId = node.metadata.taskId;
      if (typeof metadataTaskId === "string" && metadataTaskId === taskId) return node;
    }

    return null;
  }

  findNodesByTerms(terms: string[], opts: { limit?: number } = {}): MemoryGraphNode[] {
    const seen = new Set<string>();
    const result: MemoryGraphNode[] = [];
    const limit = clampInt(opts.limit, 1, 50, 10);

    for (const term of terms) {
      const { nodes } = this.listNodes({ q: term, limit });
      for (const node of nodes) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        result.push(node);
        if (result.length >= limit) return result;
      }
    }

    return result;
  }

  private findByNormalizedLabel(
    type: MemoryGraphNodeType,
    normalizedLabel: string
  ): MemoryGraphNode | null {
    const row = this.db
      .prepare(`SELECT * FROM graph_nodes WHERE type = ? AND normalized_label = ?`)
      .get(type, normalizedLabel) as GraphNodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  private findFuzzyCandidate(
    type: MemoryGraphNodeType,
    normalizedLabel: string
  ): MemoryGraphNode | null {
    if (normalizedLabel.length < 12) return null;

    const rows = this.db
      .prepare(
        `
        SELECT * FROM graph_nodes
        WHERE type = ?
        ORDER BY updated_at DESC
        LIMIT 500
      `
      )
      .all(type) as GraphNodeRow[];

    let best: { node: MemoryGraphNode; score: number } | null = null;
    for (const row of rows) {
      const score = diceCoefficient(normalizedLabel, row.normalized_label);
      if (score >= 0.9 && (!best || score > best.score)) {
        best = { node: rowToNode(row), score };
      }
    }

    return best?.node ?? null;
  }
}
