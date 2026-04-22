import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import type { AutonomousTaskStore, AutonomousTask } from "../../memory/agent/autonomous-tasks.js";
import { AutonomousLoop } from "../loop.js";
import type { LoopDependencies, PlannedAction, ToolExecutionResult, Reflection } from "../loop.js";
import { DEFAULT_POLICY_CONFIG } from "../policy-engine.js";

function makeDeps(overrides: Partial<LoopDependencies> = {}): LoopDependencies {
  return {
    planNextAction: vi.fn().mockResolvedValue({
      toolName: "web_fetch",
      params: { url: "https://example.com" },
      reasoning: "Fetch data",
      confidence: 0.9,
    } satisfies PlannedAction),

    executeTool: vi.fn().mockResolvedValue({
      success: true,
      data: { result: "fetched" },
      durationMs: 100,
    } satisfies ToolExecutionResult),

    evaluateSuccess: vi.fn().mockResolvedValue(false),

    selfReflect: vi.fn().mockResolvedValue({
      progressSummary: "Making progress",
      isStuck: false,
    } satisfies Reflection),

    escalate: vi.fn().mockResolvedValue(undefined),

    ...overrides,
  };
}

describe("AutonomousLoop", () => {
  let db: InstanceType<typeof Database>;
  let store: AutonomousTaskStore;
  let task: AutonomousTask;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    store = getAutonomousTaskStore(db);
    task = store.createTask({
      goal: "Test task",
      constraints: { maxIterations: 3 },
    });
  });

  afterEach(() => {
    db.close();
  });

  // ─── Successful completion ─────────────────────────────────────────────────

  it("completes when evaluateSuccess returns true", async () => {
    let calls = 0;
    const deps = makeDeps({
      evaluateSuccess: vi.fn().mockImplementation(async () => {
        calls++;
        return calls >= 2; // succeed on 2nd step
      }),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(task);

    expect(result.status).toBe("completed");
    expect(result.totalSteps).toBeGreaterThan(0);
  });

  // ─── Max iterations policy ─────────────────────────────────────────────────

  it("fails when max iterations policy is violated", async () => {
    const taskWithLowMax = store.createTask({
      goal: "Will hit max",
      constraints: { maxIterations: 0 }, // already at step 0 = 0 iterations
    });

    const deps = makeDeps({
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(taskWithLowMax);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("maximum iterations");
  });

  // ─── Escalation ────────────────────────────────────────────────────────────

  it("pauses and escalates when policy requires escalation", async () => {
    const deps = makeDeps({
      planNextAction: vi.fn().mockResolvedValue({
        toolName: "ton_send",
        params: { amount: 0.6 },
        tonAmount: 0.6, // above confirmation threshold (0.5 TON) but below perTask budget (1 TON)
      }),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(task);

    expect(result.status).toBe("paused");
    expect(deps.escalate).toHaveBeenCalled();

    const updated = store.getTask(task.id);
    expect(updated!.status).toBe("paused");
  });

  // ─── Reflection adjustments ────────────────────────────────────────────────

  it("applies context adjustments from reflection", async () => {
    let stepCount = 0;
    const deps = makeDeps({
      selfReflect: vi.fn().mockResolvedValue({
        progressSummary: "Adding context",
        isStuck: false,
        adjustments: { contextAdditions: { newKey: "newValue" } },
      } satisfies Reflection),
      evaluateSuccess: vi.fn().mockImplementation(async () => {
        stepCount++;
        return stepCount >= 1;
      }),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    await loop.run(task);

    const updated = store.getTask(task.id);
    expect(updated!.context.newKey).toBe("newValue");
  });

  // ─── Checkpoint saving ─────────────────────────────────────────────────────

  it("saves a checkpoint after each step", async () => {
    let stepCount = 0;
    const deps = makeDeps({
      evaluateSuccess: vi.fn().mockImplementation(async () => {
        stepCount++;
        return stepCount >= 1;
      }),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    await loop.run(task);

    const checkpoint = store.getLastCheckpoint(task.id);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.step).toBeGreaterThan(0);
  });

  // ─── Manual stop ──────────────────────────────────────────────────────────

  it("cancels when stop() is called", async () => {
    const deps = makeDeps({
      planNextAction: vi.fn().mockImplementation(async () => {
        // Delay to allow stop() to be called
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { toolName: "web_fetch", params: {} };
      }),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);

    // Stop immediately
    loop.stop();
    const result = await loop.run(task);

    expect(result.status).toBe("cancelled");
  });

  // ─── Execution logging ─────────────────────────────────────────────────────

  it("logs execution events for each step", async () => {
    let stepCount = 0;
    const deps = makeDeps({
      evaluateSuccess: vi.fn().mockImplementation(async () => {
        stepCount++;
        return stepCount >= 1;
      }),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    await loop.run(task);

    const logs = store.getExecutionLogs(task.id);
    expect(logs.length).toBeGreaterThan(0);

    const eventTypes = logs.map((l) => l.eventType);
    expect(eventTypes).toContain("plan");
    expect(eventTypes).toContain("tool_call");
    expect(eventTypes).toContain("tool_result");
    expect(eventTypes).toContain("reflect");
    expect(eventTypes).toContain("checkpoint");
  });

  // ─── Planning failure ─────────────────────────────────────────────────────

  it("fails gracefully when planning throws", async () => {
    const deps = makeDeps({
      planNextAction: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(task);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("LLM unavailable");

    const updated = store.getTask(task.id);
    expect(updated!.status).toBe("failed");
  });

  // ─── Stuck detection escalation ────────────────────────────────────────────

  it("escalates after too many consecutive uncertain reflections", async () => {
    const deps = makeDeps({
      selfReflect: vi.fn().mockResolvedValue({
        progressSummary: "Not making progress",
        isStuck: true,
      } satisfies Reflection),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(task);

    expect(result.status).toBe("paused");
    expect(deps.escalate).toHaveBeenCalled();
  });
});
