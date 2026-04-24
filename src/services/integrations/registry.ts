import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { McpServerInfo } from "../../webui/types.js";
import type { TelegramBridge } from "../../telegram/bridge.js";
import {
  type CreateIntegrationInput,
  type IntegrationAuthConfig,
  type IntegrationConfig,
  type IntegrationEntity,
  type IntegrationHealth,
  type IntegrationRateLimitConfig,
  type IntegrationResult,
  type IntegrationStats,
  type UpdateIntegrationInput,
  isIntegrationStatus,
  isIntegrationType,
} from "./base.js";
import { getIntegrationCatalog } from "./catalog.js";
import { IntegrationAuthManager } from "./auth.js";
import {
  IntegrationRateLimitError,
  IntegrationRateLimiter,
  type GlobalIntegrationRateLimit,
} from "./rate-limiter.js";
import { createIntegrationProvider } from "./providers.js";
import { ensureIntegrationTables } from "./storage.js";

interface IntegrationRow {
  id: string;
  name: string;
  type: string;
  provider: string;
  auth: string;
  auth_id: string | null;
  config: string;
  status: string;
  health_check_url: string | null;
  last_health_at: number | null;
  last_health_message: string | null;
  created_at: number;
  updated_at: number;
}

interface StatsRow {
  request_count: number;
  success_count: number | null;
  failure_count: number | null;
  last_executed_at: number | null;
  avg_latency_ms: number | null;
}

