import type Database from "better-sqlite3";
import { SECONDS_PER_DAY } from "../constants/limits.js";
import { createLogger } from "../utils/logger.js";
import type { SemanticVectorStore } from "./vector-store.js";
import { MemoryScorer, type MemoryScoreRecord } from "./scoring.js";

const log = createLogger("Memory");

export interface MemoryRetentionConfig {
  min_score?: number;
  max_age_days?: number;
  max_entries?: number;
  archive_days?: number;
}

export interface MemoryCleanupCandidate {
  id: string;
  text: string;
  source: string;
  path: string | null;
  score: number;
  createdAt: number;
  updatedAt: number;
  reasons: string[];
}

export interface MemoryCleanupResult {
  dryRun: boolean;
  candidates: MemoryCleanupCandidate[];
  archived: number;
  deleted: number;
  protected: number;
}

export interface MemoryAtRiskEntry extends MemoryCleanupCandidate {
  ageDays: number;
}

export interface MemoryArchiveStats {
  archived: number;
  pendingDeletion: number;
  oldestArchivedAt: number | null;
}

export interface MemoryCleanupHistoryEntry {
  id: number;
  mode: "dry_run" | "archive" | "prune_archive";
  candidates: number;
  archived: number;
  deleted: number;
  protected: number;
  reason: string | null;
  createdAt: number;
}

interface RetentionOptions {
  minScore: number;
  maxAgeDays: number;
  maxEntries: number;
  archiveDays: number;
}

interface MemoryRetentionRow {
  id: string;
  source: string;
  path: string | null;
  text: string;
  embedding: string | null;
  start_line: number | null;
  end_line: number | null;
  hash: string;
  created_at: number;
  updated_at: number;
  score: number | null;
  recency: number | null;
  frequency: number | null;
  impact: number | null;
  explicit: number | null;
  centrality: number | null;
  access_count: number | null;
  impact_count: number | null;
  pinned: number | null;
}

interface CleanupHistoryRow {
  id: number;
  mode: "dry_run" | "archive" | "prune_archive";
  candidates: number;
  archived: number;
  deleted: number;
  protected: number;
  reason: string | null;
  created_at: number;
}

