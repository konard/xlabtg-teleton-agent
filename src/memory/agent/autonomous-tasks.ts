import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

export type AutonomousTaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStrategy = "conservative" | "balanced" | "aggressive";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type ExecutionEventType =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "reflect"
  | "checkpoint"
  | "escalate"
  | "error"
  | "info";

export interface TaskConstraints {
  maxIterations?: number;
  maxDurationHours?: number;
  allowedTools?: string[];
  restrictedTools?: string[];
  budgetTON?: number;
}

export interface RetryPolicy {
  maxRetries: number;
  backoff: "linear" | "exponential";
}

export interface AutonomousTask {
  id: string;
  goal: string;
  successCriteria: string[];
  failureConditions: string[];
  constraints: TaskConstraints;
  strategy: TaskStrategy;
  retryPolicy: RetryPolicy;
  context: Record<string, unknown>;
  priority: TaskPriority;
  status: AutonomousTaskStatus;
  currentStep: number;
  lastCheckpointId?: string;
  createdAt: Date;
  updatedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  step: number;
  state: Record<string, unknown>;
  toolCalls: unknown[];
  nextActionHint?: string;
  createdAt: Date;
}

export interface ExecutionLogEntry {
  id: number;
  taskId: string;
  step: number;
  eventType: ExecutionEventType;
  message: string;
  data?: unknown;
  createdAt: Date;
}

interface AutonomousTaskRow {
  id: string;
  goal: string;
  success_criteria: string;
  failure_conditions: string;
  constraints: string;
  strategy: string;
  retry_policy: string;
  context: string;
  priority: string;
  status: string;
  current_step: number;
  last_checkpoint_id: string | null;
  created_at: number;
  updated_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
}

interface CheckpointRow {
  id: string;
  task_id: string;
  step: number;
  state: string;
  tool_calls: string;
  next_action_hint: string | null;
  created_at: number;
}

interface ExecutionLogRow {
  id: number;
  task_id: string;
  step: number;
  event_type: string;
  message: string;
  data: string | null;
  created_at: number;
}

function rowToTask(row: AutonomousTaskRow): AutonomousTask {
  return {
    id: row.id,
    goal: row.goal,
    successCriteria: JSON.parse(row.success_criteria) as string[],
    failureConditions: JSON.parse(row.failure_conditions) as string[],
    constraints: JSON.parse(row.constraints) as TaskConstraints,
    strategy: row.strategy as TaskStrategy,
    retryPolicy: JSON.parse(row.retry_policy) as RetryPolicy,
    context: JSON.parse(row.context) as Record<string, unknown>,
    priority: row.priority as TaskPriority,
    status: row.status as AutonomousTaskStatus,
    currentStep: row.current_step,
    lastCheckpointId: row.last_checkpoint_id ?? undefined,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: row.updated_at ? new Date(row.updated_at * 1000) : undefined,
    startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToCheckpoint(row: CheckpointRow): TaskCheckpoint {
  return {
    id: row.id,
    taskId: row.task_id,
    step: row.step,
    state: JSON.parse(row.state) as Record<string, unknown>,
    toolCalls: JSON.parse(row.tool_calls) as unknown[],
    nextActionHint: row.next_action_hint ?? undefined,
    createdAt: new Date(row.created_at * 1000),
  };
}

function rowToLogEntry(row: ExecutionLogRow): ExecutionLogEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    step: row.step,
    eventType: row.event_type as ExecutionEventType,
    message: row.message,
    data: row.data ? (JSON.parse(row.data) as unknown) : undefined,
    createdAt: new Date(row.created_at * 1000),
  };
}

export class AutonomousTaskStore {
  constructor(private db: Database.Database) {}

  createTask(input: {
    goal: string;
    successCriteria?: string[];
    failureConditions?: string[];
    constraints?: TaskConstraints;
    strategy?: TaskStrategy;
    retryPolicy?: RetryPolicy;
    context?: Record<string, unknown>;
    priority?: TaskPriority;
  }): AutonomousTask {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const retryPolicy: RetryPolicy = input.retryPolicy ?? { maxRetries: 3, backoff: "exponential" };

    this.db
      .prepare(
        `
      INSERT INTO autonomous_tasks (
        id, goal, success_criteria, failure_conditions, constraints,
        strategy, retry_policy, context, priority, status, current_step, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `
      )
      .run(
        id,
        input.goal,
        JSON.stringify(input.successCriteria ?? []),
        JSON.stringify(input.failureConditions ?? []),
        JSON.stringify(input.constraints ?? {}),
        input.strategy ?? "balanced",
        JSON.stringify(retryPolicy),
        JSON.stringify(input.context ?? {}),
        input.priority ?? "medium",
        now
      );

    return this.getTask(id)!;
  }

