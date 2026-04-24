import type { Database } from "better-sqlite3";
import { parse, stringify } from "yaml";

export type PolicyAction = "allow" | "deny" | "require_approval";

export interface PolicyParamCondition {
  pattern?: string;
  in?: unknown[];
  equals?: unknown;
  eq?: unknown;
  contains?: string;
  min?: number;
  max?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export type PolicyParamMatcher = PolicyParamCondition | unknown;

export interface PolicyMatch {
  tool?: string | string[];
  module?: string | string[];
  params?: Record<string, PolicyParamMatcher>;
}

export interface CreateSecurityPolicyInput {
  name: string;
  match: PolicyMatch;
  action: PolicyAction;
  reason?: string;
  enabled?: boolean;
  priority?: number;
}

export interface UpdateSecurityPolicyInput {
  name?: string;
  match?: PolicyMatch;
  action?: PolicyAction;
  reason?: string | null;
  enabled?: boolean;
  priority?: number;
}

export interface SecurityPolicy {
  id: number;
  name: string;
  match: PolicyMatch;
  action: PolicyAction;
  reason: string | null;
  enabled: boolean;
  priority: number;
  created_at: number;
}

export interface PolicyEvaluationInput {
  tool: string;
  params: unknown;
  senderId?: number;
  chatId?: string;
  module?: string | null;
}

export interface PolicyEvaluationResult {
  action: PolicyAction;
  reason: string;
  policy: SecurityPolicy | null;
}

export interface ValidationLogEntry {
  id: number;
  tool: string;
  params: string;
  action: PolicyAction;
  reason: string;
  policy_id: number | null;
  policy_name: string | null;
  approval_id: string | null;
  created_at: number;
}

interface PolicyRow {
  id: number;
  name: string;
  match: string;
  action: PolicyAction;
  reason: string | null;
  enabled: number;
  priority: number;
  created_at: number;
}

const POLICY_ACTIONS = new Set<PolicyAction>(["allow", "deny", "require_approval"]);
const CONDITION_KEYS = new Set([
  "pattern",
  "in",
  "equals",
  "eq",
  "contains",
  "min",
  "max",
  "gt",
  "gte",
  "lt",
  "lte",
]);

export class PolicyEngine {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_policies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        match      TEXT    NOT NULL,
        action     TEXT    NOT NULL CHECK(action IN ('allow', 'deny', 'require_approval')),
        reason     TEXT,
        enabled    INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        priority   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_security_policies_enabled_priority
        ON security_policies(enabled, priority DESC, id ASC);

      CREATE TABLE IF NOT EXISTS security_validation_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tool        TEXT    NOT NULL,
        params      TEXT    NOT NULL,
        action      TEXT    NOT NULL CHECK(action IN ('allow', 'deny', 'require_approval')),
        reason      TEXT    NOT NULL,
        policy_id   INTEGER,
        policy_name TEXT,
        approval_id TEXT,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_security_validation_log_created_at
        ON security_validation_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_validation_log_tool
        ON security_validation_log(tool);

      CREATE TABLE IF NOT EXISTS security_tool_rate_limits (
        tool           TEXT PRIMARY KEY,
        max_per_minute INTEGER NOT NULL CHECK(max_per_minute > 0),
        updated_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS security_tool_rate_counters (
        tool         TEXT NOT NULL,
        sender_id    INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        count        INTEGER NOT NULL,
        PRIMARY KEY (tool, sender_id, window_start)
      );
    `);
  }

  listPolicies(): SecurityPolicy[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM security_policies
         ORDER BY enabled DESC, priority DESC, id ASC`
      )
      .all() as PolicyRow[];
    return rows.map((row) => this.rowToPolicy(row));
  }

  getPolicy(id: number): SecurityPolicy | null {
    const row = this.db.prepare("SELECT * FROM security_policies WHERE id = ?").get(id) as
      | PolicyRow
      | undefined;
    return row ? this.rowToPolicy(row) : null;
  }

  createPolicy(input: CreateSecurityPolicyInput): SecurityPolicy {
    const normalized = normalizeCreatePolicy(input);
    const result = this.db
      .prepare(
        `INSERT INTO security_policies (name, match, action, reason, enabled, priority)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        normalized.name,
        JSON.stringify(normalized.match),
        normalized.action,
        normalized.reason ?? null,
        normalized.enabled === false ? 0 : 1,
        normalized.priority ?? 0
      );
    const created = this.getPolicy(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to create security policy");
    return created;
  }

  updatePolicy(id: number, input: UpdateSecurityPolicyInput): SecurityPolicy | null {
    const existing = this.getPolicy(id);
    if (!existing) return null;

    const next: CreateSecurityPolicyInput = normalizeCreatePolicy({
      name: input.name ?? existing.name,
      match: input.match ?? existing.match,
      action: input.action ?? existing.action,
      reason: input.reason === undefined ? (existing.reason ?? undefined) : (input.reason ?? ""),
      enabled: input.enabled ?? existing.enabled,
      priority: input.priority ?? existing.priority,
    });

    this.db
      .prepare(
        `UPDATE security_policies
         SET name = ?, match = ?, action = ?, reason = ?, enabled = ?, priority = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        JSON.stringify(next.match),
        next.action,
        next.reason ?? null,
        next.enabled === false ? 0 : 1,
        next.priority ?? 0,
        id
      );

    return this.getPolicy(id);
  }