const DEFAULT_RETENTION: RetentionOptions = {
  minScore: 0.1,
  maxAgeDays: 90,
  maxEntries: 10_000,
  archiveDays: 30,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveRetention(config: MemoryRetentionConfig = {}): RetentionOptions {
  return {
    minScore: clamp01(config.min_score ?? DEFAULT_RETENTION.minScore),
    maxAgeDays:
      typeof config.max_age_days === "number" && config.max_age_days > 0
        ? config.max_age_days
        : DEFAULT_RETENTION.maxAgeDays,
    maxEntries:
      typeof config.max_entries === "number" && config.max_entries > 0
        ? Math.floor(config.max_entries)
        : DEFAULT_RETENTION.maxEntries,
    archiveDays:
      typeof config.archive_days === "number" && config.archive_days > 0
        ? config.archive_days
        : DEFAULT_RETENTION.archiveDays,
  };
}

function rowToHistory(row: CleanupHistoryRow): MemoryCleanupHistoryEntry {
  return {
    id: row.id,
    mode: row.mode,
    candidates: row.candidates,
    archived: row.archived,
    deleted: row.deleted,
    protected: row.protected,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export class MemoryRetentionService {
  private options: RetentionOptions;
  private scorer: MemoryScorer;

  constructor(
    private db: Database.Database,
    config: MemoryRetentionConfig = {},
    scorer?: MemoryScorer,
    private vectorStore?: SemanticVectorStore
  ) {
    this.options = resolveRetention(config);
    this.scorer = scorer ?? new MemoryScorer(db);
  }

  evaluate(now = Math.floor(Date.now() / 1000)): {
    candidates: MemoryCleanupCandidate[];
    protected: number;
  } {
    this.scorer.recalculateAll(now);
    const rows = this.getRows();
    const overflowIds = this.getOverflowIds(rows);
    let protectedCount = 0;
    const candidates: MemoryCleanupCandidate[] = [];

    for (const row of rows) {
      const protectedMemory = this.isProtected(row);
      if (protectedMemory) {
        protectedCount++;
        continue;
      }

      const reasons = this.getCandidateReasons(row, overflowIds, now);
      if (reasons.length === 0) continue;

      candidates.push({
        id: row.id,
        text: row.text,
        source: row.source,
        path: row.path,
        score: clamp01(row.score ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reasons,
      });
    }

    candidates.sort((a, b) => a.score - b.score || a.updatedAt - b.updatedAt);
    return { candidates, protected: protectedCount };
  }

  async cleanup(options: { dryRun?: boolean } = {}): Promise<MemoryCleanupResult> {
    const now = Math.floor(Date.now() / 1000);
    const dryRun = options.dryRun ?? true;
    const evaluation = this.evaluate(now);

    if (dryRun) {
      this.recordHistory({
        mode: "dry_run",
        candidates: evaluation.candidates.length,
        archived: 0,
        deleted: 0,
        protected: evaluation.protected,
        reason: "manual dry-run",
      });
      return {
        dryRun,
        candidates: evaluation.candidates,
        archived: 0,
        deleted: 0,
        protected: evaluation.protected,
      };
    }

    const rowsById = new Map(this.getRows().map((row) => [row.id, row]));
    const ids = evaluation.candidates.map((candidate) => candidate.id);
    const archiveRows = ids
      .map((id) => rowsById.get(id))
      .filter((row): row is MemoryRetentionRow => !!row);
    const deleteAfter = now + this.options.archiveDays * SECONDS_PER_DAY;
    const hasKnowledgeVec = this.tableExists("knowledge_vec");

    const archived = this.db.transaction(() => {
      const archive = this.db.prepare(
        `
        INSERT INTO memory_archive (
          memory_id,
          source,
          path,
          text,
          embedding,
          start_line,
          end_line,
          hash,
          original_created_at,
          original_updated_at,
          score,
          score_breakdown,
          archived_at,
          delete_after
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );
      const deleteKnowledge = this.db.prepare(`DELETE FROM knowledge WHERE id = ?`);
      const deleteVector = hasKnowledgeVec
        ? this.db.prepare(`DELETE FROM knowledge_vec WHERE id = ?`)
        : null;

      let count = 0;
      for (const row of archiveRows) {
        archive.run(
          row.id,
          row.source,
          row.path,
          row.text,
          row.embedding,
          row.start_line,
          row.end_line,
          row.hash,
          row.created_at,
          row.updated_at,
          clamp01(row.score ?? 0),
          JSON.stringify({
            recency: row.recency ?? 0,
            frequency: row.frequency ?? 0,
            impact: row.impact ?? 0,
            explicit: row.explicit ?? 0,
            centrality: row.centrality ?? 0,
            accessCount: row.access_count ?? 0,
            impactCount: row.impact_count ?? 0,
            reasons:
              evaluation.candidates.find((candidate) => candidate.id === row.id)?.reasons ?? [],
          }),
          now,
          deleteAfter
        );
        deleteVector?.run(row.id);
        deleteKnowledge.run(row.id);
        count++;
      }
      return count;
    })();

    if (archived > 0 && this.vectorStore?.isConfigured) {
      try {
        await this.vectorStore.delete(ids);
      } catch (error) {
        log.warn({ err: error }, "Semantic vector cleanup failed after memory archive");
      }
    }

    const deleted = this.pruneExpiredArchive(now);
    this.recordHistory({
      mode: "archive",
      candidates: evaluation.candidates.length,
      archived,
      deleted,
      protected: evaluation.protected,
      reason: "manual cleanup",
    });

    return {
      dryRun,
      candidates: evaluation.candidates,
      archived,
      deleted,
      protected: evaluation.protected,
    };
  }

  getAtRisk(limit = 20, now = Math.floor(Date.now() / 1000)): MemoryAtRiskEntry[] {
    this.scorer.recalculateAll(now);
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.getRows();
    const overflowIds = this.getOverflowIds(rows);
    const atRisk: MemoryAtRiskEntry[] = [];

    for (const row of rows) {
      if (this.isProtected(row)) continue;
      const score = clamp01(row.score ?? 0);
      const ageDays = Math.max(0, (now - row.updated_at) / SECONDS_PER_DAY);
      const reasons = this.getCandidateReasons(row, overflowIds, now);
      if (reasons.length === 0) {
        if (score <= this.options.minScore + 0.15) reasons.push("near_min_score");
        if (ageDays >= this.options.maxAgeDays * 0.8) reasons.push("near_max_age");
      }
      if (reasons.length === 0) continue;

      atRisk.push({
        id: row.id,
        text: row.text,
        source: row.source,
        path: row.path,
        score,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ageDays,
        reasons,
      });
    }

    return atRisk.sort((a, b) => a.score - b.score || b.ageDays - a.ageDays).slice(0, safeLimit);
  }

  getArchiveStats(now = Math.floor(Date.now() / 1000)): MemoryArchiveStats {
    const row = this.db
      .prepare(
        `
        SELECT
          COUNT(*) as archived,
          SUM(CASE WHEN delete_after <= ? THEN 1 ELSE 0 END) as pending_deletion,
          MIN(archived_at) as oldest_archived_at
        FROM memory_archive
      `
      )
      .get(now) as {
      archived: number;
      pending_deletion: number | null;
      oldest_archived_at: number | null;
    };

    return {
      archived: row.archived,
      pendingDeletion: row.pending_deletion ?? 0,
      oldestArchivedAt: row.oldest_archived_at,
    };
  }

  getCleanupHistory(limit = 20): MemoryCleanupHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM memory_cleanup_history
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
      )
      .all(safeLimit) as CleanupHistoryRow[];
    return rows.map(rowToHistory);
  }

  pruneExpiredArchive(now = Math.floor(Date.now() / 1000)): number {
    const result = this.db.prepare(`DELETE FROM memory_archive WHERE delete_after <= ?`).run(now);
    const deleted = result.changes;
    if (deleted > 0) {
      this.recordHistory({
        mode: "prune_archive",
        candidates: 0,
        archived: 0,
        deleted,
        protected: 0,
        reason: "archive retention expired",
      });
    }
    return deleted;
  }

  private getRows(): MemoryRetentionRow[] {
    return this.db
      .prepare(
        `
        SELECT
          k.id,
          k.source,
          k.path,
          k.text,
          k.embedding,
          k.start_line,
          k.end_line,
          k.hash,
          k.created_at,
          k.updated_at,
          ms.score,
          ms.recency,
          ms.frequency,
          ms.impact,
          ms.explicit,
          ms.centrality,
          ms.access_count,
          ms.impact_count,
          ms.pinned
        FROM knowledge k
        LEFT JOIN memory_scores ms ON ms.memory_id = k.id
      `
      )
      .all() as MemoryRetentionRow[];
  }

  private getCandidateReasons(
    row: MemoryRetentionRow,
    overflowIds: Set<string>,
    now: number
  ): string[] {
    const reasons: string[] = [];
    const score = clamp01(row.score ?? 0);
    const ageDays = Math.max(0, (now - row.updated_at) / SECONDS_PER_DAY);

    if (score < this.options.minScore) reasons.push("score_below_threshold");
    if (ageDays > this.options.maxAgeDays) reasons.push("max_age_exceeded");
    if (overflowIds.has(row.id)) reasons.push("max_entries_exceeded");

    return reasons;
  }

  private getOverflowIds(rows: MemoryRetentionRow[]): Set<string> {
    if (rows.length <= this.options.maxEntries) return new Set();
    const sorted = [...rows].sort(
      (a, b) =>
        Number(this.isProtected(b)) - Number(this.isProtected(a)) ||
        clamp01(b.score ?? 0) - clamp01(a.score ?? 0) ||
        b.updated_at - a.updated_at
    );
    return new Set(sorted.slice(this.options.maxEntries).map((row) => row.id));
  }

  private isProtected(row: MemoryRetentionRow): boolean {
    return row.pinned === 1 || (row.explicit ?? 0) >= 1;
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) as { name: string } | undefined;
    return !!row;
  }

  private recordHistory(input: {
    mode: MemoryCleanupHistoryEntry["mode"];
    candidates: number;
    archived: number;
    deleted: number;
    protected: number;
    reason: string;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO memory_cleanup_history (
          mode,
          candidates,
          archived,
          deleted,
          protected,
          reason,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      `
      )
      .run(
        input.mode,
        input.candidates,
        input.archived,
        input.deleted,
        input.protected,
        input.reason
      );
  }
}

export function boostMemoryImpact(
  db: Database.Database,
  memoryIds: string[],
  amount = 1
): MemoryScoreRecord[] {
  const scorer = new MemoryScorer(db);
  scorer.boostImpact(memoryIds, amount);
  return memoryIds
    .map((id) => scorer.getScore(id))
    .filter((row): row is MemoryScoreRecord => !!row);
}
