import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { getEventBus } from "./event-bus.js";

const log = createLogger("AnomalyDetector");

export type AnomalyType =
  | "volume_spike"
  | "error_burst"
  | "latency_degradation"
  | "cost_spike"
  | "behavioral_anomaly";

export type AnomalySeverity = "warning" | "critical";

export interface AnomalyAlertingConfig {
  in_app: boolean;
  telegram: boolean;
  telegram_chat_ids: string[];
  webhook_url: string | null;
}

export interface AnomalyDetectionConfig {
  enabled: boolean;
  sensitivity: number;
  baseline_days: number;
  min_samples: number;
  cooldown_minutes: number;
  alerting: AnomalyAlertingConfig;
}

export interface AnomalyBaseline {
  metric: string;
  period: string;
  mean: number;
  stddev: number;
  sampleCount: number;
  updatedAt: number;
  currentValue: number | null;
}

export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  metric: string;
  period: string;
  currentValue: number;
  expectedMin: number;
  expectedMax: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number | null;
  description: string;
  acknowledged: boolean;
  createdAt: number;
  acknowledgedAt: number | null;
}

export interface AnomalyStats {
  total: number;
  warning: number;
  critical: number;
  unacknowledged: number;
  lastDetectedAt: number | null;
  byType: Array<{ type: AnomalyType; count: number }>;
  config: AnomalyDetectionConfig;
}

export interface AlertDispatcher {
  dispatchAnomaly(event: AnomalyEvent): Promise<unknown> | unknown;
}

interface BaselineRow {
  metric: string;
  period: string;
  mean: number;
  stddev: number;
  sample_count: number;
  updated_at: number;
}

interface EventRow {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  metric: string;
  period: string;
  current_value: number;
  expected_min: number;
  expected_max: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number | null;
  description: string;
  acknowledged: number;
  created_at: number;
  acknowledged_at: number | null;
}

interface RequestBucketRow {
  bucket: number;
  total: number;
  errors: number;
  avg_latency: number | null;
  avg_tokens: number | null;
}

interface CostBucketRow {
  bucket: number;
  cost: number;
}

interface ToolBucketRow {
  bucket: number;
  tool: string;
  count: number;
}

interface ToolExecutionBucketRow {
  bucket: number;
  total: number;
  failures: number;
  avg_latency: number | null;
}

interface MetricDetection {
  metric: string;
  type: AnomalyType;
  value: number;
  description: (ctx: DetectionContext) => string;
}

interface DetectionContext {
  metric: string;
  value: number;
  baseline: AnomalyBaseline;
  expectedMin: number;
  expectedMax: number;
  zScore: number | null;
}

interface Comparison {
  isAnomaly: boolean;
  expectedMin: number;
  expectedMax: number;
  zScore: number | null;
  severity: AnomalySeverity;
}

const PERIOD = "hour";
const MAX_Z_SCORE_FOR_STABLE_BASELINE = 999;

