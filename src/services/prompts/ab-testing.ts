import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  assertPromptSection,
  emptyExperimentMetrics,
  parseExperimentMetrics,
  scorePromptMetrics,
  updatePromptMetrics,
  type PromptExperiment,
  type PromptExperimentMetrics,
  type PromptExperimentStatus,
  type PromptMetricInput,
  type PromptSectionId,
  type PromptVariantSelection,
} from "./types.js";
import { ensurePromptSchema, PromptVariantManager } from "./variant-manager.js";

interface PromptExperimentRow {
  id: number;
  section: string;
  name: string;
  control_variant_id: number;
  candidate_variant_id: number;
  traffic_percentage: number;
  min_samples: number;
  auto_promote: number;
  status: PromptExperimentStatus;
  winner_variant_id: number | null;
  metrics_json: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface AssignmentRow {
  variant_id: number;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function clampPercentage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(99, Math.round(value ?? 20)));
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value ?? fallback));
}

function stableBucket(input: string): number {
  const hash = createHash("sha256").update(input).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % 100;
}

export function ensurePromptExperimentSchema(db: Database): void {
  ensurePromptSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_experiments (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      section              TEXT NOT NULL,
      name                 TEXT NOT NULL,
      control_variant_id   INTEGER NOT NULL REFERENCES prompt_variants(id) ON DELETE CASCADE,
      candidate_variant_id INTEGER NOT NULL REFERENCES prompt_variants(id) ON DELETE CASCADE,
      traffic_percentage   INTEGER NOT NULL DEFAULT 20,
      min_samples          INTEGER NOT NULL DEFAULT 50,
      auto_promote         INTEGER NOT NULL DEFAULT 1 CHECK(auto_promote IN (0, 1)),
      status               TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'running', 'completed', 'cancelled')),
      winner_variant_id    INTEGER REFERENCES prompt_variants(id) ON DELETE SET NULL,
      metrics_json         TEXT NOT NULL DEFAULT '{}',
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at         INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_experiments_section_status
      ON prompt_experiments(section, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_experiment_assignments (
      experiment_id INTEGER NOT NULL REFERENCES prompt_experiments(id) ON DELETE CASCADE,
      subject_key   TEXT NOT NULL,
      variant_id    INTEGER NOT NULL REFERENCES prompt_variants(id) ON DELETE CASCADE,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (experiment_id, subject_key)
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_experiment_assignments_variant
      ON prompt_experiment_assignments(variant_id);
  `);
}

export class PromptABTesting {
  private db: Database;
  private variants: PromptVariantManager;

  constructor(db: Database, variants = new PromptVariantManager(db)) {
    this.db = db;
    this.variants = variants;
    ensurePromptExperimentSchema(db);
  }

  createExperiment(input: {
    section: PromptSectionId;
    name?: string;
    controlVariantId: number;
    candidateVariantId: number;
    trafficPercentage?: number;
    minSamples?: number;
    autoPromote?: boolean;
  }): PromptExperiment {
    assertPromptSection(input.section);
    const control = this.variants.getVariant(input.controlVariantId);
    const candidate = this.variants.getVariant(input.candidateVariantId);
    if (!control || !candidate) throw new Error("Both experiment variants must exist");
    if (control.section !== input.section || candidate.section !== input.section) {
      throw new Error("Experiment variants must belong to the requested section");
    }
    if (control.id === candidate.id) {
      throw new Error("Experiment variants must be different");
    }

    const timestamp = nowUnix();
    const name = input.name?.trim() || `${input.section} experiment`;
    const result = this.db
      .prepare(
        `INSERT INTO prompt_experiments
           (section, name, control_variant_id, candidate_variant_id, traffic_percentage,
            min_samples, auto_promote, status, metrics_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .run(
        input.section,
        name,
        control.id,
        candidate.id,
        clampPercentage(input.trafficPercentage),
        positiveInt(input.minSamples, 50),
        input.autoPromote === false ? 0 : 1,
        JSON.stringify(emptyExperimentMetrics()),
        timestamp,
        timestamp
      );

    const experiment = this.getExperiment(Number(result.lastInsertRowid));
    if (!experiment) throw new Error("Experiment not found after create");
    return experiment;
  }

  listExperiments(section?: PromptSectionId): PromptExperiment[] {
    const rows = section
      ? (this.db
          .prepare(
            `SELECT * FROM prompt_experiments
             WHERE section = ?
             ORDER BY created_at DESC, id DESC`
          )
          .all(section) as PromptExperimentRow[])
      : (this.db
          .prepare(`SELECT * FROM prompt_experiments ORDER BY created_at DESC, id DESC`)
          .all() as PromptExperimentRow[]);
    return rows.map((row) => this.rowToExperiment(row));
  }

  getExperiment(id: number): PromptExperiment | null {
    const row = this.db.prepare(`SELECT * FROM prompt_experiments WHERE id = ?`).get(id) as
      | PromptExperimentRow
      | undefined;
    return row ? this.rowToExperiment(row) : null;
  }

  startExperiment(id: number): PromptExperiment {
    const experiment = this.getExperiment(id);
    if (!experiment) throw new Error("Experiment not found");
    if (experiment.status !== "draft") {
      throw new Error("Only draft experiments can be started");
    }
    const timestamp = nowUnix();
    this.db
      .prepare(`UPDATE prompt_experiments SET status = 'running', updated_at = ? WHERE id = ?`)
      .run(timestamp, id);
    const started = this.getExperiment(id);
    if (!started) throw new Error("Experiment not found after start");
    return started;
  }

  selectVariant(input: { section: PromptSectionId; subjectKey: string }): PromptVariantSelection {
    assertPromptSection(input.section);
    const experiment = this.getRunningExperiment(input.section);
    if (!experiment) {
      const active = this.variants.getActiveVariant(input.section);
      if (!active) throw new Error(`No active prompt variant for section: ${input.section}`);
      return { section: input.section, variant: active, experiment: null };
    }

    const existing = this.db
      .prepare(
        `SELECT variant_id FROM prompt_experiment_assignments
         WHERE experiment_id = ? AND subject_key = ?`
      )
      .get(experiment.id, input.subjectKey) as AssignmentRow | undefined;
    const variantId =
      existing?.variant_id ??
      (stableBucket(`${experiment.id}:${input.subjectKey}`) < experiment.trafficPercentage
        ? experiment.candidateVariantId
        : experiment.controlVariantId);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO prompt_experiment_assignments
             (experiment_id, subject_key, variant_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(experiment.id, input.subjectKey, variantId, nowUnix());
    }

    const variant = this.variants.getVariant(variantId);
    if (!variant) throw new Error("Assigned prompt variant not found");
    return { section: input.section, variant, experiment };
  }

  recordOutcome(
    input: {
      experimentId: number;
      variantId: number;
    } & PromptMetricInput
  ): PromptExperiment {
    const experiment = this.getExperiment(input.experimentId);
    if (!experiment) throw new Error("Experiment not found");
    if (experiment.status !== "running") {
      throw new Error("Experiment is not running");
    }
    if (
      input.variantId !== experiment.controlVariantId &&
      input.variantId !== experiment.candidateVariantId
    ) {
      throw new Error("Variant is not part of the experiment");
    }

    this.variants.recordMetrics(input.variantId, input);
    const metrics = this.updateExperimentMetrics(experiment.metrics, input.variantId, input);
    const evaluated = this.evaluateWinner(experiment, metrics);
    const timestamp = nowUnix();

    this.db
      .prepare(
        `UPDATE prompt_experiments
         SET metrics_json = ?,
             status = ?,
             winner_variant_id = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(metrics),
        evaluated.status,
        evaluated.winnerVariantId,
        timestamp,
        evaluated.completedAt,
        experiment.id
      );

    if (
      evaluated.status === "completed" &&
      evaluated.winnerVariantId !== null &&
      experiment.autoPromote
    ) {
      this.variants.activateVariant(experiment.section, evaluated.winnerVariantId);
    }

    const updated = this.getExperiment(experiment.id);
    if (!updated) throw new Error("Experiment not found after outcome update");
    return updated;
  }

  private getRunningExperiment(section: PromptSectionId): PromptExperiment | null {
    const row = this.db
      .prepare(
        `SELECT * FROM prompt_experiments
         WHERE section = ? AND status = 'running'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(section) as PromptExperimentRow | undefined;
    return row ? this.rowToExperiment(row) : null;
  }

  private updateExperimentMetrics(
    metrics: PromptExperimentMetrics,
    variantId: number,
    input: PromptMetricInput
  ): PromptExperimentMetrics {
    const key = String(variantId);
    const updatedMetrics = updatePromptMetrics(
      metrics.variants[key] ?? {
        interactions: 0,
        positive: 0,
        negative: 0,
        averageRating: null,
        taskSuccessRate: null,
        responseQualityScore: null,
        averageTokenUsage: null,
        errorRate: null,
        lastUpdated: null,
      },
      input
    );

    return {
      variants: { ...metrics.variants, [key]: updatedMetrics },
      scores: { ...metrics.scores, [key]: scorePromptMetrics(updatedMetrics) },
      sampleCounts: { ...metrics.sampleCounts, [key]: updatedMetrics.interactions },
      significance: metrics.significance,
      lastUpdated: updatedMetrics.lastUpdated,
    };
  }

  private evaluateWinner(
    experiment: PromptExperiment,
    metrics: PromptExperimentMetrics
  ): {
    status: PromptExperimentStatus;
    winnerVariantId: number | null;
    completedAt: number | null;
  } {
    const controlKey = String(experiment.controlVariantId);
    const candidateKey = String(experiment.candidateVariantId);
    const controlSamples = metrics.sampleCounts[controlKey] ?? 0;
    const candidateSamples = metrics.sampleCounts[candidateKey] ?? 0;

    if (controlSamples < experiment.minSamples || candidateSamples < experiment.minSamples) {
      return {
        status: experiment.status,
        winnerVariantId: experiment.winnerVariantId,
        completedAt: experiment.completedAt,
      };
    }

    const controlScore = metrics.scores[controlKey] ?? 0.5;
    const candidateScore = metrics.scores[candidateKey] ?? 0.5;
    const gap = Math.abs(candidateScore - controlScore);
    metrics.significance = gap;

    if (gap < 0.02) {
      return {
        status: experiment.status,
        winnerVariantId: experiment.winnerVariantId,
        completedAt: experiment.completedAt,
      };
    }

    return {
      status: "completed",
      winnerVariantId:
        candidateScore > controlScore ? experiment.candidateVariantId : experiment.controlVariantId,
      completedAt: nowUnix(),
    };
  }

  private rowToExperiment(row: PromptExperimentRow): PromptExperiment {
    assertPromptSection(row.section);
    return {
      id: row.id,
      section: row.section,
      name: row.name,
      controlVariantId: row.control_variant_id,
      candidateVariantId: row.candidate_variant_id,
      trafficPercentage: row.traffic_percentage,
      minSamples: row.min_samples,
      autoPromote: row.auto_promote === 1,
      status: row.status,
      winnerVariantId: row.winner_variant_id,
      metrics: parseExperimentMetrics(row.metrics_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }
}
