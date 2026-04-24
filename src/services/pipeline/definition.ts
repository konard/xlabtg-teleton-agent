import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolvePipelineSteps } from "./resolver.js";

export const PIPELINE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const PIPELINE_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;

export const PIPELINE_ERROR_STRATEGIES = ["fail_fast", "continue", "retry"] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
export type PipelineStepStatus = (typeof PIPELINE_STEP_STATUSES)[number];
export type PipelineErrorStrategy = (typeof PIPELINE_ERROR_STRATEGIES)[number];
export type PipelineContext = Record<string, unknown>;

export interface PipelineStep {
  id: string;
  agent: string;
  action: string;
  output: string;
  dependsOn: string[];
  errorStrategy?: PipelineErrorStrategy;
  retryCount?: number;
  timeoutSeconds?: number;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  steps: PipelineStep[];
  errorStrategy: PipelineErrorStrategy;
  maxRetries: number;
  timeoutSeconds: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: PipelineStatus;
  errorStrategy: PipelineErrorStrategy;
  inputContext: PipelineContext;
  context: PipelineContext;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface PipelineRunStep {
  runId: string;
  pipelineId: string;
  stepId: string;
  agent: string;
  action: string;
  output: string;
  dependsOn: string[];
  status: PipelineStepStatus;
  inputContext: PipelineContext | null;
  outputValue: unknown;
  error: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface PipelineRunDetail {
  run: PipelineRun;
  steps: PipelineRunStep[];
}

interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  steps: string;
  error_strategy: string;
  max_retries: number;
  timeout_seconds: number | null;
  created_at: number;
  updated_at: number;
}

interface PipelineRunRow {
  id: string;
  pipeline_id: string;
  status: string;
  error_strategy: string;
  input_context: string;
  context: string;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

interface PipelineRunStepRow {
  run_id: string;
  pipeline_id: string;
  step_id: string;
  agent: string;
  action: string;
  output_name: string;
  depends_on: string;
  status: string;
  input_context: string | null;
  output_value: string | null;
  error: string | null;
  attempts: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

interface PipelineStepInput {
  id?: unknown;
  agent?: unknown;
  action?: unknown;
  output?: unknown;
  dependsOn?: unknown;
  depends_on?: unknown;
  errorStrategy?: unknown;
  error_strategy?: unknown;
  retryCount?: unknown;
  retry_count?: unknown;
  timeoutSeconds?: unknown;
  timeout_seconds?: unknown;
}

const MAX_STEPS = 20;
const MAX_STEP_ACTION_LENGTH = 4_000;
const MAX_STEP_ID_LENGTH = 80;
const MAX_OUTPUT_LENGTH = 80;
const STEP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const OUTPUT_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function parseJsonObject(value: string): PipelineContext {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as PipelineContext)
    : {};
}

function parseJsonValue(value: string | null): unknown {
  if (value === null) return null;
  return JSON.parse(value) as unknown;
}

function isErrorStrategy(value: unknown): value is PipelineErrorStrategy {
  return PIPELINE_ERROR_STRATEGIES.includes(value as PipelineErrorStrategy);
}

function isStatus(value: string): value is PipelineStatus {
  return PIPELINE_STATUSES.includes(value as PipelineStatus);
}

function isStepStatus(value: string): value is PipelineStepStatus {
  return PIPELINE_STEP_STATUSES.includes(value as PipelineStepStatus);
}

function stringValue(value: unknown, field: string, options: { max: number }): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  if (trimmed.length > options.max) {
    throw new Error(`${field} cannot exceed ${options.max} characters`);
  }
  return trimmed;
}

function stringArrayValue(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function optionalNonNegativeInt(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${field} must be an integer between 0 and ${max}`);
  }
  return parsed;
}

function optionalPositiveInt(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${field} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function normalizePipelineStep(input: PipelineStepInput, index: number): PipelineStep {
  const prefix = `steps[${index}]`;
  const id = stringValue(input.id, `${prefix}.id`, { max: MAX_STEP_ID_LENGTH });
  if (!STEP_ID_PATTERN.test(id)) {
    throw new Error(
      `${prefix}.id must start with a letter and contain only letters, numbers, _ or -`
    );
  }

  const output = stringValue(input.output ?? id, `${prefix}.output`, {
    max: MAX_OUTPUT_LENGTH,
  });
  if (!OUTPUT_PATTERN.test(output)) {
    throw new Error(`${prefix}.output must be a valid variable name`);
  }

  const errorStrategy = input.errorStrategy ?? input.error_strategy;
  if (errorStrategy !== undefined && !isErrorStrategy(errorStrategy)) {
    throw new Error(
      `${prefix}.errorStrategy must be one of: ${PIPELINE_ERROR_STRATEGIES.join(", ")}`
    );
  }
  const retryCount = optionalNonNegativeInt(
    input.retryCount ?? input.retry_count,
    `${prefix}.retryCount`,
    10
  );
  const timeoutSeconds = optionalPositiveInt(
    input.timeoutSeconds ?? input.timeout_seconds,
    `${prefix}.timeoutSeconds`,
    86_400
  );

  return {
    id,
    agent: stringValue(input.agent ?? "primary", `${prefix}.agent`, { max: 120 }),
    action: stringValue(input.action, `${prefix}.action`, { max: MAX_STEP_ACTION_LENGTH }),
    output,
    dependsOn: stringArrayValue(input.dependsOn ?? input.depends_on, `${prefix}.dependsOn`),
    ...(isErrorStrategy(errorStrategy) ? { errorStrategy } : {}),
    ...(retryCount !== undefined ? { retryCount } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
  };
}

export function normalizePipelineSteps(input: unknown): PipelineStep[] {
  if (!Array.isArray(input)) {
    throw new Error("steps must be an array");
  }
  if (input.length === 0) {
    throw new Error("steps must include at least one step");
  }
  if (input.length > MAX_STEPS) {
    throw new Error(`pipelines support at most ${MAX_STEPS} steps`);
  }

  const steps = input.map((step, index) =>
    normalizePipelineStep((step ?? {}) as PipelineStepInput, index)
  );
  resolvePipelineSteps(steps);
  return steps;
}

function rowToPipeline(row: PipelineRow): PipelineDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    steps: normalizePipelineSteps(JSON.parse(row.steps) as unknown),
    errorStrategy: isErrorStrategy(row.error_strategy) ? row.error_strategy : "fail_fast",
    maxRetries: row.max_retries,
    timeoutSeconds: row.timeout_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: PipelineRunRow): PipelineRun {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: isStatus(row.status) ? row.status : "failed",
    errorStrategy: isErrorStrategy(row.error_strategy) ? row.error_strategy : "fail_fast",
    inputContext: parseJsonObject(row.input_context),
    context: parseJsonObject(row.context),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function rowToRunStep(row: PipelineRunStepRow): PipelineRunStep {
  return {
    runId: row.run_id,
    pipelineId: row.pipeline_id,
    stepId: row.step_id,
    agent: row.agent,
    action: row.action,
    output: row.output_name,
    dependsOn: JSON.parse(row.depends_on) as string[],
    status: isStepStatus(row.status) ? row.status : "failed",
    inputContext: row.input_context ? parseJsonObject(row.input_context) : null,
    outputValue: parseJsonValue(row.output_value),
    error: row.error,
    attempts: row.attempts,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export function ensurePipelineTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      error_strategy TEXT NOT NULL DEFAULT 'fail_fast'
        CHECK(error_strategy IN ('fail_fast', 'continue', 'retry')),
      max_retries INTEGER NOT NULL DEFAULT 0 CHECK(max_retries >= 0),
      timeout_seconds INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_pipelines_enabled ON pipelines(enabled);
    CREATE INDEX IF NOT EXISTS idx_pipelines_created ON pipelines(created_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      error_strategy TEXT NOT NULL DEFAULT 'fail_fast'
        CHECK(error_strategy IN ('fail_fast', 'continue', 'retry')),
      input_context TEXT NOT NULL DEFAULT '{}',
      context TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

    CREATE TABLE IF NOT EXISTS pipeline_run_steps (
      run_id TEXT NOT NULL,
      pipeline_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      output_name TEXT NOT NULL,
      depends_on TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
      input_context TEXT,
      output_value TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (run_id, step_id),
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run ON pipeline_run_steps(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_pipeline ON pipeline_run_steps(pipeline_id);
  `);
}

export class PipelineStore {
  constructor(private db: Database.Database) {}

