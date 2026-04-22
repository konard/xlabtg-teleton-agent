import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import { AutonomousTaskManager } from "../manager.js";
import type { LoopDependencies, ToolExecutionResult } from "../loop.js";

function hangingDeps(): LoopDependencies {
  // Keep the loop "running" so we can observe state transitions without racing
  // the loop's own completion path.
  return {
    planNextAction: vi.fn().mockImplementation(() => new Promise(() => {})),
    executeTool: vi.fn().mockResolvedValue({ success: true, durationMs: 1 }),
    evaluateSuccess: vi.fn().mockResolvedValue(false),
    selfReflect: vi.fn().mockResolvedValue({ progressSummary: "", isStuck: false }),
    escalate: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Deps that let the test control when each in-flight step resolves — needed
 * to drive the pause-during-in-flight-step race (issue #266).
 */
function deferredExecDeps(): {
  deps: LoopDependencies;
  releaseExec: (v: ToolExecutionResult) => void;
  rejectExec: (err: Error) => void;
} {
  let release: (v: ToolExecutionResult) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const p = new Promise<ToolExecutionResult>((res, rej) => {
    release = res;
    reject = rej;
  });
  return {
    deps: {
      planNextAction: vi
        .fn()
        .mockResolvedValue({ toolName: "noop", params: {}, reasoning: "test" }),
      executeTool: vi.fn().mockImplementation(() => p),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
      selfReflect: vi.fn().mockResolvedValue({ progressSummary: "ok", isStuck: false }),
      escalate: vi.fn().mockResolvedValue(undefined),
    },
    releaseExec: (v) => release(v),
    rejectExec: (err) => reject(err),
  };
}

describe("AutonomousTaskManager", () => {
  let db: InstanceType<typeof Database>;
  let manager: AutonomousTaskManager;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    manager = new AutonomousTaskManager(db, hangingDeps());
  });

  afterEach(() => {
    manager.stopAll();
    db.close();
  });

  it("startTask() transitions a task from pending to running", async () => {
    const task = await manager.startTask({ goal: "Test goal" });

    // startTask returns the DB row synchronously (still 'pending'), but the
    // loop should flip it to 'running' on the next tick.
    await new Promise((r) => setTimeout(r, 20));
    const updated = getAutonomousTaskStore(db).getTask(task.id);
    expect(updated?.status).toBe("running");
    expect(manager.isTaskRunning(task.id)).toBe(true);
  });

  it("pauseTask() stops the running loop and releases the slot", async () => {
    const task = await manager.startTask({ goal: "Pausable" });
    await new Promise((r) => setTimeout(r, 20));

    manager.pauseTask(task.id);

    expect(manager.isTaskRunning(task.id)).toBe(false);
    const after = getAutonomousTaskStore(db).getTask(task.id);
    expect(after?.status).toBe("paused");
  });

  it("resumeTask() re-starts the loop for a paused task", async () => {
    const task = await manager.startTask({ goal: "Resumable" });
    await new Promise((r) => setTimeout(r, 20));
    manager.pauseTask(task.id);
    expect(manager.isTaskRunning(task.id)).toBe(false);

    manager.resumeTask(task.id);
    await new Promise((r) => setTimeout(r, 20));

    expect(manager.isTaskRunning(task.id)).toBe(true);
    const after = getAutonomousTaskStore(db).getTask(task.id);
    expect(after?.status).toBe("running");
  });

  it("restoreInterruptedTasks() starts tasks queued while the agent was down", async () => {
    // Simulate a CLI-created task: inserted directly in the store, status='pending'.
    const store = getAutonomousTaskStore(db);
    const queued = store.createTask({ goal: "Queued from CLI" });
    expect(queued.status).toBe("pending");

    const restored = await manager.restoreInterruptedTasks();
    expect(restored).toBe(1);

    await new Promise((r) => setTimeout(r, 20));
    const after = store.getTask(queued.id);
    expect(after?.status).toBe("running");
    expect(manager.isTaskRunning(queued.id)).toBe(true);
  });

  it("restoreInterruptedTasks() resumes a task interrupted mid-run", async () => {
    // Simulate a crash: task has status='running' but no loop is tracking it.
    const store = getAutonomousTaskStore(db);
    const wip = store.createTask({ goal: "Crashed mid-run" });
    store.updateTaskStatus(wip.id, "running");

    const restored = await manager.restoreInterruptedTasks();
    expect(restored).toBe(1);
    expect(manager.isTaskRunning(wip.id)).toBe(true);
  });

  // ─── Regression: issue #256 ────────────────────────────────────────────────
  // Pause + resume must not reset the PolicyEngine rate-limit / uncertainty /
  // loop-detection state. The legacy bug (AUDIT-C3) was that runLoop() always
  // constructed a fresh PolicyEngine, giving anyone who could trigger
  // pause/resume a trivial bypass of the 100 tool-calls-per-hour limit.

  it("pause + resume rehydrates policy_state from storage (issue #256)", async () => {
    const store = getAutonomousTaskStore(db);
    const task = await manager.startTask({ goal: "state must persist" });
    await new Promise((r) => setTimeout(r, 20));

    // Pre-seed the persisted state so the rehydrated loop picks it up.
    const seeded = {
      toolCallTimestamps: [Date.now(), Date.now(), Date.now()],
      apiCallTimestamps: [Date.now()],
      consecutiveUncertainCount: 2,
      recentActions: ["web_fetch", "web_fetch", "web_fetch"],
    };
    store.savePolicyState(task.id, seeded);

    manager.pauseTask(task.id);
    manager.resumeTask(task.id);
    await new Promise((r) => setTimeout(r, 20));

    // After resume the loop should have hydrated the state AND overwritten
    // the snapshot with its own updates. The key invariant is that the
    // pre-seeded windows are NOT wiped to empty by the resume.
    const persisted = store.getPolicyState(task.id) as
      | {
          toolCallTimestamps?: number[];
          apiCallTimestamps?: number[];
          consecutiveUncertainCount?: number;
          recentActions?: string[];
        }
      | undefined;

    expect(persisted).toBeDefined();
    // The resumed loop immediately calls recordApiCall() inside planNextAction,
    // so apiCallTimestamps should contain at least the seeded entry plus any
    // additions. It must never shrink below the seeded count.
    expect((persisted?.apiCallTimestamps ?? []).length).toBeGreaterThanOrEqual(1);
    // consecutiveUncertainCount: the resumed loop won't run selfReflect until
    // at least one step completes, so the hydrated value of 2 must still be
    // present (or reset via resetUncertainCount only if reflection said
    // not-stuck). With hanging planNextAction the loop never reaches
    // reflection, so the counter stays at 2.
    expect(persisted?.consecutiveUncertainCount).toBe(2);
  });

  // ─── AUDIT-H4: pauseTask() race with in-flight executeTool ────────────────

  it("pauseTask() during in-flight executeTool keeps status 'paused' when the tool resolves late (AUDIT-H4)", async () => {
    const { deps, releaseExec } = deferredExecDeps();
    const raceManager = new AutonomousTaskManager(db, deps);
    const task = await raceManager.startTask({ goal: "Race pause vs exec" });

    // Give the loop time to reach `await executeTool(...)`.
    await new Promise((r) => setTimeout(r, 20));

    const store = getAutonomousTaskStore(db);
    expect(store.getTask(task.id)?.status).toBe("running");

    raceManager.pauseTask(task.id);

    // Simulate the in-flight tool finishing *after* pauseTask() wrote 'paused'.
    releaseExec({ success: true, data: "late", durationMs: 1 });

    // Give the loop's finally/post-await code a chance to run.
    await new Promise((r) => setTimeout(r, 30));

    expect(store.getTask(task.id)?.status).toBe("paused");
    expect(raceManager.isTaskRunning(task.id)).toBe(false);
  });

  it("pauseTask() during in-flight executeTool keeps status 'paused' when the tool rejects late (AUDIT-H4)", async () => {
    const { deps, rejectExec } = deferredExecDeps();
    const raceManager = new AutonomousTaskManager(db, deps);
    const task = await raceManager.startTask({ goal: "Race pause vs exec-err" });

    await new Promise((r) => setTimeout(r, 20));
    raceManager.pauseTask(task.id);

    rejectExec(new Error("late tool failure"));
    await new Promise((r) => setTimeout(r, 30));

    const store = getAutonomousTaskStore(db);
    const after = store.getTask(task.id);
    expect(after?.status).toBe("paused");
    expect(after?.error).toBeUndefined();
  });

  it("stopTask() during in-flight step preserves 'cancelled' even when tool resolves late (AUDIT-H4)", async () => {
    const { deps, releaseExec } = deferredExecDeps();
    const raceManager = new AutonomousTaskManager(db, deps);
    const task = await raceManager.startTask({ goal: "Race stop vs exec" });

    await new Promise((r) => setTimeout(r, 20));
    raceManager.stopTask(task.id);

    releaseExec({ success: true, durationMs: 1 });
    await new Promise((r) => setTimeout(r, 30));

    const store = getAutonomousTaskStore(db);
    expect(store.getTask(task.id)?.status).toBe("cancelled");
  });

  describe("stopAllAndWait() — AUDIT-C2 shutdown leak", () => {
    /**
     * Build deps whose `planNextAction` blocks on a caller-controlled promise.
     * Lets tests hold the loop in a predictable "running, waiting on the
     * planner" state and then release the in-flight step after stop() — the
     * exact shape of the shutdown race described in AUDIT-C2.
     */
    function gatedDeps(gate: Promise<unknown>): LoopDependencies {
      return {
        planNextAction: vi.fn().mockImplementation(async () => {
          await gate;
          return { toolName: "noop", params: {}, reasoning: "drain", confidence: 1 };
        }),
        executeTool: vi.fn().mockResolvedValue({ success: true, durationMs: 1 }),
        evaluateSuccess: vi.fn().mockResolvedValue(false),
        selfReflect: vi.fn().mockResolvedValue({ progressSummary: "", isStuck: false }),
        escalate: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("waits for in-flight loop promises to settle before resolving", async () => {
      let release: ((v: unknown) => void) | undefined;
      const gate = new Promise((r) => {
        release = r;
      });
      const localManager = new AutonomousTaskManager(db, gatedDeps(gate));

      const task1 = await localManager.startTask({ goal: "Task 1" });
      const task2 = await localManager.startTask({ goal: "Task 2" });
      await new Promise((r) => setTimeout(r, 20));

      expect(localManager.isTaskRunning(task1.id)).toBe(true);
      expect(localManager.isTaskRunning(task2.id)).toBe(true);

      // Start shutdown, then release the in-flight planner so the loop
      // wakes up, sees the abort signal, and its `.finally()` runs.
      const stopPromise = localManager.stopAllAndWait();
      release?.(undefined);
      await stopPromise;

      expect(localManager.isTaskRunning(task1.id)).toBe(false);
      expect(localManager.isTaskRunning(task2.id)).toBe(false);
      expect(localManager.getRunningTaskIds()).toHaveLength(0);
    });

    it("no SQLite writes happen after stopAllAndWait() resolves — safe to close the DB", async () => {
      const localDb = new Database(":memory:");
      localDb.pragma("foreign_keys = ON");
      ensureSchema(localDb);

      let release: ((v: unknown) => void) | undefined;
      const gate = new Promise((r) => {
        release = r;
      });
      const localManager = new AutonomousTaskManager(localDb, gatedDeps(gate));

      await localManager.startTask({ goal: "Shutdown-race test" });
      await new Promise((r) => setTimeout(r, 20));

      const stopPromise = localManager.stopAllAndWait();
      // Release the in-flight planner *after* stop() — the loop must not
      // continue writing to the DB once abort has been observed.
      release?.(undefined);
      await stopPromise;

      // Closing the DB must not throw; no async loop iteration should be
      // trying to write after stopAllAndWait() resolved.
      expect(() => localDb.close()).not.toThrow();
    });

    it("restart scenario: after stopAllAndWait() the old loop is gone", async () => {
      let release1: ((v: unknown) => void) | undefined;
      const gate1 = new Promise((r) => {
        release1 = r;
      });
      const localManager = new AutonomousTaskManager(db, gatedDeps(gate1));

      const first = await localManager.startTask({ goal: "Old cycle" });
      await new Promise((r) => setTimeout(r, 20));
      expect(localManager.isTaskRunning(first.id)).toBe(true);

      const stopPromise = localManager.stopAllAndWait();
      release1?.(undefined);
      await stopPromise;

      // Old loop is fully drained — running map is empty.
      expect(localManager.getRunningTaskIds()).toHaveLength(0);
      expect(localManager.isTaskRunning(first.id)).toBe(false);
    });

    it("is a no-op when no loops are running", async () => {
      await expect(manager.stopAllAndWait()).resolves.toBeUndefined();
    });
  });
});
