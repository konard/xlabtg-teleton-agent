import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import type { SemanticVectorStore } from "./vector-store.js";
import { MemoryScorer, type MemoryScoringConfig } from "./scoring.js";
import { MemoryRetentionService, type MemoryRetentionConfig } from "./retention.js";
import { getAutonomousTaskStore } from "./agent/autonomous-tasks.js";

const log = createLogger("Memory");

const DEFAULT_CHECKPOINT_RETENTION_DAYS = 7;

export interface MemoryPrioritizationSchedulerConfig {
  enabled?: boolean;
  interval_minutes?: number;
  scoring?: MemoryScoringConfig;
  retention?: MemoryRetentionConfig & {
    auto_cleanup?: boolean;
    checkpoint_retention_days?: number;
  };
}

export class MemoryPrioritizationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private intervalMs: number;
  private enabled: boolean;
  private autoCleanup: boolean;
  private checkpointRetentionDays: number;
  private scorer: MemoryScorer;
  private retention: MemoryRetentionService;
  private db: Database.Database;

  constructor(
    db: Database.Database,
    config: MemoryPrioritizationSchedulerConfig = {},
    vectorStore?: SemanticVectorStore
  ) {
    this.db = db;
    this.enabled = config.enabled ?? true;
    this.intervalMs = Math.max(1, config.interval_minutes ?? 60) * 60_000;
    this.autoCleanup = config.retention?.auto_cleanup ?? false;
    this.checkpointRetentionDays =
      typeof config.retention?.checkpoint_retention_days === "number" &&
      config.retention.checkpoint_retention_days > 0
        ? config.retention.checkpoint_retention_days
        : DEFAULT_CHECKPOINT_RETENTION_DAYS;
    this.scorer = new MemoryScorer(db, config.scoring);
    this.retention = new MemoryRetentionService(db, config.retention, this.scorer, vectorStore);
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        log.warn({ err: error }, "Memory prioritization scheduler failed");
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = this.scorer.recalculateAll();
      if (this.autoCleanup) {
        await this.retention.cleanup({ dryRun: false });
      } else {
        this.retention.pruneExpiredArchive();
      }
      let checkpointsDeleted = 0;
      try {
        checkpointsDeleted = getAutonomousTaskStore(this.db).cleanOldCheckpoints(
          this.checkpointRetentionDays
        );
      } catch (error) {
        log.warn({ err: error }, "Autonomous task checkpoint cleanup failed");
      }
      log.debug(
        { scored: result.scored, autoCleanup: this.autoCleanup, checkpointsDeleted },
        "Memory scores updated"
      );
    } finally {
      this.running = false;
    }
  }
}
