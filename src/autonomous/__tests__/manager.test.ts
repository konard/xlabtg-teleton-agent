import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import { AutonomousTaskManager } from "../manager.js";
import type { LoopDependencies } from "../loop.js";

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
});
