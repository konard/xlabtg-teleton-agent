import { describe, it, expect, vi, afterEach } from "vitest";
import { deps_planWithTimeout } from "../loop.js";
import type { LoopDependencies, PlannedAction } from "../loop.js";
import type { AutonomousTask } from "../../memory/agent/autonomous-tasks.js";

function makeTask(): AutonomousTask {
  return {
    id: "t1",
    goal: "goal",
    status: "pending",
    currentStep: 0,
    context: {},
    constraints: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as AutonomousTask;
}

function makeDeps(plan: LoopDependencies["planNextAction"]): LoopDependencies {
  return {
    planNextAction: plan,
    executeTool: vi.fn(),
    evaluateSuccess: vi.fn(),
    selfReflect: vi.fn(),
    escalate: vi.fn(),
  };
}

describe("deps_planWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves with the planned action when planNextAction resolves first", async () => {
    const action: PlannedAction = { toolName: "noop", params: {} };
    const deps = makeDeps(vi.fn().mockResolvedValue(action));

    const result = await deps_planWithTimeout(deps, makeTask(), []);

    expect(result).toBe(action);
  });

  it("clears the pending timer after a successful resolve (no leak)", async () => {
    vi.useFakeTimers();
    const action: PlannedAction = { toolName: "noop", params: {} };
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const deps = makeDeps(vi.fn().mockResolvedValue(action));

    // Run 100 successful plans
    for (let i = 0; i < 100; i++) {
      await deps_planWithTimeout(deps, makeTask(), []);
    }

    // Every successful call must clear its timer
    expect(clearSpy).toHaveBeenCalledTimes(100);

    // No pending planning timers should remain: advancing past the timeout
    // must NOT trigger any unhandled rejections / side effects.
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it("clears the timer when planNextAction rejects", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const deps = makeDeps(vi.fn().mockRejectedValue(new Error("boom")));

    await expect(deps_planWithTimeout(deps, makeTask(), [])).rejects.toThrow("boom");

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects with a timeout error when planNextAction is slow", async () => {
    vi.useFakeTimers();
    const deps = makeDeps(vi.fn().mockImplementation(() => new Promise(() => {})));

    const promise = deps_planWithTimeout(deps, makeTask(), []);
    const expectation = expect(promise).rejects.toThrow("Planning timed out after 30s");

    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
  });
});
