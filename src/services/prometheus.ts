// ── Prometheus Metrics Service ──────────────────────────────────────
// Exposes operational metrics in the Prometheus text exposition format
// for scraping by Prometheus / Grafana Agent / VictoriaMetrics, etc.
//
// The registry is a process-wide singleton initialised lazily on first
// use. Recording helpers (recordTask / recordLlmRequest) auto-initialise
// the registry so instrumentation works even before the /metrics endpoint
// is mounted. Live gauges (memory items, active sessions) are populated
// on each scrape via collector callbacks registered by the API server.

import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";

/** Callbacks that produce live gauge values, evaluated on each scrape. */
export interface GaugeCollectors {
  memoryItems?: () => number;
  activeSessions?: () => number;
}

export interface PrometheusMetrics {
  registry: Registry;
  tasksTotal: Counter<"status">;
  llmRequestsTotal: Counter<"provider" | "model" | "status">;
  llmDuration: Histogram<"provider" | "model">;
  memoryItems: Gauge<string>;
  activeSessions: Gauge<string>;
}

let instance: PrometheusMetrics | null = null;
let collectors: GaugeCollectors = {};

/**
 * Initialise (idempotently) the Prometheus registry and metrics.
 * Safe to call multiple times — only the first call creates the registry.
 */
export function initPrometheus(): PrometheusMetrics {
  if (instance) return instance;

  const registry = new Registry();

  // process_* / nodejs_* metrics (uptime, memory, CPU, GC, event loop, …)
  collectDefaultMetrics({ register: registry });

  const tasksTotal = new Counter({
    name: "teleton_tasks_total",
    help: "Total autonomous tasks by terminal status",
    labelNames: ["status"] as const,
    registers: [registry],
  });

  const llmRequestsTotal = new Counter({
    name: "teleton_llm_requests_total",
    help: "Total LLM requests by provider, model and outcome",
    labelNames: ["provider", "model", "status"] as const,
    registers: [registry],
  });

  const llmDuration = new Histogram({
    name: "teleton_llm_duration_seconds",
    help: "LLM request latency in seconds by provider and model",
    labelNames: ["provider", "model"] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
    registers: [registry],
  });

  const memoryItems = new Gauge({
    name: "teleton_memory_items_total",
    help: "Number of vector-memory (knowledge) entries",
    registers: [registry],
    collect() {
      const fn = collectors.memoryItems;
      if (!fn) return;
      try {
        this.set(fn());
      } catch {
        // Ignore collection errors — never break a scrape.
      }
    },
  });

  const activeSessions = new Gauge({
    name: "teleton_active_sessions",
    help: "Number of Telegram sessions active in the last 30 minutes",
    registers: [registry],
    collect() {
      const fn = collectors.activeSessions;
      if (!fn) return;
      try {
        this.set(fn());
      } catch {
        // Ignore collection errors — never break a scrape.
      }
    },
  });

  instance = {
    registry,
    tasksTotal,
    llmRequestsTotal,
    llmDuration,
    memoryItems,
    activeSessions,
  };
  return instance;
}

/** Get the singleton metrics object, or null if never initialised. */
export function getPrometheus(): PrometheusMetrics | null {
  return instance;
}

/**
 * Register callbacks used to populate live gauges on each scrape.
 * Merges with any previously registered collectors.
 */
export function setGaugeCollectors(next: GaugeCollectors): void {
  collectors = { ...collectors, ...next };
}

/** Record a terminal task outcome (completed | failed | cancelled | …). */
export function recordTask(status: string): void {
  initPrometheus().tasksTotal.inc({ status });
}

/** Record one LLM request with its latency and outcome. */
export function recordLlmRequest(
  provider: string,
  model: string,
  durationSeconds: number,
  status: "success" | "error"
): void {
  const m = initPrometheus();
  m.llmRequestsTotal.inc({ provider, model, status });
  m.llmDuration.observe({ provider, model }, durationSeconds);
}

/** Render the current metrics in Prometheus text exposition format. */
export async function renderMetrics(): Promise<string> {
  return initPrometheus().registry.metrics();
}

/** Reset the singleton (test helper). */
export function resetPrometheusForTests(): void {
  instance?.registry.clear();
  instance = null;
  collectors = {};
}