  deletePolicy(id: number): boolean {
    const result = this.db.prepare("DELETE FROM security_policies WHERE id = ?").run(id);
    return result.changes > 0;
  }

  evaluate(
    input: PolicyEvaluationInput,
    opts: { recordRate?: boolean } = {}
  ): PolicyEvaluationResult {
    const rateDecision = this.evaluateRateLimit(input, opts.recordRate ?? true);
    if (rateDecision) return rateDecision;

    const rows = this.db
      .prepare(
        `SELECT * FROM security_policies
         WHERE enabled = 1
         ORDER BY priority DESC, id ASC`
      )
      .all() as PolicyRow[];

    for (const row of rows) {
      const policy = this.rowToPolicy(row);
      if (!matchesPolicy(policy, input)) continue;

      return {
        action: policy.action,
        reason: policy.reason ?? `Matched policy "${policy.name}"`,
        policy,
      };
    }

    return {
      action: "allow",
      reason: "No matching policy",
      policy: null,
    };
  }

  recordValidation(input: {
    tool: string;
    params: unknown;
    action: PolicyAction;
    reason: string;
    policy?: SecurityPolicy | null;
    approvalId?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO security_validation_log
           (tool, params, action, reason, policy_id, policy_name, approval_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.tool,
        safeStringify(input.params),
        input.action,
        input.reason,
        input.policy?.id ?? null,
        input.policy?.name ?? null,
        input.approvalId ?? null
      );
  }

  listValidationLog(opts: { limit?: number } = {}): ValidationLogEntry[] {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    return this.db
      .prepare(
        `SELECT * FROM security_validation_log
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(limit) as ValidationLogEntry[];
  }

  setToolRateLimit(tool: string, maxPerMinute: number): void {
    if (!tool || !Number.isInteger(maxPerMinute) || maxPerMinute <= 0) {
      throw new Error("tool rate limit requires a tool name and positive integer max_per_minute");
    }
    this.db
      .prepare(
        `INSERT INTO security_tool_rate_limits (tool, max_per_minute, updated_at)
         VALUES (?, ?, strftime('%s', 'now'))
         ON CONFLICT(tool) DO UPDATE SET
           max_per_minute = excluded.max_per_minute,
           updated_at = excluded.updated_at`
      )
      .run(tool, maxPerMinute);
  }

  private evaluateRateLimit(
    input: PolicyEvaluationInput,
    recordRate: boolean
  ): PolicyEvaluationResult | null {
    const limitRow = this.db
      .prepare(
        `SELECT max_per_minute FROM security_tool_rate_limits
         WHERE tool IN (?, '*')
         ORDER BY CASE WHEN tool = ? THEN 0 ELSE 1 END
         LIMIT 1`
      )
      .get(input.tool, input.tool) as { max_per_minute: number } | undefined;

    if (!limitRow || input.senderId === undefined) return null;

    const windowStart = Math.floor(Date.now() / 60000) * 60;
    let count = 0;
    if (recordRate) {
      this.db
        .prepare(
          `INSERT INTO security_tool_rate_counters (tool, sender_id, window_start, count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(tool, sender_id, window_start)
           DO UPDATE SET count = count + 1`
        )
        .run(input.tool, input.senderId, windowStart);
      const row = this.db
        .prepare(
          `SELECT count FROM security_tool_rate_counters
           WHERE tool = ? AND sender_id = ? AND window_start = ?`
        )
        .get(input.tool, input.senderId, windowStart) as { count: number };
      count = row.count;
    } else {
      const row = this.db
        .prepare(
          `SELECT count FROM security_tool_rate_counters
           WHERE tool = ? AND sender_id = ? AND window_start = ?`
        )
        .get(input.tool, input.senderId, windowStart) as { count: number } | undefined;
      count = (row?.count ?? 0) + 1;
    }

    if (count <= limitRow.max_per_minute) return null;
    return {
      action: "deny",
      reason: `Tool "${input.tool}" exceeded rate limit of ${limitRow.max_per_minute}/minute`,
      policy: null,
    };
  }

  private rowToPolicy(row: PolicyRow): SecurityPolicy {
    return {
      id: row.id,
      name: row.name,
      match: JSON.parse(row.match) as PolicyMatch,
      action: row.action,
      reason: row.reason,
      enabled: row.enabled === 1,
      priority: row.priority,
      created_at: row.created_at,
    };
  }
}

export function parsePoliciesYaml(yamlText: string): CreateSecurityPolicyInput[] {
  const value = parse(yamlText) as unknown;
  if (!isRecord(value) || !Array.isArray(value.policies)) {
    throw new Error("Policy YAML must contain a top-level policies array");
  }
  return value.policies.map((policy, index) => {
    if (!isRecord(policy)) {
      throw new Error(`Policy at index ${index} must be an object`);
    }
    return normalizeCreatePolicy(policy as unknown as CreateSecurityPolicyInput);
  });
}

export function stringifyPolicyYaml(policy: CreateSecurityPolicyInput | SecurityPolicy): string {
  const serializable = {
    policies: [
      {
        name: policy.name,
        match: policy.match,
        action: policy.action,
        ...(policy.reason ? { reason: policy.reason } : {}),
        enabled: "enabled" in policy ? policy.enabled : (policy.enabled ?? true),
        priority: policy.priority ?? 0,
      },
    ],
  };
  return stringify(serializable);
}

function normalizeCreatePolicy(input: CreateSecurityPolicyInput): CreateSecurityPolicyInput {
  if (!input.name || typeof input.name !== "string") {
    throw new Error("Policy name is required");
  }
  if (!input.match || !isRecord(input.match)) {
    throw new Error(`Policy "${input.name}" must define a match object`);
  }
  if (!POLICY_ACTIONS.has(input.action)) {
    throw new Error(`Policy "${input.name}" has invalid action "${String(input.action)}"`);
  }
  if (input.priority !== undefined && !Number.isInteger(input.priority)) {
    throw new Error(`Policy "${input.name}" priority must be an integer`);
  }
  return {
    name: input.name,
    match: input.match,
    action: input.action,
    ...(input.reason !== undefined && { reason: String(input.reason) }),
    enabled: input.enabled ?? true,
    priority: input.priority ?? 0,
  };
}

function matchesPolicy(policy: SecurityPolicy, input: PolicyEvaluationInput): boolean {
  const match = policy.match;
  if (match.tool !== undefined && !matchesName(input.tool, match.tool)) return false;
  if (match.module !== undefined && !matchesName(input.module ?? "", match.module)) return false;

  if (match.params) {
    if (!isRecord(input.params)) return false;
    for (const [key, matcher] of Object.entries(match.params)) {
      const value = getPath(input.params, key);
      if (!matchesParam(value, matcher)) return false;
    }
  }

  return true;
}

function matchesName(value: string, matcher: string | string[]): boolean {
  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  return matchers.some((candidate) => {
    if (candidate === value || candidate === "*") return true;
    if (!candidate.includes("_") && value.startsWith(`${candidate}_`)) return true;
    if (!candidate.includes("*")) return false;
    const escaped = candidate
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}$`).test(value);
  });
}

function matchesParam(value: unknown, matcher: PolicyParamMatcher): boolean {
  if (isCondition(matcher)) {
    if (matcher.pattern !== undefined) {
      if (typeof value !== "string") return false;
      if (!new RegExp(matcher.pattern).test(value)) return false;
    }
    if (matcher.in !== undefined && !matcher.in.some((entry) => deepEqual(entry, value))) {
      return false;
    }
    const equals = matcher.equals ?? matcher.eq;
    if ((matcher.equals !== undefined || matcher.eq !== undefined) && !deepEqual(equals, value)) {
      return false;
    }
    if (matcher.contains !== undefined) {
      if (typeof value !== "string" || !value.includes(matcher.contains)) return false;
    }
    if (matcher.min !== undefined && !isNumberAtLeast(value, matcher.min)) return false;
    if (matcher.gte !== undefined && !isNumberAtLeast(value, matcher.gte)) return false;
    if (matcher.max !== undefined && !isNumberAtMost(value, matcher.max)) return false;
    if (matcher.lte !== undefined && !isNumberAtMost(value, matcher.lte)) return false;
    if (matcher.gt !== undefined && !(typeof value === "number" && value > matcher.gt))
      return false;
    if (matcher.lt !== undefined && !(typeof value === "number" && value < matcher.lt))
      return false;
    return true;
  }

  return deepEqual(matcher, value);
}

function isCondition(value: unknown): value is PolicyParamCondition {
  return (
    isRecord(value) &&
    Object.keys(value).some((key) => CONDITION_KEYS.has(key)) &&
    Object.keys(value).every((key) => CONDITION_KEYS.has(key))
  );
}

function getPath(value: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return value[path];
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isNumberAtLeast(value: unknown, limit: number): boolean {
  return typeof value === "number" && value >= limit;
}

function isNumberAtMost(value: unknown, limit: number): boolean {
  return typeof value === "number" && value <= limit;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return safeStringify(a) === safeStringify(b);
}

function safeStringify(value: unknown): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
