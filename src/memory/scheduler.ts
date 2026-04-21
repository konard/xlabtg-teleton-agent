import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import type { SemanticVectorStore } from "./vector-store.js";
import { MemoryScorer, type MemoryScoringConfig } from "./scoring.js";
import { MemoryRetentionService, type MemoryRetentionConfig } from "./retention.js";

const log = createLogger("Memory");

export interface MemoryPrioritizationSchedulerConfig {
  enabled?: boolean;
  interval_minutes?: number;
  scoring?: MemoryScoringConfig;
  retention?: MemoryRetentionConfig & { auto_cleanup?: boolean };
}

export class MemoryPrioritizationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private intervalMs: number;
  private enabled: boolean;
  private autoCleanup: boolean;
  private scorer: MemoryScorer;
  private retention: MemoryRetentionService;

  constructor(
    db: Database.Database,
    config: MemoryPrioritizationSchedulerConfig = {},
    vectorStore?: SemanticVectorStore
  ) {
    this.enabled = config.enabled ?? true;
    this.intervalMs = Math.max(1, config.interval_minutes ?? 60) * 60_000;
    this.autoCleanup = config.retention?.auto_cleanup ?? false;
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
      log.debug({ scored: result.scored, autoCleanup: this.autoCleanup }, "Memory scores updated");
    } finally {
      this.running = false;
    }
  }
}
