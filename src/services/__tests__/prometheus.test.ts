import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import {
  initPrometheus,
  getPrometheus,
  setGaugeCollectors,
  recordTask,
  recordLlmRequest,
  renderMetrics,
  resetPrometheusForTests,
} from "../prometheus.js";

describe("Prometheus metrics service", () => {
  beforeEach(() => {
    resetPrometheusForTests();
  });

  it("initPrometheus is idempotent", () => {
    const a = initPrometheus();
    const b = initPrometheus();
    expect(a).toBe(b);
    expect(getPrometheus()).toBe(a);
  });

  it("getPrometheus returns null before init", () => {
    expect(getPrometheus()).toBeNull();
  });

  it("exposes default process_* metrics", async () => {
    const text = await renderMetrics();
    expect(text).toContain("process_cpu_user_seconds_total");
    expect(text).toContain("process_resident_memory_bytes");
  });

  it("records task terminal statuses", async () => {
    recordTask("completed");
    recordTask("completed");
    recordTask("failed");
    const text = await renderMetrics();
    expect(text).toContain('teleton_tasks_total{status="completed"} 2');
    expect(text).toContain('teleton_tasks_total{status="failed"} 1');
  });

  it("records LLM requests with latency histogram", async () => {
    recordLlmRequest("anthropic", "claude-opus-4-8", 1.5, "success");
    recordLlmRequest("anthropic", "claude-opus-4-8", 0.5, "error");
    const text = await renderMetrics();
    expect(text).toContain(
      'teleton_llm_requests_total{provider="anthropic",model="claude-opus-4-8",status="success"} 1'
    );
    expect(text).toContain(
      'teleton_llm_requests_total{provider="anthropic",model="claude-opus-4-8",status="error"} 1'
    );
    expect(text).toContain("teleton_llm_duration_seconds_bucket");
    expect(text).toContain("teleton_llm_duration_seconds_count");
  });

  it("evaluates gauge collectors on each scrape", async () => {
    let items = 7;
    let sessions = 3;
    setGaugeCollectors({
      memoryItems: () => items,
      activeSessions: () => sessions,
    });

    let text = await renderMetrics();
    expect(text).toContain("teleton_memory_items_total 7");
    expect(text).toContain("teleton_active_sessions 3");

    // Gauges reflect new values on the next scrape.
    items = 10;
    sessions = 0;
    text = await renderMetrics();
    expect(text).toContain("teleton_memory_items_total 10");
    expect(text).toContain("teleton_active_sessions 0");
  });

  it("never throws when a gauge collector fails", async () => {
    setGaugeCollectors({
      memoryItems: () => {
        throw new Error("db gone");
      },
    });
    await expect(renderMetrics()).resolves.toBeTypeOf("string");
  });

  it("serves valid Prometheus exposition text over an HTTP route", async () => {
    initPrometheus();
    const app = new Hono();
    app.get("/metrics", async (c) => {
      const body = await renderMetrics();
      return c.text(body, 200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      });
    });

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    // Prometheus exposition format always emits HELP/TYPE comment lines.
    expect(body).toContain("# HELP");
    expect(body).toContain("# TYPE");
  });
});