export const DEFAULT_ANOMALY_DETECTION_CONFIG: AnomalyDetectionConfig = {
  enabled: true,
  sensitivity: 2.5,
  baseline_days: 7,
  min_samples: 24,
  cooldown_minutes: 15,
  alerting: {
    in_app: true,
    telegram: false,
    telegram_chat_ids: [],
    webhook_url: null,
  },
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function hourBucket(ts: number): number {
  return ts - (ts % 3600);
}

function rowToBaseline(row: BaselineRow, currentValue: number | null): AnomalyBaseline {
  return {
    metric: row.metric,
    period: row.period,
    mean: row.mean,
    stddev: row.stddev,
    sampleCount: row.sample_count,
    updatedAt: row.updated_at,
    currentValue,
  };
}

function rowToEvent(row: EventRow): AnomalyEvent {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    metric: row.metric,
    period: row.period,
    currentValue: row.current_value,
    expectedMin: row.expected_min,
    expectedMax: row.expected_max,
    baselineMean: row.baseline_mean,
    baselineStddev: row.baseline_stddev,
    zScore: row.z_score,
    description: row.description,
    acknowledged: row.acknowledged === 1,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

function summarize(values: number[]): { mean: number; stddev: number; sampleCount: number } {
  const sampleCount = values.length;
  if (sampleCount === 0) return { mean: 0, stddev: 0, sampleCount };

  const mean = values.reduce((sum, value) => sum + value, 0) / sampleCount;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / sampleCount;
  return { mean, stddev: Math.sqrt(variance), sampleCount };
}

function mergeConfig(config: Partial<AnomalyDetectionConfig>): AnomalyDetectionConfig {
  return {
    ...DEFAULT_ANOMALY_DETECTION_CONFIG,
    ...config,
    alerting: {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG.alerting,
      ...(config.alerting ?? {}),
    },
  };
}

function formatMetric(metric: string): string {
  return metric.replace(/^tool_share:/, "tool share:").replace(/_/g, " ");
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

export class AnomalyDetectorService {
  private db: Database;
  private config: AnomalyDetectionConfig;
  private alertDispatcher: AlertDispatcher | null;

  constructor(
    db: Database,
    config: Partial<AnomalyDetectionConfig> = {},
    alertDispatcher: AlertDispatcher | null = null
  ) {
    this.db = db;
    this.config = mergeConfig(config);
    this.alertDispatcher = alertDispatcher;
    this.migrate();
  }

  updateConfig(
    config: Partial<AnomalyDetectionConfig>,
    alertDispatcher: AlertDispatcher | null = this.alertDispatcher
  ): void {
    this.config = mergeConfig(config);
    this.alertDispatcher = alertDispatcher;
  }

  getConfig(): AnomalyDetectionConfig {
    return this.config;
  }

  usesDatabase(db: Database): boolean {
    return this.db === db;
  }

  recordToolExecution(opts: {
    toolName: string;
    durationMs?: number;
    success: boolean;
    errorMessage?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO anomaly_tool_metrics (tool_name, duration_ms, success, error_message)
         VALUES (?, ?, ?, ?)`
      )
      .run(opts.toolName, opts.durationMs ?? null, opts.success ? 1 : 0, opts.errorMessage ?? null);
  }

  refreshBaselines(referenceTime = nowUnix()): AnomalyBaseline[] {
    const samples = this.collectBaselineSamples(referenceTime);
    const updatedAt = nowUnix();

    const update = this.db.prepare(
      `INSERT INTO anomaly_baselines (metric, period, mean, stddev, sample_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric, period) DO UPDATE SET
         mean = excluded.mean,
         stddev = excluded.stddev,
         sample_count = excluded.sample_count,
         updated_at = excluded.updated_at`
    );

    for (const [metric, values] of samples) {
      if (values.length === 0) continue;
      const summary = summarize(values);
      update.run(metric, PERIOD, summary.mean, summary.stddev, summary.sampleCount, updatedAt);
    }

    return this.getBaselines(referenceTime);
  }

  async detectNow(referenceTime = nowUnix()): Promise<AnomalyEvent[]> {
    if (!this.config.enabled) return [];

    this.refreshBaselines(referenceTime);
    const currentValues = this.collectCurrentValues(referenceTime);
    const events: AnomalyEvent[] = [];

    for (const detection of this.getMetricDetections(currentValues)) {
      const baseline = this.getBaseline(detection.metric, referenceTime);
      if (!baseline || baseline.sampleCount < this.config.min_samples) continue;

      const comparison = this.compare(detection.value, baseline);
      if (!comparison.isAnomaly) continue;
      if (this.hasRecentEvent(detection.type, detection.metric)) continue;

      const event = this.insertEvent({
        type: detection.type,
        severity: comparison.severity,
        metric: detection.metric,
        currentValue: detection.value,
        expectedMin: comparison.expectedMin,
        expectedMax: comparison.expectedMax,
        baselineMean: baseline.mean,
        baselineStddev: baseline.stddev,
        zScore: comparison.zScore,
        description: detection.description({
          metric: detection.metric,
          value: detection.value,
          baseline,
          expectedMin: comparison.expectedMin,
          expectedMax: comparison.expectedMax,
          zScore: comparison.zScore,
        }),
      });
      events.push(event);
      this.dispatchAlert(event);
    }

    for (const event of this.detectNewToolPatterns(currentValues, referenceTime)) {
      events.push(event);
      this.dispatchAlert(event);
    }

    return events;
  }

  listEvents(
    filters: {
      periodHours?: number;
      severity?: AnomalySeverity;
      acknowledged?: boolean;
    } = {}
  ): AnomalyEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.periodHours) {
      clauses.push("created_at >= ?");
      params.push(nowUnix() - filters.periodHours * 3600);
    }
    if (filters.severity) {
      clauses.push("severity = ?");
      params.push(filters.severity);
    }
    if (filters.acknowledged !== undefined) {
      clauses.push("acknowledged = ?");
      params.push(filters.acknowledged ? 1 : 0);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM anomaly_events ${where} ORDER BY created_at DESC, id DESC`)
      .all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  getBaselines(referenceTime = nowUnix()): AnomalyBaseline[] {
    const currentValues = this.collectCurrentValues(referenceTime);
    const rows = this.db
      .prepare("SELECT * FROM anomaly_baselines ORDER BY metric ASC")
      .all() as BaselineRow[];
    return rows.map((row) => rowToBaseline(row, currentValues.get(row.metric) ?? null));
  }

  acknowledge(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE anomaly_events
         SET acknowledged = 1, acknowledged_at = ?
         WHERE id = ?`
      )
      .run(nowUnix(), id);
    return result.changes > 0;
  }

  getEvent(id: string): AnomalyEvent | null {
    const row = this.db.prepare("SELECT * FROM anomaly_events WHERE id = ?").get(id) as
      | EventRow
      | undefined;
    return row ? rowToEvent(row) : null;
  }

  getStats(periodHours = 24): AnomalyStats {
    const since = nowUnix() - periodHours * 3600;
    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning,
           SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
           SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END) AS unacknowledged,
           MAX(created_at) AS last_detected_at
         FROM anomaly_events
         WHERE created_at >= ?`
      )
      .get(since) as {
      total: number;
      warning: number | null;
      critical: number | null;
      unacknowledged: number | null;
      last_detected_at: number | null;
    };

    const byTypeRows = this.db
      .prepare(
        `SELECT type, COUNT(*) AS count
         FROM anomaly_events
         WHERE created_at >= ?
         GROUP BY type
         ORDER BY count DESC`
      )
      .all(since) as Array<{ type: AnomalyType; count: number }>;

    return {
      total: totals.total,
      warning: totals.warning ?? 0,
      critical: totals.critical ?? 0,
      unacknowledged: totals.unacknowledged ?? 0,
      lastDetectedAt: totals.last_detected_at,
      byType: byTypeRows,
      config: this.config,
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS anomaly_baselines (
        metric       TEXT NOT NULL,
        mean         REAL NOT NULL,
        stddev       REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        period       TEXT NOT NULL,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (metric, period)
      );

      CREATE TABLE IF NOT EXISTS anomaly_events (
        id                 TEXT PRIMARY KEY,
        type               TEXT NOT NULL CHECK(type IN (
          'volume_spike',
          'error_burst',
          'latency_degradation',
          'cost_spike',
          'behavioral_anomaly'
        )),
        severity           TEXT NOT NULL CHECK(severity IN ('warning', 'critical')),
        metric             TEXT NOT NULL,
        period             TEXT NOT NULL,
        current_value      REAL NOT NULL,
        expected_min       REAL NOT NULL,
        expected_max       REAL NOT NULL,
        baseline_mean      REAL NOT NULL,
        baseline_stddev    REAL NOT NULL,
        z_score            REAL,
        description        TEXT NOT NULL,
        acknowledged       INTEGER NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
        acknowledged_at    INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_anomaly_events_created_at
        ON anomaly_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_anomaly_events_severity
        ON anomaly_events(severity, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_anomaly_events_type_metric
        ON anomaly_events(type, metric, created_at DESC);

      CREATE TABLE IF NOT EXISTS anomaly_tool_metrics (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name     TEXT NOT NULL,
        duration_ms   INTEGER,
        success       INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_anomaly_tool_metrics_created_at
        ON anomaly_tool_metrics(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_anomaly_tool_metrics_tool
        ON anomaly_tool_metrics(tool_name, created_at DESC);
    `);
  }

  private collectBaselineSamples(referenceTime: number): Map<string, number[]> {
    const currentBucket = hourBucket(referenceTime);
    const startBucket = currentBucket - this.config.baseline_days * 24 * 3600;
    const buckets = this.bucketRange(startBucket, currentBucket);
    const samples = new Map<string, number[]>();

    const requestBuckets = new Map<number, RequestBucketRow>();
    for (const row of this.getRequestBuckets(startBucket, currentBucket)) {
      requestBuckets.set(row.bucket, row);
    }

    const activeRequestRows = buckets
      .map((bucket) => requestBuckets.get(bucket))
      .filter((row): row is RequestBucketRow => !!row && row.total > 0);
    this.setSamples(
      samples,
      "requests_per_hour",
      activeRequestRows.map((row) => row.total)
    );
    this.setSamples(
      samples,
      "error_rate",
      activeRequestRows.map((row) => row.errors / row.total)
    );
    this.setSamples(
      samples,
      "avg_latency_ms",
      activeRequestRows
        .map((row) => row.avg_latency)
        .filter((value): value is number => value !== null)
    );
    this.setSamples(
      samples,
      "tokens_per_request",
      activeRequestRows
        .map((row) => row.avg_tokens)
        .filter((value): value is number => value !== null)
    );

    this.setSamples(
      samples,
      "cost_per_hour",
      this.getCostBuckets(startBucket, currentBucket).map((row) => row.cost)
    );

    this.addToolSamples(samples, buckets, startBucket, currentBucket);
    this.addToolExecutionSamples(samples, buckets, startBucket, currentBucket);

    return samples;
  }

  private collectCurrentValues(referenceTime: number): Map<string, number> {
    const currentBucket = hourBucket(referenceTime);
    const nextBucket = currentBucket + 3600;
    const values = new Map<string, number>();

    const requestRow = this.getRequestBuckets(currentBucket, nextBucket)[0];
    const totalRequests = requestRow?.total ?? 0;
    values.set("requests_per_hour", totalRequests);
    values.set(
      "error_rate",
      totalRequests > 0 && requestRow ? requestRow.errors / totalRequests : 0
    );
    values.set("avg_latency_ms", requestRow?.avg_latency ?? 0);
    values.set("tokens_per_request", requestRow?.avg_tokens ?? 0);

    const costRow = this.getCostBuckets(currentBucket, nextBucket)[0];
    values.set("cost_per_hour", costRow?.cost ?? 0);

    const toolRows = this.getToolBuckets(currentBucket, nextBucket);
    const totalToolCalls = toolRows.reduce((sum, row) => sum + row.count, 0);
    values.set("tool_calls_per_hour", totalToolCalls);
    for (const row of toolRows) {
      values.set(`tool_share:${row.tool}`, totalToolCalls > 0 ? row.count / totalToolCalls : 0);
      values.set(`new_tool:${row.tool}`, row.count);
    }

    const toolExecutionRow = this.getToolExecutionBuckets(currentBucket, nextBucket)[0];
    const totalToolExecutions = toolExecutionRow?.total ?? 0;
    values.set(
      "tool_failure_rate",
      totalToolExecutions > 0 && toolExecutionRow
        ? toolExecutionRow.failures / totalToolExecutions
        : 0
    );
    values.set("avg_tool_latency_ms", toolExecutionRow?.avg_latency ?? 0);

    return values;
  }

  private getMetricDetections(currentValues: Map<string, number>): MetricDetection[] {
    const detections: MetricDetection[] = [];
    const add = (
      metric: string,
      type: AnomalyType,
      description: (ctx: DetectionContext) => string
    ) => {
      const value = currentValues.get(metric);
      if (value !== undefined) {
        detections.push({ metric, type, value, description });
      }
    };

    add(
      "requests_per_hour",
      "volume_spike",
      (ctx) =>
        `Request volume is ${formatValue(ctx.value)} per hour, outside the expected range ` +
        `${formatValue(ctx.expectedMin)}-${formatValue(ctx.expectedMax)}.`
    );
    add(
      "error_rate",
      "error_burst",
      (ctx) =>
        `Error rate is ${formatValue(ctx.value * 100)}%, outside the expected range ` +
        `${formatValue(ctx.expectedMin * 100)}-${formatValue(ctx.expectedMax * 100)}%.`
    );
    add(
      "avg_latency_ms",
      "latency_degradation",
      (ctx) =>
        `Average latency is ${formatValue(ctx.value)} ms, outside the expected range ` +
        `${formatValue(ctx.expectedMin)}-${formatValue(ctx.expectedMax)} ms.`
    );
    add(
      "tokens_per_request",
      "cost_spike",
      (ctx) =>
        `Token usage is ${formatValue(ctx.value)} tokens per request, outside the expected range ` +
        `${formatValue(ctx.expectedMin)}-${formatValue(ctx.expectedMax)}.`
    );
    add(
      "cost_per_hour",
      "cost_spike",
      (ctx) =>
        `Cost is $${formatValue(ctx.value)} per hour, outside the expected range ` +
        `$${formatValue(ctx.expectedMin)}-$${formatValue(ctx.expectedMax)}.`
    );
    add(
      "tool_calls_per_hour",
      "behavioral_anomaly",
      (ctx) =>
        `Tool invocation volume is ${formatValue(ctx.value)} per hour, outside the expected range ` +
        `${formatValue(ctx.expectedMin)}-${formatValue(ctx.expectedMax)}.`
    );
    add(
      "tool_failure_rate",
      "error_burst",
      (ctx) =>
        `Tool failure rate is ${formatValue(ctx.value * 100)}%, outside the expected range ` +
        `${formatValue(ctx.expectedMin * 100)}-${formatValue(ctx.expectedMax * 100)}%.`
    );
    add(
      "avg_tool_latency_ms",
      "latency_degradation",
      (ctx) =>
        `Average tool latency is ${formatValue(ctx.value)} ms, outside the expected range ` +
        `${formatValue(ctx.expectedMin)}-${formatValue(ctx.expectedMax)} ms.`
    );

    for (const [metric, value] of currentValues.entries()) {
      if (!metric.startsWith("tool_share:")) continue;
      detections.push({
        metric,
        value,
        type: "behavioral_anomaly",
        description: (ctx) =>
          `${formatMetric(metric)} is ${formatValue(ctx.value * 100)}% of tool calls, outside the ` +
          `expected range ${formatValue(ctx.expectedMin * 100)}-${formatValue(ctx.expectedMax * 100)}%.`,
      });
    }

    return detections;
  }

  private detectNewToolPatterns(
    currentValues: Map<string, number>,
    referenceTime: number
  ): AnomalyEvent[] {
    const currentBucket = hourBucket(referenceTime);
    const startBucket = currentBucket - this.config.baseline_days * 24 * 3600;
    const events: AnomalyEvent[] = [];

    for (const [metric, count] of currentValues.entries()) {
      if (!metric.startsWith("new_tool:") || count <= 0) continue;
      const tool = metric.slice("new_tool:".length);
      const seen = this.db
        .prepare(
          `SELECT 1 FROM metric_tool_calls
           WHERE bucket >= ? AND bucket < ? AND tool = ?
           LIMIT 1`
        )
        .get(startBucket, currentBucket, tool);
      if (seen) continue;
      if (this.hasRecentEvent("behavioral_anomaly", metric)) continue;

      const baseline = this.getBaseline("tool_calls_per_hour", referenceTime);
      if (!baseline || baseline.sampleCount < this.config.min_samples) continue;

      const event = this.insertEvent({
        type: "behavioral_anomaly",
        severity: "warning",
        metric,
        currentValue: count,
        expectedMin: 0,
        expectedMax: 0,
        baselineMean: 0,
        baselineStddev: 0,
        zScore: null,
        description: `Tool "${tool}" appeared in the current hour but was not seen in the ${this.config.baseline_days}-day baseline window.`,
      });
      events.push(event);
    }

    return events;
  }

  private compare(value: number, baseline: AnomalyBaseline): Comparison {
    const threshold = this.config.sensitivity;
    const expectedMin = baseline.mean - threshold * baseline.stddev;
    const expectedMax = baseline.mean + threshold * baseline.stddev;

    let zScore: number | null;
    if (baseline.stddev === 0) {
      zScore = value === baseline.mean ? 0 : MAX_Z_SCORE_FOR_STABLE_BASELINE;
    } else {
      zScore = Math.abs(value - baseline.mean) / baseline.stddev;
    }

    const isAnomaly = value > expectedMax || value < expectedMin;
    const severity =
      zScore !== null && zScore >= threshold * 1.5
        ? "critical"
        : baseline.metric === "error_rate" && value >= 0.5
          ? "critical"
          : "warning";

    return {
      isAnomaly,
      expectedMin,
      expectedMax,
      zScore,
      severity,
    };
  }

  private insertEvent(input: {
    type: AnomalyType;
    severity: AnomalySeverity;
    metric: string;
    currentValue: number;
    expectedMin: number;
    expectedMax: number;
    baselineMean: number;
    baselineStddev: number;
    zScore: number | null;
    description: string;
  }): AnomalyEvent {
    const id = randomUUID();
    const createdAt = nowUnix();
    this.db
      .prepare(
        `INSERT INTO anomaly_events (
           id,
           type,
           severity,
           metric,
           period,
           current_value,
           expected_min,
           expected_max,
           baseline_mean,
           baseline_stddev,
           z_score,
           description,
           acknowledged,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        input.type,
        input.severity,
        input.metric,
        PERIOD,
        input.currentValue,
        input.expectedMin,
        input.expectedMax,
        input.baselineMean,
        input.baselineStddev,
        input.zScore,
        input.description,
        createdAt
      );

    const row = this.db.prepare("SELECT * FROM anomaly_events WHERE id = ?").get(id) as EventRow;
    const event = rowToEvent(row);
    void getEventBus(this.db)
      .publish({
        type: "anomaly.detected",
        source: "anomaly-detector",
        payload: {
          id: event.id,
          type: event.type,
          severity: event.severity,
          metric: event.metric,
          currentValue: event.currentValue,
          expectedMin: event.expectedMin,
          expectedMax: event.expectedMax,
          description: event.description,
        },
      })
      .catch((err: unknown) => {
        log.warn({ err, anomalyId: event.id }, "Anomaly event publish failed");
      });
    return event;
  }

  private dispatchAlert(event: AnomalyEvent): void {
    if (!this.alertDispatcher) return;
    try {
      void Promise.resolve(this.alertDispatcher.dispatchAnomaly(event)).catch((error) => {
        log.warn({ err: error, anomalyId: event.id }, "Anomaly alert dispatch failed");
      });
    } catch (error) {
      log.warn({ err: error, anomalyId: event.id }, "Anomaly alert dispatch failed");
    }
  }

  private hasRecentEvent(type: AnomalyType, metric: string): boolean {
    const since = nowUnix() - this.config.cooldown_minutes * 60;
    const row = this.db
      .prepare(
        `SELECT 1 FROM anomaly_events
         WHERE type = ? AND metric = ? AND created_at >= ?
         LIMIT 1`
      )
      .get(type, metric, since);
    return !!row;
  }

  private getBaseline(metric: string, referenceTime: number): AnomalyBaseline | null {
    const row = this.db
      .prepare("SELECT * FROM anomaly_baselines WHERE metric = ? AND period = ?")
      .get(metric, PERIOD) as BaselineRow | undefined;
    if (!row) return null;
    const currentValues = this.collectCurrentValues(referenceTime);
    return rowToBaseline(row, currentValues.get(metric) ?? null);
  }

  private addToolSamples(
    samples: Map<string, number[]>,
    buckets: number[],
    startBucket: number,
    endBucket: number
  ): void {
    const rows = this.getToolBuckets(startBucket, endBucket);
    const totalsByBucket = new Map<number, number>();
    const countsByTool = new Map<string, Map<number, number>>();

    for (const row of rows) {
      totalsByBucket.set(row.bucket, (totalsByBucket.get(row.bucket) ?? 0) + row.count);
      const perBucket = countsByTool.get(row.tool) ?? new Map<number, number>();
      perBucket.set(row.bucket, (perBucket.get(row.bucket) ?? 0) + row.count);
      countsByTool.set(row.tool, perBucket);
    }

    this.setSamples(
      samples,
      "tool_calls_per_hour",
      buckets.map((bucket) => totalsByBucket.get(bucket) ?? 0).filter((count) => count > 0)
    );

    const activeToolBuckets = buckets.filter((bucket) => (totalsByBucket.get(bucket) ?? 0) > 0);
    for (const [tool, counts] of countsByTool) {
      this.setSamples(
        samples,
        `tool_share:${tool}`,
        activeToolBuckets.map((bucket) => {
          const total = totalsByBucket.get(bucket) ?? 0;
          return total > 0 ? (counts.get(bucket) ?? 0) / total : 0;
        })
      );
    }
  }

  private addToolExecutionSamples(
    samples: Map<string, number[]>,
    buckets: number[],
    startBucket: number,
    endBucket: number
  ): void {
    const rowsByBucket = new Map<number, ToolExecutionBucketRow>();
    for (const row of this.getToolExecutionBuckets(startBucket, endBucket)) {
      rowsByBucket.set(row.bucket, row);
    }

    const activeRows = buckets
      .map((bucket) => rowsByBucket.get(bucket))
      .filter((row): row is ToolExecutionBucketRow => !!row && row.total > 0);

    this.setSamples(
      samples,
      "tool_failure_rate",
      activeRows.map((row) => row.failures / row.total)
    );
    this.setSamples(
      samples,
      "avg_tool_latency_ms",
      activeRows.map((row) => row.avg_latency).filter((value): value is number => value !== null)
    );
  }

  private setSamples(samples: Map<string, number[]>, metric: string, values: number[]): void {
    samples.set(
      metric,
      values.filter((value) => Number.isFinite(value))
    );
  }

  private bucketRange(startBucket: number, endBucket: number): number[] {
    const buckets: number[] = [];
    for (let bucket = startBucket; bucket < endBucket; bucket += 3600) {
      buckets.push(bucket);
    }
    return buckets;
  }

  private getRequestBuckets(startBucket: number, endBucket: number): RequestBucketRow[] {
    return this.db
      .prepare(
        `SELECT
           created_at - (created_at % 3600) AS bucket,
           COUNT(*) AS total,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors,
           AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS avg_latency,
           AVG(CASE WHEN tokens_used IS NOT NULL THEN tokens_used END) AS avg_tokens
         FROM request_metrics
         WHERE created_at >= ? AND created_at < ?
         GROUP BY bucket
         ORDER BY bucket ASC`
      )
      .all(startBucket, endBucket) as RequestBucketRow[];
  }

  private getCostBuckets(startBucket: number, endBucket: number): CostBucketRow[] {
    return this.db
      .prepare(
        `SELECT bucket, SUM(cost) AS cost
         FROM metric_tokens
         WHERE bucket >= ? AND bucket < ?
         GROUP BY bucket
         ORDER BY bucket ASC`
      )
      .all(startBucket, endBucket) as CostBucketRow[];
  }

  private getToolBuckets(startBucket: number, endBucket: number): ToolBucketRow[] {
    return this.db
      .prepare(
        `SELECT bucket, tool, SUM(count) AS count
         FROM metric_tool_calls
         WHERE bucket >= ? AND bucket < ?
         GROUP BY bucket, tool
         ORDER BY bucket ASC, tool ASC`
      )
      .all(startBucket, endBucket) as ToolBucketRow[];
  }

  private getToolExecutionBuckets(
    startBucket: number,
    endBucket: number
  ): ToolExecutionBucketRow[] {
    return this.db
      .prepare(
        `SELECT
           created_at - (created_at % 3600) AS bucket,
           COUNT(*) AS total,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
           AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS avg_latency
         FROM anomaly_tool_metrics
         WHERE created_at >= ? AND created_at < ?
         GROUP BY bucket
         ORDER BY bucket ASC`
      )
      .all(startBucket, endBucket) as ToolExecutionBucketRow[];
  }
}

let _instance: AnomalyDetectorService | null = null;

export function initAnomalyDetector(
  db: Database,
  config: Partial<AnomalyDetectionConfig> = {},
  alertDispatcher?: AlertDispatcher | null
): AnomalyDetectorService {
  if (_instance?.usesDatabase(db)) {
    _instance.updateConfig(config, alertDispatcher ?? undefined);
    return _instance;
  }

  _instance = new AnomalyDetectorService(db, config, alertDispatcher ?? null);
  return _instance;
}

export function getAnomalyDetector(): AnomalyDetectorService | null {
  return _instance;
}
