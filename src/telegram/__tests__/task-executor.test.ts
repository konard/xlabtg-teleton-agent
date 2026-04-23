import { describe, it, expect, vi } from "vitest";
import { executeScheduledTask } from "../task-executor.js";
import type { Task } from "../../memory/agent/tasks.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-uuid-123",
    description: "Test scheduled task",
    status: "pending",
    priority: 0,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    ...overrides,
  };
}

function makeAgent() {
  return {} as any;
}

function makeToolContext() {
  return {} as any;
}

function makeToolRegistry() {
  return {
    execute: vi.fn(),
  };
}

// ── executeScheduledTask Tests ────────────────────────────────────────────────

describe("executeScheduledTask()", () => {
  // ── No payload (simple reminder) ────────────────────────────────────────

  it("returns reminder prompt when no payload", async () => {
    const task = makeTask({ payload: undefined });
    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("[SCHEDULED TASK - task-uuid-123]");
    expect(prompt).toContain("Test scheduled task");
    expect(prompt).toContain("This is a reminder you scheduled for yourself.");
  });

  it("includes task reason in prompt", async () => {
    const task = makeTask({ payload: undefined, reason: "Weekly check" });
    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("Reason: Weekly check");
  });

  it("uses scheduledFor date in prompt when available", async () => {
    const scheduledFor = new Date("2025-06-15T09:00:00Z");
    const task = makeTask({ payload: undefined, scheduledFor });
    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("Scheduled for: 2025-06-15T09:00:00.000Z");
    expect(prompt).not.toContain("Created:");
  });

  it("uses Created label when scheduledFor is not set", async () => {
    const task = makeTask({ payload: undefined, scheduledFor: undefined });
    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("Created:");
    expect(prompt).not.toContain("Scheduled for:");
  });

  // ── tool_call payload ────────────────────────────────────────────────────

  it("executes tool and includes result in prompt", async () => {
    const toolResult = { price: 5.5, currency: "USD" };
    const toolRegistry = makeToolRegistry();
    toolRegistry.execute.mockResolvedValue(toolResult);

    const payload = JSON.stringify({
      type: "tool_call",
      tool: "ton_get_price",
      params: {},
      condition: "price > 5",
    });
    const task = makeTask({ payload });

    const prompt = await executeScheduledTask(task, makeAgent(), makeToolContext(), toolRegistry);

    expect(toolRegistry.execute).toHaveBeenCalledWith("ton_get_price", {}, makeToolContext());
    expect(prompt).toContain("TOOL EXECUTED:");
    expect(prompt).toContain("ton_get_price");
    expect(prompt).toContain("Condition: price > 5");
    expect(prompt).toContain("Analyze this result");
  });

  it("includes tool error in prompt when tool fails", async () => {
    const toolRegistry = makeToolRegistry();
    toolRegistry.execute.mockRejectedValue(new Error("network error"));

    const payload = JSON.stringify({ type: "tool_call", tool: "failing_tool", params: {} });
    const task = makeTask({ payload });

    const prompt = await executeScheduledTask(task, makeAgent(), makeToolContext(), toolRegistry);

    expect(prompt).toContain("❌ ERROR:");
    expect(prompt).toContain("network error");
    expect(prompt).toContain("The tool failed.");
  });

  // ── agent_task payload ───────────────────────────────────────────────────

  it("builds instructions prompt for agent_task payload", async () => {
    const payload = JSON.stringify({
      type: "agent_task",
      instructions: "1. Check TON price\n2. If > $5, swap 50 TON",
      context: { chatId: "123" },
    });
    const task = makeTask({ payload });

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("INSTRUCTIONS:");
    expect(prompt).toContain("1. Check TON price");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("Execute these instructions");
  });

  it("builds instructions prompt without context", async () => {
    const payload = JSON.stringify({
      type: "agent_task",
      instructions: "Send daily report",
    });
    const task = makeTask({ payload });

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("INSTRUCTIONS:");
    expect(prompt).toContain("Send daily report");
    expect(prompt).not.toContain("Context:");
  });

  // ── Parent results context ───────────────────────────────────────────────

  it("includes parent task results in prompt", async () => {
    const task = makeTask({ payload: undefined });
    const parentResults = [
      { taskId: "parent-1", description: "Check price", result: { price: 5.5 } },
    ];

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry(),
      parentResults
    );

    expect(prompt).toContain("PARENT TASK COMPLETED:");
    expect(prompt).toContain("Check price");
    expect(prompt).toContain("5.5");
  });

  it("uses plural 'PARENT TASKS' when multiple parents", async () => {
    const task = makeTask({ payload: undefined });
    const parentResults = [
      { taskId: "p1", description: "Parent 1", result: "r1" },
      { taskId: "p2", description: "Parent 2", result: "r2" },
    ];

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry(),
      parentResults
    );

    expect(prompt).toContain("PARENT TASKS COMPLETED:");
  });

  it("does not include parent section when no parent results", async () => {
    const task = makeTask({ payload: undefined });
    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry(),
      []
    );

    expect(prompt).not.toContain("PARENT TASK");
  });

  // ── Invalid JSON payload ─────────────────────────────────────────────────

  it("returns failed message for invalid JSON payload without throwing", async () => {
    const task = makeTask({ payload: "not valid json {{" });

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("FAILED");
    expect(prompt).toContain("invalid JSON payload");
  });

  it("continues executing other tasks when one has invalid JSON payload", async () => {
    // Executor returns a failure string, not an exception — caller loop continues
    const badTask = makeTask({ id: "bad-task", payload: "{broken" });
    const goodTask = makeTask({
      id: "good-task",
      payload: JSON.stringify({ type: "agent_task", instructions: "do something" }),
    });

    const badPromise = executeScheduledTask(
      badTask,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );
    const goodPromise = executeScheduledTask(
      goodTask,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    const [badResult, goodResult] = await Promise.all([badPromise, goodPromise]);

    expect(badResult).toContain("FAILED");
    expect(goodResult).toContain("INSTRUCTIONS:");
    expect(goodResult).toContain("do something");
  });

  // ── Unknown payload type ─────────────────────────────────────────────────

  it("falls back to reminder prompt for unknown payload type", async () => {
    const payload = JSON.stringify({ type: "unknown_type" });
    const task = makeTask({ payload });

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("[SCHEDULED TASK");
    // Should not throw, falls through to reminder-like prompt
  });

  // ── Trading automation use case (issue #138) ─────────────────────────────
  // Verifies that telegram_create_scheduled_task with agent_task payload can
  // automate a full trading workflow: simulate trade → check results → send report.

  it("builds automation prompt for trading workflow (simulate + journal + report)", async () => {
    const instructions =
      "1. Run trade simulation using ton_trading_simulate_trade\n" +
      "2. Call journal_query to check the simulation results\n" +
      "3. Send a summary report via telegram_send_message";
    const payload = JSON.stringify({
      type: "agent_task",
      instructions,
      context: { chatId: "user-chat-id" },
    });
    const task = makeTask({
      description: "Run trade simulation and send report at 19:15",
      scheduledFor: new Date("2025-06-15T19:15:00Z"),
      payload,
      reason: "Automated daily trading strategy",
    });

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry()
    );

    expect(prompt).toContain("[SCHEDULED TASK");
    expect(prompt).toContain("Run trade simulation and send report at 19:15");
    expect(prompt).toContain("Automated daily trading strategy");
    expect(prompt).toContain("INSTRUCTIONS:");
    expect(prompt).toContain("ton_trading_simulate_trade");
    expect(prompt).toContain("journal_query");
    expect(prompt).toContain("telegram_send_message");
    expect(prompt).toContain("Execute these instructions step by step");
    expect(prompt).toContain("Scheduled for: 2025-06-15T19:15:00.000Z");
  });

  it("builds automation prompt for tool_call trading use case", async () => {
    const tradeResult = { success: true, simulatedProfit: 12.5, tradeId: "sim-001" };
    const toolRegistry = makeToolRegistry();
    toolRegistry.execute.mockResolvedValue(tradeResult);

    const payload = JSON.stringify({
      type: "tool_call",
      tool: "ton_trading_simulate_trade",
      params: { amount: 50, fromToken: "TON", toToken: "USDT" },
      condition: "simulatedProfit > 0",
    });
    const task = makeTask({
      description: "Simulate TON trade at 19:15",
      scheduledFor: new Date("2025-06-15T19:15:00Z"),
      payload,
    });

    const prompt = await executeScheduledTask(task, makeAgent(), makeToolContext(), toolRegistry);

    expect(toolRegistry.execute).toHaveBeenCalledWith(
      "ton_trading_simulate_trade",
      { amount: 50, fromToken: "TON", toToken: "USDT" },
      makeToolContext()
    );
    expect(prompt).toContain("TOOL EXECUTED:");
    expect(prompt).toContain("ton_trading_simulate_trade");
    expect(prompt).toContain("Condition: simulatedProfit > 0");
    expect(prompt).toContain("Analyze this result");
    expect(prompt).toContain("sim-001");
  });

  it("builds chained task prompt: simulation result fed to report task as parent result", async () => {
    const task = makeTask({
      description: "Send trade simulation report",
      payload: JSON.stringify({
        type: "agent_task",
        instructions: "Send the simulation results as a report via telegram_send_message",
      }),
    });
    const parentResults = [
      {
        taskId: "sim-task-id",
        description: "Run trade simulation",
        result: { success: true, simulatedProfit: 12.5, tradeId: "sim-001" },
      },
    ];

    const prompt = await executeScheduledTask(
      task,
      makeAgent(),
      makeToolContext(),
      makeToolRegistry(),
      parentResults
    );

    expect(prompt).toContain("PARENT TASK COMPLETED:");
    expect(prompt).toContain("Run trade simulation");
    expect(prompt).toContain("sim-001");
    expect(prompt).toContain("12.5");
    expect(prompt).toContain("INSTRUCTIONS:");
    expect(prompt).toContain("telegram_send_message");
  });
});
