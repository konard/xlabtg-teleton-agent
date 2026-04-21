import type Database from "better-sqlite3";
import { SECONDS_PER_DAY } from "../constants/limits.js";

export interface MemoryScoringWeights {
  recency: number;
  frequency: number;
  impact: number;
  explicit: number;
  centrality: number;
}

export interface MemoryScoringConfig {
  weights?: Partial<MemoryScoringWeights>;
  recency_half_life_days?: number;
}

export interface MemoryScoreRecord {
  memoryId: string;
  score: number;
  recency: number;
  frequency: number;
  impact: number;
  explicit: number;
  centrality: number;
  accessCount: number;
  impactCount: number;
  pinned: boolean;
  lastAccessedAt: number | null;
  updatedAt: number;
}

export interface MemoryScoreDistributionBucket {
  min: number;
  max: number;
  count: number;
}

export interface MemoryScoreStats {
  total: number;
  averageScore: number;
  pinned: number;
  distribution: MemoryScoreDistributionBucket[];
}

interface KnowledgeScoreRow {
  id: string;
  text: string;
  path: string | null;
  created_at: number;
  updated_at: number;
  score: number | null;
  access_count: number | null;
  impact_count: number | null;
  pinned: number | null;
  last_accessed_at: number | null;
}

interface MemoryScoreDbRow {
  memory_id: string;
  score: number;
  recency: number;
  frequency: number;
  impact: number;
  explicit: number;
  centrality: number;
  access_count: number;
  impact_count: number;
  pinned: number;
  last_accessed_at: number | null;
  updated_at: number;
}

interface CentralityLabel {
  label: string;
  score: number;
}

const DEFAULT_WEIGHTS: MemoryScoringWeights = {
  recency: 0.35,
  frequency: 0.2,
  impact: 0.2,
  explicit: 0.15,
  centrality: 0.1,
};

