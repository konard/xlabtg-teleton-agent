import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine, DEFAULT_POLICY_CONFIG } from "../policy-engine.js";
import type { AutonomousTask } from "../../memory/agent/autonomous-tasks.js";

function makeTask(overrides: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id: "test-task-id",
    goal: "Test goal",
    successCriteria: [],
    failureConditions: [],
    constraints: {},
    strategy: "balanced",
    retryPolicy: { maxRetries: 3, backoff: "exponential" },
    context: {},
    priority: "medium",
    status: "running",
    currentStep: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(DEFAULT_POLICY_CONFIG);
  });

  // ─── Basic allowed actions ─────────────────────────────────────────────────

  it("allows a safe action with no violations", () => {
    const task = makeTask();
    const result = engine.checkAction(task, { toolName: "web_fetch" });

    expect(result.allowed).toBe(true);
    expect(result.requiresEscalation).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  // ─── Max iterations ────────────────────────────────────────────────────────

  it("blocks when max iterations is reached", () => {
    const task = makeTask({
      constraints: { maxIterations: 5 },
      currentStep: 5,
    });
    const result = engine.checkAction(task, { toolName: "web_fetch" });

    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.type === "max_iterations")).toBe(true);
  });

  it("allows action when current step is below max iterations", () => {
    const task = makeTask({
      constraints: { maxIterations: 10 },
      currentStep: 5,
    });
    const result = engine.checkAction(task, { toolName: "web_fetch" });

    expect(result.allowed).toBe(true);
  });

  // ─── Duration limit ────────────────────────────────────────────────────────

  it("blocks when duration limit is exceeded", () => {
    const startedAt = new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago
    const task = makeTask({
      constraints: { maxDurationHours: 2 },
      startedAt,
    });
    const result = engine.checkAction(task, { toolName: "web_fetch" });

    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.type === "duration_exceeded")).toBe(true);
  });

  // ─── Tool whitelist / blacklist ────────────────────────────────────────────

  it("blocks a tool not in allowedTools whitelist", () => {
    const task = makeTask({
      constraints: { allowedTools: ["web_fetch", "telegram_send_message"] },
    });
    const result = engine.checkAction(task, { toolName: "exec_run" });

    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.type === "restricted_tool")).toBe(true);
  });

  it("allows a tool in allowedTools whitelist", () => {
    const task = makeTask({
      constraints: { allowedTools: ["web_fetch"] },
    });
    const result = engine.checkAction(task, { toolName: "web_fetch" });

    expect(result.allowed).toBe(true);
  });

  it("requires escalation for globally restricted tools", () => {
    const task = makeTask();
    const result = engine.checkAction(task, { toolName: "wallet:send" });

    expect(result.requiresEscalation).toBe(true);
  });

  it("requires escalation for task-level restricted tools", () => {
    const task = makeTask({
      constraints: { restrictedTools: ["custom_tool"] },
    });
    const result = engine.checkAction(task, { toolName: "custom_tool" });

    expect(result.requiresEscalation).toBe(true);
  });

  // ─── TON budget ────────────────────────────────────────────────────────────

  it("blocks when TON amount exceeds task budget", () => {
    const task = makeTask({
      constraints: { budgetTON: 0.5 },
    });
    const result = engine.checkAction(task, { toolName: "wallet:send", tonAmount: 1.0 });

    expect(result.violations.some((v) => v.type === "budget_exceeded")).toBe(true);
  });

  it("requires escalation for TON above confirmation threshold", () => {
    const task = makeTask();
    const result = engine.checkAction(task, { toolName: "wallet:send", tonAmount: 0.6 });

    expect(result.requiresEscalation).toBe(true);
  });

  it("allows small TON amount within budget", () => {
    const task = makeTask({
      constraints: { budgetTON: 5 },
    });
    const result = engine.checkAction(task, { toolName: "safe_tool", tonAmount: 0.1 });

    expect(result.violations.filter((v) => v.type === "budget_exceeded")).toHaveLength(0);
  });

  // ─── Loop detection ────────────────────────────────────────────────────────

  it("detects loops when same action is repeated maxIdenticalActions times", () => {
    const task = makeTask();
    const recentActions = Array(5).fill("web_fetch");

    const result = engine.checkAction(task, {
      toolName: "web_fetch",
      recentActions,
    });

    expect(result.violations.some((v) => v.type === "loop_detected")).toBe(true);
    expect(result.requiresEscalation).toBe(true);
  });

  it("does not detect loop with varied actions", () => {
    const task = makeTask();
    const recentActions = ["web_fetch", "exec_run", "telegram_send", "web_fetch", "exec_run"];

    const result = engine.checkAction(task, {
      toolName: "web_fetch",
      recentActions,
    });

    expect(result.violations.some((v) => v.type === "loop_detected")).toBe(false);
  });

  // ─── Uncertainty tracking ──────────────────────────────────────────────────

  it("recordUncertain returns true after reaching threshold", () => {
    expect(engine.recordUncertain()).toBe(false);
    expect(engine.recordUncertain()).toBe(false);
    expect(engine.recordUncertain()).toBe(true); // threshold is 3
  });

  it("resetUncertainCount resets the counter", () => {
    engine.recordUncertain();
    engine.recordUncertain();
    engine.resetUncertainCount();

    expect(engine.recordUncertain()).toBe(false);
  });

  // ─── Rate limits ───────────────────────────────────────────────────────────

  it("blocks when tool call rate limit is exceeded", () => {
    const strictEngine = new PolicyEngine({
      ...DEFAULT_POLICY_CONFIG,
      rateLimit: { apiCallsPerMinute: 30, toolCallsPerHour: 2 },
    });
    const task = makeTask();

    strictEngine.recordToolCall();
    strictEngine.recordToolCall();

    const result = strictEngine.checkAction(task, { toolName: "web_fetch" });
    expect(result.violations.some((v) => v.type === "rate_limit")).toBe(true);
  });
});
