import type { Database } from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  tool: string;
  params: string;
  params_hash: string;
  requester_id: number | null;
  chat_id: string | null;
  status: ApprovalStatus;
  reason: string;
  policy_id: number | null;
  policy_name: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: number | null;
  consumed_at: number | null;
}

export interface CreateApprovalInput {
  tool: string;
  params: unknown;
  requesterId?: number;
  chatId?: string;
  reason: string;
  policyId?: number | null;
  policyName?: string | null;
}

export class ApprovalGate {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_approvals (
        id           TEXT PRIMARY KEY,
        tool         TEXT    NOT NULL,
        params       TEXT    NOT NULL,
        params_hash  TEXT    NOT NULL,
        requester_id INTEGER,
        chat_id      TEXT,
        status       TEXT    NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
        reason       TEXT    NOT NULL,
        policy_id    INTEGER,
        policy_name  TEXT,
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        resolved_at  INTEGER,
        resolved_by  INTEGER,
        consumed_at  INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_security_approvals_status_created
        ON security_approvals(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_approvals_lookup
        ON security_approvals(tool, requester_id, params_hash, status, consumed_at);
    `);
  }

  create(input: CreateApprovalInput): ApprovalRequest {
    const params = stableStringify(input.params);
    const paramsHash = hashAction(input.tool, params, input.requesterId ?? null);
    const existing = this.db
      .prepare(
        `SELECT * FROM security_approvals
         WHERE tool = ?
           AND params_hash = ?
           AND requester_id IS ?
           AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(input.tool, paramsHash, input.requesterId ?? null) as ApprovalRequest | undefined;
    if (existing) return existing;

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO security_approvals
           (id, tool, params, params_hash, requester_id, chat_id, status, reason, policy_id, policy_name)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(
        id,
        input.tool,
        params,
        paramsHash,
        input.requesterId ?? null,
        input.chatId ?? null,
        input.reason,
        input.policyId ?? null,
        input.policyName ?? null
      );

    const created = this.get(id);
    if (!created) throw new Error("Failed to create approval request");
    return created;
  }

  list(opts: { status?: ApprovalStatus; limit?: number } = {}): ApprovalRequest[] {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    if (opts.status) {
      return this.db
        .prepare(
          `SELECT * FROM security_approvals
           WHERE status = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(opts.status, limit) as ApprovalRequest[];
    }
    return this.db
      .prepare(
        `SELECT * FROM security_approvals
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as ApprovalRequest[];
  }

  get(id: string): ApprovalRequest | null {
    const row = this.db.prepare("SELECT * FROM security_approvals WHERE id = ?").get(id) as
      | ApprovalRequest
      | undefined;
    return row ?? null;
  }

  approve(id: string, opts: { resolvedBy?: number | null } = {}): ApprovalRequest | null {
    this.db
      .prepare(
        `UPDATE security_approvals
         SET status = 'approved',
             resolved_at = strftime('%s', 'now'),
             resolved_by = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(opts.resolvedBy ?? null, id);
    return this.get(id);
  }

  reject(id: string, opts: { resolvedBy?: number | null } = {}): ApprovalRequest | null {
    this.db
      .prepare(
        `UPDATE security_approvals
         SET status = 'rejected',
             resolved_at = strftime('%s', 'now'),
             resolved_by = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(opts.resolvedBy ?? null, id);
    return this.get(id);
  }

  consumeApproved(input: {
    tool: string;
    params: unknown;
    requesterId?: number | null;
  }): ApprovalRequest | null {
    const params = stableStringify(input.params);
    const paramsHash = hashAction(input.tool, params, input.requesterId ?? null);
    const row = this.db
      .prepare(
        `SELECT * FROM security_approvals
         WHERE tool = ?
           AND params_hash = ?
           AND requester_id IS ?
           AND status = 'approved'
           AND consumed_at IS NULL
         ORDER BY resolved_at DESC, created_at DESC
         LIMIT 1`
      )
      .get(input.tool, paramsHash, input.requesterId ?? null) as ApprovalRequest | undefined;
    if (!row) return null;

    this.db
      .prepare(
        `UPDATE security_approvals
         SET consumed_at = strftime('%s', 'now')
         WHERE id = ? AND consumed_at IS NULL`
      )
      .run(row.id);
    return this.get(row.id);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
}

function hashAction(tool: string, params: string, requesterId: number | null): string {
  return createHash("sha256")
    .update(tool)
    .update("\0")
    .update(String(requesterId ?? ""))
    .update("\0")
    .update(params)
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