export interface IntegrationRegistryDeps {
  db: Database.Database;
  bridge?: Pick<TelegramBridge, "isAvailable" | "sendMessage"> | null;
  mcpServers?: McpServerInfo[] | (() => McpServerInfo[]) | null;
  credentialKey?: string;
  globalRateLimit?: GlobalIntegrationRateLimit;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class IntegrationRegistry {
  readonly auth: IntegrationAuthManager;
  private readonly db: Database.Database;
  private readonly limiter: IntegrationRateLimiter;
  private readonly deps: IntegrationRegistryDeps;

  constructor(deps: IntegrationRegistryDeps) {
    ensureIntegrationTables(deps.db);
    this.db = deps.db;
    this.deps = deps;
    this.auth = new IntegrationAuthManager(deps.db, deps.credentialKey);
    this.limiter = new IntegrationRateLimiter({
      global: deps.globalRateLimit,
      now: deps.now,
    });
  }

  getCatalog(): ReturnType<typeof getIntegrationCatalog> {
    return getIntegrationCatalog();
  }

  list(): IntegrationEntity[] {
    const rows = this.db
      .prepare("SELECT * FROM integrations ORDER BY created_at DESC, name ASC")
      .all() as IntegrationRow[];
    return rows.map((row) => this.rowToEntity(row));
  }

  get(id: string): IntegrationEntity | null {
    const row = this.db.prepare("SELECT * FROM integrations WHERE id = ?").get(id) as
      | IntegrationRow
      | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  create(input: CreateIntegrationInput): IntegrationEntity {
    if (!isIntegrationType(input.type)) throw new Error("Invalid integration type");
    const id = sanitizeId(input.id || input.name || randomUUID());
    const now = nowSeconds();
    const auth = normalizeAuth(input.auth, input.authId);
    const config = normalizeConfig(input.config);
    const healthCheckUrl = input.healthCheckUrl ?? stringValue(config.healthCheckUrl) ?? null;
    this.db
      .prepare(
        `INSERT INTO integrations (
           id, name, type, provider, auth, auth_id, config, status,
           health_check_url, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name.trim(),
        input.type,
        input.provider.trim() || "custom-http",
        JSON.stringify(auth),
        input.authId ?? auth.credentialId ?? null,
        JSON.stringify(config),
        "unconfigured",
        healthCheckUrl,
        now,
        now
      );
    const created = this.get(id);
    if (!created) throw new Error(`Integration ${id} not found after insert`);
    return created;
  }

  update(id: string, input: UpdateIntegrationInput): IntegrationEntity | null {
    const existing = this.get(id);
    if (!existing) return null;

    const nextType = input.type ?? existing.type;
    if (!isIntegrationType(nextType)) throw new Error("Invalid integration type");

    const nextStatus = input.status ?? existing.status;
    if (!isIntegrationStatus(nextStatus)) throw new Error("Invalid integration status");

    const explicitAuthId =
      input.authId !== undefined ? input.authId : (input.auth?.credentialId ?? existing.authId);
    const nextAuth = normalizeAuth(input.auth ?? existing.auth, explicitAuthId);
    const nextConfig = input.config !== undefined ? normalizeConfig(input.config) : existing.config;
    const nextHealth =
      input.healthCheckUrl !== undefined
        ? input.healthCheckUrl
        : (existing.healthCheckUrl ?? stringValue(nextConfig.healthCheckUrl) ?? null);

    this.db
      .prepare(
        `UPDATE integrations SET
           name = ?,
           type = ?,
           provider = ?,
           auth = ?,
           auth_id = ?,
           config = ?,
           status = ?,
           health_check_url = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name?.trim() || existing.name,
        nextType,
        input.provider?.trim() || existing.provider,
        JSON.stringify(nextAuth),
        explicitAuthId,
        JSON.stringify(nextConfig),
        nextStatus,
        nextHealth,
        nowSeconds(),
        id
      );

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM integrations WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async healthCheck(id: string): Promise<IntegrationHealth> {
    const integration = this.requireIntegration(id);
    const provider = createIntegrationProvider(integration, {
      auth: this.auth,
      bridge: this.deps.bridge,
      mcpServers: this.deps.mcpServers,
      fetchImpl: this.deps.fetchImpl,
    });
    const health = await provider.healthCheck();
    this.db
      .prepare(
        `UPDATE integrations SET
           status = ?,
           last_health_at = ?,
           last_health_message = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(health.status, nowSeconds(), health.message ?? null, nowSeconds(), id);
    return health;
  }

  async execute(
    id: string,
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<IntegrationResult> {
    const integration = this.requireIntegration(id);
    const provider = createIntegrationProvider(integration, {
      auth: this.auth,
      bridge: this.deps.bridge,
      mcpServers: this.deps.mcpServers,
      fetchImpl: this.deps.fetchImpl,
    });
    const limits = normalizeRateLimit(integration.config.rateLimit);
    try {
      const result = await this.limiter.schedule(id, limits, () =>
        provider.execute(action, params)
      );
      this.recordUsage(id, action, result);
      return result;
    } catch (error) {
      if (error instanceof IntegrationRateLimitError) {
        const result: IntegrationResult = {
          success: false,
          error: error.message,
          data: { scope: error.scope, retryAfterMs: error.retryAfterMs },
        };
        this.recordUsage(id, action, result);
        return result;
      }
      throw error;
    }
  }

  private requireIntegration(id: string): IntegrationEntity {
    const integration = this.get(id);
    if (!integration) throw new Error("Integration not found");
    return integration;
  }

  private recordUsage(id: string, action: string, result: IntegrationResult): void {
    this.db
      .prepare(
        `INSERT INTO integration_usage (integration_id, action, success, latency_ms, error)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, action, result.success ? 1 : 0, result.latencyMs ?? null, result.error ?? null);
  }

  private rowToEntity(row: IntegrationRow): IntegrationEntity {
    if (!isIntegrationType(row.type))
      throw new Error(`Invalid integration type in DB: ${row.type}`);
    if (!isIntegrationStatus(row.status)) {
      throw new Error(`Invalid integration status in DB: ${row.status}`);
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      provider: row.provider,
      auth: parseAuth(row.auth, row.auth_id),
      authId: row.auth_id,
      config: parseConfig(row.config),
      status: row.status,
      healthCheckUrl: row.health_check_url,
      lastHealthAt: row.last_health_at,
      lastHealthMessage: row.last_health_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stats: this.getStats(row.id),
    };
  }

  private getStats(id: string): IntegrationStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS request_count,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
           MAX(created_at) AS last_executed_at,
           AVG(latency_ms) AS avg_latency_ms
         FROM integration_usage
         WHERE integration_id = ?`
      )
      .get(id) as StatsRow;
    return {
      requestCount: row.request_count,
      successCount: row.success_count ?? 0,
      failureCount: row.failure_count ?? 0,
      lastExecutedAt: row.last_executed_at,
      avgLatencyMs: row.avg_latency_ms,
    };
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sanitizeId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Integration id is required");
  return id.slice(0, 80);
}

function normalizeAuth(
  auth: IntegrationAuthConfig | undefined,
  credentialId?: string | null
): IntegrationAuthConfig {
  return {
    type: auth?.type ?? "none",
    ...auth,
    credentialId: credentialId ?? auth?.credentialId ?? null,
  };
}

function normalizeConfig(config: IntegrationConfig | undefined): IntegrationConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return config;
}

function parseAuth(value: string, credentialId: string | null): IntegrationAuthConfig {
  try {
    const parsed = JSON.parse(value) as IntegrationAuthConfig;
    return normalizeAuth(parsed, credentialId);
  } catch {
    return { type: "none", credentialId };
  }
}

function parseConfig(value: string): IntegrationConfig {
  try {
    const parsed = JSON.parse(value) as IntegrationConfig;
    return normalizeConfig(parsed);
  } catch {
    return {};
  }
}

function normalizeRateLimit(value: unknown): IntegrationRateLimitConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const limits: IntegrationRateLimitConfig = {};
  if (typeof raw.requestsPerMinute === "number") limits.requestsPerMinute = raw.requestsPerMinute;
  if (typeof raw.requestsPerHour === "number") limits.requestsPerHour = raw.requestsPerHour;
  if (typeof raw.queue === "boolean") limits.queue = raw.queue;
  if (typeof raw.maxQueueSize === "number") limits.maxQueueSize = raw.maxQueueSize;
  return limits;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