  list(): PipelineDefinition[] {
    const rows = this.db
      .prepare("SELECT * FROM pipelines ORDER BY created_at DESC")
      .all() as PipelineRow[];
    return rows.map(rowToPipeline);
  }

  get(id: string): PipelineDefinition | null {
    const row = this.db.prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as
      | PipelineRow
      | undefined;
    return row ? rowToPipeline(row) : null;
  }

  create(data: {
    name: string;
    description?: string | null;
    enabled?: boolean;
    steps: unknown;
    errorStrategy?: PipelineErrorStrategy;
    maxRetries?: number;
    timeoutSeconds?: number | null;
  }): PipelineDefinition {
    const id = randomUUID();
    const now = nowSeconds();
    const steps = normalizePipelineSteps(data.steps);
    const errorStrategy = data.errorStrategy ?? "fail_fast";
    if (!isErrorStrategy(errorStrategy)) {
      throw new Error(`errorStrategy must be one of: ${PIPELINE_ERROR_STRATEGIES.join(", ")}`);
    }
    this.db
      .prepare(
        `INSERT INTO pipelines (
          id, name, description, steps, enabled, error_strategy,
          max_retries, timeout_seconds, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        data.description ?? null,
        JSON.stringify(steps),
        data.enabled !== false ? 1 : 0,
        errorStrategy,
        data.maxRetries ?? 0,
        data.timeoutSeconds ?? null,
        now,
        now
      );
    const created = this.get(id);
    if (!created) throw new Error(`Pipeline ${id} not found after insert`);
    return created;
  }

  update(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      steps: unknown;
      errorStrategy: PipelineErrorStrategy;
      maxRetries: number;
      timeoutSeconds: number | null;
    }>
  ): PipelineDefinition | null {
    const existing = this.get(id);
    if (!existing) return null;
    const now = nowSeconds();
    const steps = data.steps !== undefined ? normalizePipelineSteps(data.steps) : existing.steps;
    const errorStrategy = data.errorStrategy ?? existing.errorStrategy;
    if (!isErrorStrategy(errorStrategy)) {
      throw new Error(`errorStrategy must be one of: ${PIPELINE_ERROR_STRATEGIES.join(", ")}`);
    }
    this.db
      .prepare(
        `UPDATE pipelines SET
          name = ?,
          description = ?,
          enabled = ?,
          steps = ?,
          error_strategy = ?,
          max_retries = ?,
          timeout_seconds = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        data.name ?? existing.name,
        data.description !== undefined ? data.description : existing.description,
        data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
        JSON.stringify(steps),
        errorStrategy,
        data.maxRetries ?? existing.maxRetries,
        data.timeoutSeconds !== undefined ? data.timeoutSeconds : existing.timeoutSeconds,
        now,
        id
      );
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM pipelines WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createRun(
    pipeline: PipelineDefinition,
    options: {
      inputContext?: PipelineContext;
      errorStrategy?: PipelineErrorStrategy;
    } = {}
  ): PipelineRun {
    const id = randomUUID();
    const now = nowSeconds();
    const context = options.inputContext ?? {};
    const errorStrategy = options.errorStrategy ?? pipeline.errorStrategy;
    if (!isErrorStrategy(errorStrategy)) {
      throw new Error(`errorStrategy must be one of: ${PIPELINE_ERROR_STRATEGIES.join(", ")}`);
    }

    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO pipeline_runs (
            id, pipeline_id, status, error_strategy, input_context,
            context, created_at, updated_at
          ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          pipeline.id,
          errorStrategy,
          JSON.stringify(context),
          JSON.stringify(context),
          now,
          now
        );

      const insertStep = this.db.prepare(
        `INSERT INTO pipeline_run_steps (
          run_id, pipeline_id, step_id, agent, action, output_name,
          depends_on, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      );
      for (const step of pipeline.steps) {
        insertStep.run(
          id,
          pipeline.id,
          step.id,
          step.agent,
          step.action,
          step.output,
          JSON.stringify(step.dependsOn),
          now
        );
      }
    });

    create();
    const run = this.getRun(id);
    if (!run) throw new Error(`Pipeline run ${id} not found after insert`);
    return run;
  }

  listRuns(pipelineId: string, limit = 50): PipelineRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pipeline_runs
         WHERE pipeline_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(pipelineId, Math.max(1, Math.min(limit, 200))) as PipelineRunRow[];
    return rows.map(rowToRun);
  }

  getRun(runId: string): PipelineRun | null {
    const row = this.db.prepare("SELECT * FROM pipeline_runs WHERE id = ?").get(runId) as
      | PipelineRunRow
      | undefined;
    return row ? rowToRun(row) : null;
  }

  getRunDetail(pipelineId: string, runId: string): PipelineRunDetail | null {
    const run = this.getRun(runId);
    if (!run || run.pipelineId !== pipelineId) return null;
    return {
      run,
      steps: this.getRunSteps(runId),
    };
  }

  getRunSteps(runId: string): PipelineRunStep[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pipeline_run_steps
         WHERE run_id = ?
         ORDER BY rowid ASC`
      )
      .all(runId) as PipelineRunStepRow[];
    return rows.map(rowToRunStep);
  }

  updateRun(
    runId: string,
    data: Partial<{
      status: PipelineStatus;
      context: PipelineContext;
      error: string | null;
      startedAt: number | null;
      completedAt: number | null;
    }>
  ): PipelineRun | null {
    const existing = this.getRun(runId);
    if (!existing) return null;
    const now = nowSeconds();
    this.db
      .prepare(
        `UPDATE pipeline_runs SET
          status = ?,
          context = ?,
          error = ?,
          started_at = ?,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        data.status ?? existing.status,
        JSON.stringify(data.context ?? existing.context),
        data.error !== undefined ? data.error : existing.error,
        data.startedAt !== undefined ? data.startedAt : existing.startedAt,
        data.completedAt !== undefined ? data.completedAt : existing.completedAt,
        now,
        runId
      );
    return this.getRun(runId);
  }

  updateStep(
    runId: string,
    stepId: string,
    data: Partial<{
      status: PipelineStepStatus;
      inputContext: PipelineContext | null;
      outputValue: unknown;
      error: string | null;
      attempts: number;
      startedAt: number | null;
      completedAt: number | null;
    }>
  ): PipelineRunStep | null {
    const existing = this.getRunSteps(runId).find((step) => step.stepId === stepId);
    if (!existing) return null;
    const now = nowSeconds();
    this.db
      .prepare(
        `UPDATE pipeline_run_steps SET
          status = ?,
          input_context = ?,
          output_value = ?,
          error = ?,
          attempts = ?,
          started_at = ?,
          completed_at = ?,
          updated_at = ?
        WHERE run_id = ? AND step_id = ?`
      )
      .run(
        data.status ?? existing.status,
        data.inputContext !== undefined
          ? data.inputContext === null
            ? null
            : JSON.stringify(data.inputContext)
          : existing.inputContext === null
            ? null
            : JSON.stringify(existing.inputContext),
        data.outputValue !== undefined
          ? JSON.stringify(data.outputValue)
          : JSON.stringify(existing.outputValue),
        data.error !== undefined ? data.error : existing.error,
        data.attempts ?? existing.attempts,
        data.startedAt !== undefined ? data.startedAt : existing.startedAt,
        data.completedAt !== undefined ? data.completedAt : existing.completedAt,
        now,
        runId,
        stepId
      );
    return this.getRunSteps(runId).find((step) => step.stepId === stepId) ?? null;
  }

  cancelRun(pipelineId: string, runId: string): PipelineRun | null {
    const run = this.getRun(runId);
    if (!run || run.pipelineId !== pipelineId) return null;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return run;
    }
    const now = nowSeconds();
    const cancel = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE pipeline_runs SET status = 'cancelled', completed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, runId);
      this.db
        .prepare(
          `UPDATE pipeline_run_steps
           SET status = 'cancelled', error = COALESCE(error, 'Pipeline run cancelled'), updated_at = ?
           WHERE run_id = ? AND status IN ('pending', 'running')`
        )
        .run(now, runId);
    });
    cancel();
    return this.getRun(runId);
  }

  markPendingStepsSkipped(runId: string, reason: string): void {
    const now = nowSeconds();
    this.db
      .prepare(
        `UPDATE pipeline_run_steps
         SET status = 'skipped', error = ?, completed_at = ?, updated_at = ?
         WHERE run_id = ? AND status = 'pending'`
      )
      .run(reason, now, now, runId);
  }
}

export function getPipelineStore(db: Database.Database): PipelineStore {
  return new PipelineStore(db);
}
