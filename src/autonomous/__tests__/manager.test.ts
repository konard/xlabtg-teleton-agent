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
});
