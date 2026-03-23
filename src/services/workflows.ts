import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// ── Workflow config types ───────────────────────────────────────────────────

export type TriggerType = "cron" | "webhook" | "event";
export type ActionType = "send_message" | "call_api" | "set_variable";

export interface CronTrigger {
  type: "cron";
  /** Cron expression, e.g. "0 9 * * 1" (every Monday at 9am) */
  cron: string;
  /** Human-readable label, e.g. "Every Monday at 9:00 UTC" */
  label?: string;
}

export interface WebhookTrigger {
  type: "webhook";
  /** Auto-generated webhook secret token */
  secret?: string;
}

export interface EventTrigger {
  type: "event";
  /** Event name: "agent.start" | "agent.stop" | "agent.error" | "tool.complete" */
  event: string;
}

export type WorkflowTrigger = CronTrigger | WebhookTrigger | EventTrigger;

export interface SendMessageAction {
  type: "send_message";
  /** Telegram chat ID or username */
  chatId: string;
  /** Message text (supports simple {{variable}} interpolation) */
  text: string;
}

export interface CallApiAction {
  type: "call_api";
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Full URL */
  url: string;
  /** Optional request headers */
  headers?: Record<string, string>;
  /** Optional request body (JSON string) */
  body?: string;
}

export interface SetVariableAction {
  type: "set_variable";
  /** Variable name */
  name: string;
  /** Variable value */
  value: string;
}

export type WorkflowAction = SendMessageAction | CallApiAction | SetVariableAction;

export interface WorkflowConfig {
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
}

// ── Workflow entity ─────────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  config: WorkflowConfig;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  runCount: number;
  lastError: string | null;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  config: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  run_count: number;
  last_error: string | null;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    config: JSON.parse(row.config) as WorkflowConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
    lastError: row.last_error,
  };
}

// ── WorkflowStore ───────────────────────────────────────────────────────────

export class WorkflowStore {
  constructor(private db: Database.Database) {}

  list(): Workflow[] {
    const rows = this.db
      .prepare("SELECT * FROM workflows ORDER BY created_at DESC")
      .all() as WorkflowRow[];
    return rows.map(rowToWorkflow);
  }

  get(id: string): Workflow | null {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as
      | WorkflowRow
      | undefined;
    return row ? rowToWorkflow(row) : null;
  }

  create(data: {
    name: string;
    description?: string;
    enabled?: boolean;
    config: WorkflowConfig;
  }): Workflow {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `INSERT INTO workflows (id, name, description, enabled, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        data.description ?? null,
        data.enabled !== false ? 1 : 0,
        JSON.stringify(data.config),
        now,
        now
      );

    const created = this.get(id);
    if (!created) throw new Error(`Workflow ${id} not found after insert`);
    return created;
  }

  update(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      config: WorkflowConfig;
    }>
  ): Workflow | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `UPDATE workflows SET
           name = ?,
           description = ?,
           enabled = ?,
           config = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name ?? existing.name,
        data.description !== undefined ? data.description : existing.description,
        data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
        data.config !== undefined ? JSON.stringify(data.config) : JSON.stringify(existing.config),
        now,
        id
      );

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
    return result.changes > 0;
  }

  recordRun(id: string, error?: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE workflows SET
           last_run_at = ?,
           run_count = run_count + 1,
           last_error = ?
         WHERE id = ?`
      )
      .run(now, error ?? null, id);
  }
}

export function getWorkflowStore(db: Database.Database): WorkflowStore {
  return new WorkflowStore(db);
}
