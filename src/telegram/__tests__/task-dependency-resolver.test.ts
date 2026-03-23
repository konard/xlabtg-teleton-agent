import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskDependencyResolver } from "../task-dependency-resolver.js";
import type { Task, TaskStore, TaskStatus } from "../../memory/agent/tasks.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../constants/timeouts.js", () => ({
  BATCH_TRIGGER_DELAY_MS: 0, // no delay in tests
}));

vi.mock("../../constants/limits.js", () => ({
  MAX_DEPENDENTS_PER_TASK: 10,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(id: string, status: TaskStatus = "pending", payload?: string): Task {
  return {
    id,
    description: `Task ${id}`,
    status,
    priority: 0,
    createdAt: new Date(),
    payload,
  };
}

function makeTaskStore(tasks: Record<string, Task> = {}): TaskStore {
  return {
    getTask: vi.fn((id: string) => tasks[id]),
    getDependents: vi.fn(() => []),
    canExecute: vi.fn(() => true),
    cancelTask: vi.fn((id: string) => {
      if (tasks[id]) tasks[id] = { ...tasks[id], status: "cancelled" };
      return tasks[id];
    }),
    failTask: vi.fn((id: string, error: string) => {
      if (tasks[id]) tasks[id] = { ...tasks[id], status: "failed", error };
      return tasks[id];
    }),
  } as any;
}

function makeBridge() {
  const gramJsClient = {
    getMe: vi.fn().mockResolvedValue({ id: 123 }),
    sendMessage: vi.fn().mockResolvedValue({}),
  };
  return {
    getClient: vi.fn(() => ({
      getClient: vi.fn(() => gramJsClient),
    })),
    _gramJsClient: gramJsClient,
  } as any;
}

// ── TaskDependencyResolver Tests ──────────────────────────────────────────────

describe("TaskDependencyResolver", () => {
  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    bridge = makeBridge();
  });

  // ── onTaskComplete ────────────────────────────────────────────────────────

  describe("onTaskComplete()", () => {
    it("does nothing when task has no dependents", async () => {
      const tasks = { "task-a": makeTask("task-a", "done") };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskComplete("task-a");

      expect(bridge._gramJsClient.sendMessage).not.toHaveBeenCalled();
    });

    it("triggers a dependent task when all its dependencies are done", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "done"),
        "child-1": makeTask("child-1", "pending"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue(["child-1"]);
      (taskStore.canExecute as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskComplete("parent-1");

      expect(bridge._gramJsClient.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: expect.stringContaining("[TASK:child-1]") })
      );
    });

    it("does not trigger a dependent that is already in_progress", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "done"),
        "child-1": makeTask("child-1", "in_progress"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue(["child-1"]);

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskComplete("parent-1");

      expect(bridge._gramJsClient.sendMessage).not.toHaveBeenCalled();
    });

    it("does not trigger dependent when its other dependencies are not done", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "done"),
        "child-1": makeTask("child-1", "pending"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue(["child-1"]);
      (taskStore.canExecute as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskComplete("parent-1");

      expect(bridge._gramJsClient.sendMessage).not.toHaveBeenCalled();
    });

    it("marks task as failed if trigger sendMessage throws", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "done"),
        "child-1": makeTask("child-1", "pending"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue(["child-1"]);
      (taskStore.canExecute as ReturnType<typeof vi.fn>).mockReturnValue(true);
      bridge._gramJsClient.sendMessage.mockRejectedValueOnce(new Error("network error"));

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskComplete("parent-1");

      expect(taskStore.failTask).toHaveBeenCalledWith(
        "child-1",
        expect.stringContaining("Failed to trigger")
      );
    });
  });

  // ── onTaskFail ────────────────────────────────────────────────────────────

  describe("onTaskFail()", () => {
    it("does nothing when failed task has no dependents", async () => {
      const tasks = { "task-a": makeTask("task-a", "failed") };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskFail("task-a");

      expect(taskStore.cancelTask).not.toHaveBeenCalled();
    });

    it("cancels dependent tasks when parent fails (default skipOnParentFailure=true)", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "failed"),
        "child-1": makeTask("child-1", "pending"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
        id === "parent-1" ? ["child-1"] : []
      );

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskFail("parent-1");

      expect(taskStore.cancelTask).toHaveBeenCalledWith("child-1");
    });

    it("does not cancel dependent when skipOnParentFailure=false", async () => {
      const payload = JSON.stringify({
        type: "agent_task",
        instructions: "x",
        skipOnParentFailure: false,
      });
      const tasks = {
        "parent-1": makeTask("parent-1", "failed"),
        "child-1": makeTask("child-1", "pending", payload),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
        id === "parent-1" ? ["child-1"] : []
      );

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskFail("parent-1");

      expect(taskStore.cancelTask).not.toHaveBeenCalled();
    });

    it("skips already-completed dependents", async () => {
      const tasks = {
        "parent-1": makeTask("parent-1", "failed"),
        "child-done": makeTask("child-done", "done"),
      };
      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
        id === "parent-1" ? ["child-done"] : []
      );

      const resolver = new TaskDependencyResolver(taskStore, bridge);
      await resolver.onTaskFail("parent-1");

      expect(taskStore.cancelTask).not.toHaveBeenCalled();
    });

    it("stops cascade at MAX_CASCADE_DEPTH to prevent infinite recursion", async () => {
      // Build a long chain: a→b→c→...→z (21 tasks) to trigger the depth limit
      const tasks: Record<string, Task> = {};
      const ids: string[] = [];
      for (let i = 0; i < 22; i++) {
        const id = `task-${i}`;
        ids.push(id);
        tasks[id] = makeTask(id, i === 0 ? "failed" : "pending");
      }

      const taskStore = makeTaskStore(tasks);
      (taskStore.getDependents as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        const idx = ids.indexOf(id);
        if (idx >= 0 && idx < ids.length - 1) {
          return [ids[idx + 1]];
        }
        return [];
      });

      const resolver = new TaskDependencyResolver(taskStore, bridge);

      // Should not throw or recurse infinitely
      await expect(resolver.onTaskFail(ids[0])).resolves.toBeUndefined();

      // Should have cancelled some tasks but stopped at the depth limit (20)
      const cancelCalls = (taskStore.cancelTask as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(cancelCalls).toBeLessThanOrEqual(20);
    });
  });
});
