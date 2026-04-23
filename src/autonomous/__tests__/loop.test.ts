import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import type { AutonomousTaskStore, AutonomousTask } from "../../memory/agent/autonomous-tasks.js";
import { AutonomousLoop, MAX_GLOBAL_ITERATIONS } from "../loop.js";
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
        params: { amount: 0.08 },
        // above requireConfirmationAbove (0.05 TON) but below perTask budget (0.1 TON)
        tonAmount: 0.08,
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

  // ─── AUDIT-H4: pause / cancel race with in-flight await ────────────────────

  it("does not overwrite 'paused' when executeTool resolves after pause (AUDIT-H4)", async () => {
    // executeTool hangs until we release it; while it's in-flight we
    // simulate pauseTask() writing 'paused' and calling loop.stop().
    let releaseExec: (v: ToolExecutionResult) => void = () => {};
    const execPromise = new Promise<ToolExecutionResult>((resolve) => {
      releaseExec = resolve;
    });

    const deps = makeDeps({
      executeTool: vi.fn().mockImplementation(() => execPromise),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const runPromise = loop.run(task);

    // Let the loop reach `await executeTool(...)`.
    await new Promise((r) => setTimeout(r, 20));

    // Simulate pauseTask(): external writer marks paused + aborts loop.
    store.updateTaskStatus(task.id, "paused");
    loop.stop();

    // Now release the hung executeTool — its resolution must NOT cause the
    // loop to overwrite the 'paused' status with 'failed' or 'running'.
    releaseExec({ success: true, data: { late: true }, durationMs: 1 });

    const result = await runPromise;

    // The loop exited cleanly after seeing the abort — status stays paused.
    const after = store.getTask(task.id);
    expect(after!.status).toBe("paused");
    expect(result.status).toBe("paused");
  });

  it("does not overwrite 'cancelled' when executeTool rejects after stop (AUDIT-H4)", async () => {
    let rejectExec: (err: Error) => void = () => {};
    const execPromise = new Promise<ToolExecutionResult>((_, reject) => {
      rejectExec = reject;
    });

    const deps = makeDeps({
      executeTool: vi.fn().mockImplementation(() => execPromise),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const runPromise = loop.run(task);

    await new Promise((r) => setTimeout(r, 20));

    // Simulate stopTask(): external writer marks cancelled + aborts loop.
    store.updateTaskStatus(task.id, "cancelled");
    loop.stop();

    // Late rejection from the in-flight executeTool — must not clobber
    // 'cancelled' with 'failed'.
    rejectExec(new Error("tool crashed late"));

    const result = await runPromise;

    const after = store.getTask(task.id);
    expect(after!.status).toBe("cancelled");
    expect(result.status).toBe("cancelled");
  });

  it("stops before running another full iteration once aborted (AUDIT-H4)", async () => {
    // Record how many times each dep is called so we can assert that no
    // post-abort iteration ran planNextAction → executeTool → selfReflect.
    let planCalls = 0;
    let execCalls = 0;
    let reflectCalls = 0;
    let evalCalls = 0;

    const deps = makeDeps({
      planNextAction: vi.fn().mockImplementation(async () => {
        planCalls++;
        return { toolName: "noop", params: {} };
      }),
      executeTool: vi.fn().mockImplementation(async () => {
        execCalls++;
        // Abort *during* the first tool execution — mimics pauseTask()
        // arriving while a step is in-flight.
        await new Promise((r) => setTimeout(r, 10));
        return { success: true, durationMs: 1 };
      }),
      selfReflect: vi.fn().mockImplementation(async () => {
        reflectCalls++;
        return { progressSummary: "ok", isStuck: false };
      }),
      evaluateSuccess: vi.fn().mockImplementation(async () => {
        evalCalls++;
        return false;
      }),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const runPromise = loop.run(task);

    // Let the loop enter executeTool, then pause it.
    await new Promise((r) => setTimeout(r, 5));
    store.updateTaskStatus(task.id, "paused");
    loop.stop();

    await runPromise;

    // First iteration partially ran (plan + exec started). Post-abort we
    // must NOT have executed another plan / tool / reflect / evaluate cycle.
    expect(planCalls).toBe(1);
    expect(execCalls).toBe(1);
    // reflect and evaluate come after the in-flight exec await; with
    // throwIfAborted() they must NOT run once we aborted mid-tool.
    expect(reflectCalls).toBe(0);
    expect(evalCalls).toBe(0);

    const after = store.getTask(task.id);
    expect(after!.status).toBe("paused");
  });

  it("bails without running any iteration when stop() is called before start (AUDIT-H4)", async () => {
    // Simulate pauseTask() / stopTask() arriving while the loop is still
    // queued (scheduled via .then() but not yet executed): the DB already
    // holds 'paused' and abort has been requested.
    store.updateTaskStatus(task.id, "paused");

    const deps = makeDeps();
    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    loop.stop();
    const result = await loop.run(task);

    expect(result.status).toBe("cancelled");
    expect(deps.planNextAction).not.toHaveBeenCalled();
    expect(deps.executeTool).not.toHaveBeenCalled();

    // Since stop() fired before run() started, we never flipped to 'running'
    // — the externally-written 'paused' must survive.
    const after = store.getTask(task.id);
    expect(after!.status).toBe("paused");
  });

  it("preserves 'paused' when planNextAction rejects after pause (AUDIT-H4)", async () => {
    // Catches the specific regression the audit calls out: the catch block
    // at loop.ts:150 used to unconditionally write 'failed'.
    let rejectPlan: (err: Error) => void = () => {};
    const planPromise = new Promise<PlannedAction>((_, reject) => {
      rejectPlan = reject;
    });

    const deps = makeDeps({
      planNextAction: vi.fn().mockImplementation(() => planPromise),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const runPromise = loop.run(task);

    await new Promise((r) => setTimeout(r, 20));

    store.updateTaskStatus(task.id, "paused");
    loop.stop();

    rejectPlan(new Error("planner died late"));

    await runPromise;

    const after = store.getTask(task.id);
    expect(after!.status).toBe("paused");
    expect(after!.error).toBeUndefined();
  });

  // ─── AUDIT-M1: global max-iteration safety cap ────────────────────────────

  it("fails with global cap error when task has no maxIterations and loop runs forever (AUDIT-M1)", async () => {
    // Task without constraints.maxIterations — only the global cap should stop it.
    const uncappedTask = store.createTask({
      goal: "Uncapped task",
      constraints: {},
    });

    // Force the task's currentStep up to the cap boundary so the test
    // completes quickly without actually running 500 iterations.
    const stepsBeforeCap = MAX_GLOBAL_ITERATIONS;
    for (let i = 0; i < stepsBeforeCap; i++) {
      store.incrementStep(uncappedTask.id);
    }

    const deps = makeDeps({
      evaluateSuccess: vi.fn().mockResolvedValue(false),
    });

    const loop = new AutonomousLoop(store, deps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(uncappedTask);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Global max-iteration cap exceeded");

    const updated = store.getTask(uncappedTask.id);
    expect(updated!.status).toBe("failed");

    const logs = store.getExecutionLogs(uncappedTask.id);
    const capLog = logs.find((l) => l.message.includes("Global max-iteration cap exceeded"));
    expect(capLog).toBeDefined();
  });
});
