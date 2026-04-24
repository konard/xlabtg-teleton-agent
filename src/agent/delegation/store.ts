import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  SUBTASK_STATUSES,
  type CreateSubtaskOptions,
  type DelegationTimelineEvent,
  type SubtaskPlan,
  type SubtaskStatus,
  type TaskDelegationTree,
  type TaskSubtask,
  type TaskSubtaskNode,
} from "./types.js";

const MAX_DELEGATION_DEPTH = 3;

interface SubtaskRow {
  id: string;
  task_id: string;
  parent_id: string | null;
  description: string;
  required_skills: string;
  required_tools: string;
  agent_id: string | null;
  status: string;
  result: string | null;
  error: string | null;
  depth: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface AgentPerformanceRow {
  agent_id: string;
  done_count: number;
  failed_count: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeStringArray(input?: string[]): string[] {
  if (!input) return [];
  return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
}

function statusIsValid(status: string): status is SubtaskStatus {
  return SUBTASK_STATUSES.includes(status as SubtaskStatus);
}

function rowToSubtask(row: SubtaskRow, dependencies: string[]): TaskSubtask {
  return {
    id: row.id,
    taskId: row.task_id,
    parentId: row.parent_id ?? undefined,
    description: row.description,
    requiredSkills: parseStringArray(row.required_skills),
    requiredTools: parseStringArray(row.required_tools),
    agentId: row.agent_id ?? undefined,
    status: statusIsValid(row.status) ? row.status : "pending",
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    depth: row.depth,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
    startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
    dependencies,
  };
}

export class TaskDelegationStore {
  constructor(private db: Database.Database) {}

  createSubtasks(
    taskId: string,
    plans: SubtaskPlan[],
    options: CreateSubtaskOptions = {}
  ): TaskSubtask[] {
    if (!this.taskExists(taskId)) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (plans.length === 0) return [];

    const parent = options.parentId ? this.getSubtask(options.parentId) : undefined;
    if (options.parentId && !parent) {
      throw new Error(`Parent subtask not found: ${options.parentId}`);
    }
    if (parent && parent.taskId !== taskId) {
      throw new Error("Parent subtask belongs to a different task");
    }

    const depth = parent ? parent.depth + 1 : 1;
    if (depth > MAX_DELEGATION_DEPTH) {
      throw new Error(
        `Cannot create subtasks deeper than maximum delegation depth ${MAX_DELEGATION_DEPTH}`
      );
    }

    const createdIds: string[] = [];
    const planIdToSubtaskId = new Map<string, string>();
    const now = nowSeconds();

    const create = this.db.transaction(() => {
      plans.forEach((plan, index) => {
        const description = plan.description.trim();
        if (!description) {
          throw new Error("Subtask description is required");
        }

        const id = randomUUID();
        const agentId = plan.agentId?.trim() || null;
        const status: SubtaskStatus = agentId ? "delegated" : "pending";
        this.db
          .prepare(
            `
              INSERT INTO task_subtasks (
                id, task_id, parent_id, description, required_skills, required_tools,
                agent_id, status, depth, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            id,
            taskId,
            parent?.id ?? null,
            description,
            JSON.stringify(normalizeStringArray(plan.requiredSkills)),
            JSON.stringify(normalizeStringArray(plan.requiredTools)),
            agentId,
            status,
            depth,
            now,
            now
          );

        createdIds.push(id);
        planIdToSubtaskId.set(String(index), id);
        planIdToSubtaskId.set(String(index + 1), id);
        if (plan.planId?.trim()) {
          planIdToSubtaskId.set(plan.planId.trim(), id);
        }
      });

      plans.forEach((plan, index) => {
        const subtaskId = createdIds[index];
        if (!subtaskId) {
          throw new Error(`Subtask creation failed at index ${index}`);
        }
        for (const dependencyRef of plan.dependsOn ?? []) {
          const dependencyId = planIdToSubtaskId.get(dependencyRef) ?? dependencyRef;
          this.addDependency(subtaskId, dependencyId);
        }
      });
    });

    create();
    return createdIds
      .map((id) => this.getSubtask(id))
      .filter((subtask): subtask is TaskSubtask => Boolean(subtask));
  }

  getSubtask(subtaskId: string): TaskSubtask | undefined {
    const row = this.db.prepare(`SELECT * FROM task_subtasks WHERE id = ?`).get(subtaskId) as
      | SubtaskRow
      | undefined;
    if (!row) return undefined;
    return rowToSubtask(row, this.getDependencies(subtaskId));
  }

  listSubtasks(taskId: string): TaskSubtask[] {
    const rows = this.db
      .prepare(
        `
          SELECT * FROM task_subtasks
          WHERE task_id = ?
          ORDER BY depth ASC, created_at ASC, rowid ASC
        `
      )
      .all(taskId) as SubtaskRow[];
    const dependencyMap = this.getDependencyMap(taskId);
    return rows.map((row) => rowToSubtask(row, dependencyMap.get(row.id) ?? []));
  }

  assignSubtask(subtaskId: string, agentId: string): TaskSubtask {
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      throw new Error("Agent id is required");
    }
    return this.updateSubtask(subtaskId, {
      agentId: normalizedAgentId,
      status: "delegated",
      error: null,
    });
  }

  updateSubtask(
    subtaskId: string,
    updates: {
      description?: string;
      requiredSkills?: string[];
      requiredTools?: string[];
      agentId?: string | null;
      status?: SubtaskStatus;
      result?: string | null;
      error?: string | null;
    }
  ): TaskSubtask {
    const existing = this.getSubtask(subtaskId);
    if (!existing) {
      throw new Error(`Subtask not found: ${subtaskId}`);
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const now = nowSeconds();

    if (updates.description !== undefined) {
      const description = updates.description.trim();
      if (!description) throw new Error("Subtask description is required");
      fields.push("description = ?");
      values.push(description);
    }
    if (updates.requiredSkills !== undefined) {
      fields.push("required_skills = ?");
      values.push(JSON.stringify(normalizeStringArray(updates.requiredSkills)));
    }
    if (updates.requiredTools !== undefined) {
      fields.push("required_tools = ?");
      values.push(JSON.stringify(normalizeStringArray(updates.requiredTools)));
    }
    if (updates.agentId !== undefined) {
      fields.push("agent_id = ?");
      values.push(updates.agentId?.trim() || null);
    }
    if (updates.status !== undefined) {
      if (!statusIsValid(updates.status)) {
        throw new Error(`Invalid subtask status: ${updates.status}`);
      }
      fields.push("status = ?");
      values.push(updates.status);
      if (updates.status === "in_progress" && !existing.startedAt) {
        fields.push("started_at = ?");
        values.push(now);
      }
      if (["done", "failed", "cancelled"].includes(updates.status) && !existing.completedAt) {
        fields.push("completed_at = ?");
        values.push(now);
      }
    }
    if (updates.result !== undefined) {
      fields.push("result = ?");
      values.push(updates.result);
    }
    if (updates.error !== undefined) {
      fields.push("error = ?");
      values.push(updates.error);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = ?");
    values.push(now, subtaskId);

    this.db
      .prepare(
        `
          UPDATE task_subtasks
          SET ${fields.join(", ")}
          WHERE id = ?
        `
      )
      .run(...values);

    const updated = this.getSubtask(subtaskId);
    if (!updated) {
      throw new Error(`Subtask disappeared during update: ${subtaskId}`);
    }
    return updated;
  }

  retrySubtask(taskId: string, subtaskId: string): TaskSubtask {
    const existing = this.getSubtask(subtaskId);
    if (!existing || existing.taskId !== taskId) {
      throw new Error(`Subtask not found: ${subtaskId}`);
    }

    const nextStatus: SubtaskStatus = existing.agentId ? "delegated" : "pending";
    const now = nowSeconds();
    this.db
      .prepare(
        `
          UPDATE task_subtasks
          SET status = ?, result = NULL, error = NULL, started_at = NULL,
              completed_at = NULL, updated_at = ?
          WHERE id = ?
        `
      )
      .run(nextStatus, now, subtaskId);

    const updated = this.getSubtask(subtaskId);
    if (!updated) {
      throw new Error(`Subtask disappeared during retry: ${subtaskId}`);
    }
    return updated;
  }

  getTaskTree(taskId: string): TaskDelegationTree {
    const subtasks = this.listSubtasks(taskId);
    const byId = new Map<string, TaskSubtaskNode>();
    for (const subtask of subtasks) {
      byId.set(subtask.id, { ...subtask, children: [] });
    }

    const roots: TaskSubtaskNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return {
      taskId,
      subtasks,
      roots,
      timeline: this.buildTimeline(subtasks),
    };
  }

  getAgentPerformance(): Map<string, number> {
    const rows = this.db
      .prepare(
        `
          SELECT
            agent_id,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
          FROM task_subtasks
          WHERE agent_id IS NOT NULL
          GROUP BY agent_id
        `
      )
      .all() as AgentPerformanceRow[];

    const rates = new Map<string, number>();
    for (const row of rows) {
      const total = row.done_count + row.failed_count;
      if (total > 0) {
        rates.set(row.agent_id, row.done_count / total);
      }
    }
    return rates;
  }

  private taskExists(taskId: string): boolean {
    const row = this.db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(taskId);
    return Boolean(row);
  }

  private getDependencies(subtaskId: string): string[] {
    const rows = this.db
      .prepare(
        `
          SELECT depends_on_subtask_id
          FROM task_subtask_dependencies
          WHERE subtask_id = ?
          ORDER BY depends_on_subtask_id ASC
        `
      )
      .all(subtaskId) as Array<{ depends_on_subtask_id: string }>;
    return rows.map((row) => row.depends_on_subtask_id);
  }

  private getDependencyMap(taskId: string): Map<string, string[]> {
    const rows = this.db
      .prepare(
        `
          SELECT d.subtask_id, d.depends_on_subtask_id
          FROM task_subtask_dependencies d
          JOIN task_subtasks s ON s.id = d.subtask_id
          WHERE s.task_id = ?
          ORDER BY d.depends_on_subtask_id ASC
        `
      )
      .all(taskId) as Array<{ subtask_id: string; depends_on_subtask_id: string }>;

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const deps = map.get(row.subtask_id) ?? [];
      deps.push(row.depends_on_subtask_id);
      map.set(row.subtask_id, deps);
    }
    return map;
  }

  private addDependency(subtaskId: string, dependencyId: string): void {
    const subtask = this.getSubtask(subtaskId);
    const dependency = this.getSubtask(dependencyId);
    if (!subtask || !dependency) {
      throw new Error(`Unknown subtask dependency: ${dependencyId}`);
    }
    if (subtask.taskId !== dependency.taskId) {
      throw new Error("Subtask dependencies must belong to the same task");
    }
    if (this.wouldCreateCycle(subtaskId, dependencyId)) {
      throw new Error(`Cannot add subtask dependency: would create circular dependency`);
    }
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO task_subtask_dependencies (subtask_id, depends_on_subtask_id)
          VALUES (?, ?)
        `
      )
      .run(subtaskId, dependencyId);
  }

  private wouldCreateCycle(subtaskId: string, dependencyId: string): boolean {
    if (subtaskId === dependencyId) return true;

    const visited = new Set<string>();
    const queue = [dependencyId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current === subtaskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...this.getDependencies(current));
    }
    return false;
  }

  private buildTimeline(subtasks: TaskSubtask[]): DelegationTimelineEvent[] {
    const events: DelegationTimelineEvent[] = [];
    for (const subtask of subtasks) {
      events.push({
        id: `${subtask.id}:created`,
        type: "created",
        subtaskId: subtask.id,
        subtaskDescription: subtask.description,
        at: subtask.createdAt,
        message: `Created subtask "${subtask.description}"`,
      });
      if (subtask.agentId) {
        events.push({
          id: `${subtask.id}:delegated`,
          type: "delegated",
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          agentId: subtask.agentId,
          at: subtask.updatedAt,
          message: `Delegated to ${subtask.agentId}`,
        });
      }
      if (subtask.startedAt) {
        events.push({
          id: `${subtask.id}:started`,
          type: "started",
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          agentId: subtask.agentId,
          at: subtask.startedAt,
          message: `Started "${subtask.description}"`,
        });
      }
      if (subtask.completedAt && ["done", "failed", "cancelled"].includes(subtask.status)) {
        events.push({
          id: `${subtask.id}:${subtask.status}`,
          type:
            subtask.status === "done"
              ? "completed"
              : subtask.status === "failed"
                ? "failed"
                : "cancelled",
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          agentId: subtask.agentId,
          at: subtask.completedAt,
          message: `${subtask.status === "done" ? "Completed" : subtask.status} "${subtask.description}"`,
        });
      }
    }

    return events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  }
}

const instances = new WeakMap<Database.Database, TaskDelegationStore>();

export function getTaskDelegationStore(db: Database.Database): TaskDelegationStore {
  let store = instances.get(db);
  if (!store) {
    store = new TaskDelegationStore(db);
    instances.set(db, store);
  }
  return store;
}