const DEFAULT_HALF_LIFE_DAYS = 30;
const EXPLICIT_MARKERS = [
  /\bremember\s+this\b/i,
  /\bimportant\b/i,
  /\bcritical\b/i,
  /\bdo\s+not\s+forget\b/i,
  /\bpin(?:ned)?\b/i,
  /\buser[-\s]?flagged\b/i,
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeWeights(input?: Partial<MemoryScoringWeights>): MemoryScoringWeights {
  const raw: MemoryScoringWeights = {
    recency: Math.max(0, input?.recency ?? DEFAULT_WEIGHTS.recency),
    frequency: Math.max(0, input?.frequency ?? DEFAULT_WEIGHTS.frequency),
    impact: Math.max(0, input?.impact ?? DEFAULT_WEIGHTS.impact),
    explicit: Math.max(0, input?.explicit ?? DEFAULT_WEIGHTS.explicit),
    centrality: Math.max(0, input?.centrality ?? DEFAULT_WEIGHTS.centrality),
  };

  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return DEFAULT_WEIGHTS;

  return {
    recency: raw.recency / total,
    frequency: raw.frequency / total,
    impact: raw.impact / total,
    explicit: raw.explicit / total,
    centrality: raw.centrality / total,
  };
}

function hasExplicitMarker(text: string): boolean {
  return EXPLICIT_MARKERS.some((marker) => marker.test(text));
}

function rowToRecord(row: MemoryScoreDbRow): MemoryScoreRecord {
  return {
    memoryId: row.memory_id,
    score: row.score,
    recency: row.recency,
    frequency: row.frequency,
    impact: row.impact,
    explicit: row.explicit,
    centrality: row.centrality,
    accessCount: row.access_count,
    impactCount: row.impact_count,
    pinned: row.pinned === 1,
    lastAccessedAt: row.last_accessed_at,
    updatedAt: row.updated_at,
  };
}

function uniqueIds(memoryIds: string[]): string[] {
  return [...new Set(memoryIds.map((id) => id.trim()).filter(Boolean))];
}

export class MemoryScorer {
  private weights: MemoryScoringWeights;
  private halfLifeDays: number;

  constructor(
    private db: Database.Database,
    config: MemoryScoringConfig = {}
  ) {
    this.weights = normalizeWeights(config.weights);
    this.halfLifeDays = positive(config.recency_half_life_days, DEFAULT_HALF_LIFE_DAYS);
  }

  recordAccess(memoryIds: string[], amount = 1, now = Math.floor(Date.now() / 1000)): void {
    const ids = uniqueIds(memoryIds);
    if (ids.length === 0) return;

    this.ensureScoreRows(ids);
    const increment = Math.max(1, Math.floor(amount));
    const update = this.db.prepare(
      `
      UPDATE memory_scores
      SET access_count = access_count + ?,
          last_accessed_at = ?,
          updated_at = ?
      WHERE memory_id = ?
    `
    );

    this.db.transaction(() => {
      for (const id of ids) {
        update.run(increment, now, now, id);
      }
    })();

    this.recalculate(ids, now);
  }

  boostImpact(memoryIds: string[], amount = 1, now = Math.floor(Date.now() / 1000)): void {
    const ids = uniqueIds(memoryIds);
    if (ids.length === 0) return;

    this.ensureScoreRows(ids);
    const increment = Math.max(1, Math.floor(amount));
    const update = this.db.prepare(
      `
      UPDATE memory_scores
      SET impact_count = impact_count + ?,
          updated_at = ?
      WHERE memory_id = ?
    `
    );

    this.db.transaction(() => {
      for (const id of ids) {
        update.run(increment, now, id);
      }
    })();

    this.recalculate(ids, now);
  }

  pinMemory(
    memoryId: string,
    pinned: boolean,
    now = Math.floor(Date.now() / 1000)
  ): MemoryScoreRecord {
    this.ensureScoreRows([memoryId]);
    this.db
      .prepare(
        `
        UPDATE memory_scores
        SET pinned = ?, updated_at = ?
        WHERE memory_id = ?
      `
      )
      .run(pinned ? 1 : 0, now, memoryId);
    this.recalculate([memoryId], now);

    const score = this.getScore(memoryId);
    if (!score) {
      throw new Error(`Memory score not found for ${memoryId}`);
    }
    return score;
  }

  recalculateAll(now = Math.floor(Date.now() / 1000)): { scored: number } {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO memory_scores (memory_id, updated_at)
        SELECT id, ? FROM knowledge
      `
      )
      .run(now);

    return this.recalculate(undefined, now);
  }

  recalculate(memoryIds?: string[], now = Math.floor(Date.now() / 1000)): { scored: number } {
    const ids = memoryIds ? uniqueIds(memoryIds) : [];
    if (memoryIds && ids.length === 0) return { scored: 0 };

    const rows = this.getKnowledgeRows(ids);
    const centralityLabels = this.getCentralityLabels();
    const update = this.db.prepare(
      `
      UPDATE memory_scores
      SET score = ?,
          recency = ?,
          frequency = ?,
          impact = ?,
          explicit = ?,
          centrality = ?,
          updated_at = ?
      WHERE memory_id = ?
    `
    );

    this.db.transaction(() => {
      for (const row of rows) {
        const components = this.calculateComponents(row, centralityLabels, now);
        const composite =
          this.weights.recency * components.recency +
          this.weights.frequency * components.frequency +
          this.weights.impact * components.impact +
          this.weights.explicit * components.explicit +
          this.weights.centrality * components.centrality;

        update.run(
          clamp01(composite),
          components.recency,
          components.frequency,
          components.impact,
          components.explicit,
          components.centrality,
          now,
          row.id
        );
      }
    })();

    return { scored: rows.length };
  }

  getScore(memoryId: string): MemoryScoreRecord | null {
    const row = this.db.prepare(`SELECT * FROM memory_scores WHERE memory_id = ?`).get(memoryId) as
      | MemoryScoreDbRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  listScores(options: { limit?: number; minScore?: number } = {}): MemoryScoreRecord[] {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    const minScore = clamp01(options.minScore ?? 0);
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM memory_scores
        WHERE score >= ?
        ORDER BY score DESC, updated_at DESC
        LIMIT ?
      `
      )
      .all(minScore, limit) as MemoryScoreDbRow[];
    return rows.map(rowToRecord);
  }

  listPinned(limit = 50): MemoryScoreRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM memory_scores
        WHERE pinned = 1
        ORDER BY updated_at DESC
        LIMIT ?
      `
      )
      .all(safeLimit) as MemoryScoreDbRow[];
    return rows.map(rowToRecord);
  }

  getStats(bucketCount = 10): MemoryScoreStats {
    this.recalculateAll();
    const safeBucketCount = Math.max(1, Math.min(50, Math.floor(bucketCount)));
    const rows = this.db.prepare(`SELECT score, pinned FROM memory_scores`).all() as Array<{
      score: number;
      pinned: number;
    }>;

    const buckets: MemoryScoreDistributionBucket[] = Array.from(
      { length: safeBucketCount },
      (_, index) => ({
        min: index / safeBucketCount,
        max: (index + 1) / safeBucketCount,
        count: 0,
      })
    );

    let totalScore = 0;
    let pinned = 0;
    for (const row of rows) {
      const score = clamp01(row.score);
      totalScore += score;
      if (row.pinned === 1) pinned++;
      const bucketIndex = Math.min(safeBucketCount - 1, Math.floor(score * safeBucketCount));
      buckets[bucketIndex].count++;
    }

    return {
      total: rows.length,
      averageScore: rows.length > 0 ? totalScore / rows.length : 0,
      pinned,
      distribution: buckets,
    };
  }

  private ensureScoreRows(memoryIds: string[]): void {
    const ids = uniqueIds(memoryIds);
    if (ids.length === 0) return;
    const insert = this.db.prepare(
      `
      INSERT OR IGNORE INTO memory_scores (memory_id, updated_at)
      SELECT id, unixepoch()
      FROM knowledge
      WHERE id = ?
    `
    );

    this.db.transaction(() => {
      for (const id of ids) {
        insert.run(id);
      }
    })();
  }

  private getKnowledgeRows(ids: string[]): KnowledgeScoreRow[] {
    const where = ids.length > 0 ? `WHERE k.id IN (${ids.map(() => "?").join(", ")})` : "";
    return this.db
      .prepare(
        `
        SELECT
          k.id,
          k.text,
          k.path,
          k.created_at,
          k.updated_at,
          ms.score,
          ms.access_count,
          ms.impact_count,
          ms.pinned,
          ms.last_accessed_at
        FROM knowledge k
        LEFT JOIN memory_scores ms ON ms.memory_id = k.id
        ${where}
      `
      )
      .all(...ids) as KnowledgeScoreRow[];
  }

  private calculateComponents(
    row: KnowledgeScoreRow,
    centralityLabels: CentralityLabel[],
    now: number
  ): Omit<
    MemoryScoreRecord,
    "memoryId" | "score" | "accessCount" | "impactCount" | "pinned" | "lastAccessedAt" | "updatedAt"
  > {
    const timestamp = Math.max(row.created_at, row.updated_at);
    const ageDays = Math.max(0, (now - timestamp) / SECONDS_PER_DAY);
    const recency = clamp01(Math.exp((-Math.LN2 * ageDays) / this.halfLifeDays));
    const accessCount = Math.max(0, row.access_count ?? 0);
    const impactCount = Math.max(0, row.impact_count ?? 0);
    const frequency = clamp01(1 - Math.exp(-accessCount / 10));
    const impact = clamp01(1 - Math.exp(-impactCount / 5));
    const explicit = row.pinned === 1 || hasExplicitMarker(row.text) ? 1 : 0;
    const centrality = this.calculateCentrality(row, centralityLabels);

    return {
      recency,
      frequency,
      impact,
      explicit,
      centrality,
    };
  }

  private getCentralityLabels(): CentralityLabel[] {
    const nodes = this.db.prepare(`SELECT id, label FROM graph_nodes`).all() as Array<{
      id: string;
      label: string;
    }>;
    if (nodes.length === 0) return [];

    const degreeRows = this.db
      .prepare(
        `
        SELECT node_id, SUM(weight) as degree
        FROM (
          SELECT source_id as node_id, weight FROM graph_edges
          UNION ALL
          SELECT target_id as node_id, weight FROM graph_edges
        )
        GROUP BY node_id
      `
      )
      .all() as Array<{ node_id: string; degree: number | null }>;

    const degreeByNode = new Map<string, number>();
    for (const row of degreeRows) {
      degreeByNode.set(row.node_id, Math.max(0, row.degree ?? 0));
    }
    const maxDegree = Math.max(1, ...degreeByNode.values());

    return nodes
      .map((node) => ({
        label: node.label.trim().toLowerCase(),
        score: clamp01((degreeByNode.get(node.id) ?? 0) / maxDegree),
      }))
      .filter((node) => node.label.length >= 3 && node.score > 0);
  }

  private calculateCentrality(row: KnowledgeScoreRow, labels: CentralityLabel[]): number {
    if (labels.length === 0) return 0;
    const haystack = `${row.text} ${row.path ?? ""}`.toLowerCase();
    let best = 0;
    for (const label of labels) {
      if (haystack.includes(label.label)) {
        best = Math.max(best, label.score);
      }
    }
    return clamp01(best);
  }
}