  getTask(id: string): AutonomousTask | undefined {
    const row = this.db
      .prepare(`SELECT * FROM autonomous_tasks WHERE id = ?`)
      .get(id) as AutonomousTaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  listTasks(filter?: {
    status?: AutonomousTaskStatus;
    priority?: TaskPriority;
  }): AutonomousTask[] {
    let sql = `SELECT * FROM autonomous_tasks WHERE 1=1`;
    const params: string[] = [];

    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    if (filter?.priority) {
      sql += ` AND priority = ?`;
      params.push(filter.priority);
    }

    sql += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as AutonomousTaskRow[];
    return rows.map(rowToTask);
  }

  getActiveTasks(): AutonomousTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM autonomous_tasks WHERE status IN ('pending', 'running', 'paused') ORDER BY created_at ASC`
      )
      .all() as AutonomousTaskRow[];
    return rows.map(rowToTask);
  }

  updateTaskStatus(
    id: string,
    status: AutonomousTaskStatus,
    opts?: { result?: string; error?: string }
  ): AutonomousTask | undefined {
    const now = Math.floor(Date.now() / 1000);
    const task = this.getTask(id);
    if (!task) return undefined;

    const fields: string[] = ["status = ?", "updated_at = ?"];
    const values: (string | number)[] = [status, now];

    if (status === "running" && !task.startedAt) {
      fields.push("started_at = ?");
      values.push(now);
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      fields.push("completed_at = ?");
      values.push(now);
    }
    if (opts?.result !== undefined) {
      fields.push("result = ?");
      values.push(opts.result);
    }
    if (opts?.error !== undefined) {
      fields.push("error = ?");
      values.push(opts.error);
    }

    values.push(id);
    this.db.prepare(`UPDATE autonomous_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getTask(id);
  }

  incrementStep(id: string): AutonomousTask | undefined {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE autonomous_tasks SET current_step = current_step + 1, updated_at = ? WHERE id = ?`
      )
      .run(now, id);
    return this.getTask(id);
  }

  updateLastCheckpoint(id: string, checkpointId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE autonomous_tasks SET last_checkpoint_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(checkpointId, now, id);
  }

  updateContext(id: string, context: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(`UPDATE autonomous_tasks SET context = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(context), now, id);
  }

  deleteTask(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM autonomous_tasks WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // Checkpoint methods

  saveCheckpoint(input: {
    taskId: string;
    step: number;
    state: Record<string, unknown>;
    toolCalls?: unknown[];
    nextActionHint?: string;
  }): TaskCheckpoint {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `INSERT INTO task_checkpoints (id, task_id, step, state, tool_calls, next_action_hint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.taskId,
        input.step,
        JSON.stringify(input.state),
        JSON.stringify(input.toolCalls ?? []),
        input.nextActionHint ?? null,
        now
      );

    this.updateLastCheckpoint(input.taskId, id);
    return this.getCheckpoint(id)!;
  }

  getCheckpoint(id: string): TaskCheckpoint | undefined {
    const row = this.db
      .prepare(`SELECT * FROM task_checkpoints WHERE id = ?`)
      .get(id) as CheckpointRow | undefined;
    return row ? rowToCheckpoint(row) : undefined;
  }

  getLastCheckpoint(taskId: string): TaskCheckpoint | undefined {
    const row = this.db
      .prepare(`SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY step DESC LIMIT 1`)
      .get(taskId) as CheckpointRow | undefined;
    return row ? rowToCheckpoint(row) : undefined;
  }

  cleanOldCheckpoints(olderThanDays = 7): number {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const result = this.db
      .prepare(
        `DELETE FROM task_checkpoints WHERE created_at < ?
         AND task_id NOT IN (SELECT id FROM autonomous_tasks WHERE status IN ('pending', 'running', 'paused'))`
      )
      .run(cutoff);
    return result.changes;
  }

  // Execution log methods

  appendLog(input: {
    taskId: string;
    step: number;
    eventType: ExecutionEventType;
    message: string;
    data?: unknown;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO execution_logs (task_id, step, event_type, message, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.taskId,
        input.step,
        input.eventType,
        input.message,
        input.data !== undefined ? JSON.stringify(input.data) : null,
        now
      );
  }

  getExecutionLogs(taskId: string, limit = 100): ExecutionLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM execution_logs WHERE task_id = ? ORDER BY id ASC LIMIT ?`
      )
      .all(taskId, limit) as ExecutionLogRow[];
    return rows.map(rowToLogEntry);
  }
}

const instances = new WeakMap<Database.Database, AutonomousTaskStore>();

export function getAutonomousTaskStore(db: Database.Database): AutonomousTaskStore {
  let store = instances.get(db);
  if (!store) {
    store = new AutonomousTaskStore(db);
    instances.set(db, store);
  }
  return store;
}
