import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../memory/schema.js";
import { getTaskStore, type TaskStore } from "../../../memory/agent/tasks.js";
import { getTaskDelegationStore, type TaskDelegationStore } from "../store.js";

function createDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

describe("TaskDelegationStore", () => {
  let db: InstanceType<typeof Database>;
  let tasks: TaskStore;
  let delegations: TaskDelegationStore;

  beforeEach(() => {
    db = createDb();
    tasks = getTaskStore(db);
    delegations = getTaskDelegationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a task tree with dependency links", () => {
    const task = tasks.createTask({ description: "Ship a researched implementation" });
    const subtasks = delegations.createSubtasks(task.id, [
      {
        planId: "research",
        description: "Research the API behavior",
        requiredSkills: ["research"],
        requiredTools: ["web_search"],
      },
      {
        planId: "implement",
        description: "Implement the code path",
        requiredSkills: ["code"],
        requiredTools: ["workspace_write"],
        dependsOn: ["research"],
      },
    ]);

    expect(subtasks).toHaveLength(2);
    expect(subtasks[1].dependencies).toEqual([subtasks[0].id]);

    const tree = delegations.getTaskTree(task.id);
    expect(tree.subtasks.map((subtask) => subtask.description)).toEqual([
      "Research the API behavior",
      "Implement the code path",
    ]);
    expect(tree.timeline.map((event) => event.type)).toContain("created");
  });

  it("enforces the three-level nesting limit", () => {
    const task = tasks.createTask({ description: "Deep work" });
    const [levelOne] = delegations.createSubtasks(task.id, [{ description: "level 1" }]);
    const [levelTwo] = delegations.createSubtasks(task.id, [{ description: "level 2" }], {
      parentId: levelOne.id,
    });
    delegations.createSubtasks(task.id, [{ description: "level 3" }], {
      parentId: levelTwo.id,
    });

    expect(() =>
      delegations.createSubtasks(task.id, [{ description: "level 4" }], {
        parentId: delegations.listSubtasks(task.id).find((subtask) => subtask.depth === 3)?.id,
      })
    ).toThrow("maximum delegation depth");
  });

  it("assigns and retries failed subtasks without losing the selected agent", () => {
    const task = tasks.createTask({ description: "Debug production failure" });
    const [subtask] = delegations.createSubtasks(task.id, [
      { description: "Inspect logs", requiredSkills: ["monitoring"] },
    ]);

    const assigned = delegations.assignSubtask(subtask.id, "monitor-agent");
    expect(assigned.status).toBe("delegated");
    expect(assigned.agentId).toBe("monitor-agent");

    delegations.updateSubtask(subtask.id, { status: "failed", error: "timeout" });
    const retried = delegations.retrySubtask(task.id, subtask.id);

    expect(retried.status).toBe("delegated");
    expect(retried.agentId).toBe("monitor-agent");
    expect(retried.error).toBeUndefined();
  });
});
