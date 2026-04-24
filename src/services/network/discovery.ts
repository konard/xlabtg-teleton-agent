import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  NETWORK_AGENT_STATUSES,
  NETWORK_MESSAGE_STATUSES,
  NETWORK_MESSAGE_TYPES,
  NETWORK_TRUST_LEVELS,
  type AgentNetworkAdvertisement,
  type NetworkAgentRecord,
  type NetworkAgentStatus,
  type NetworkMessageEnvelope,
  type NetworkMessageRecord,
  type NetworkMessageStatus,
  type NetworkStatusSummary,
  type NetworkTrustLevel,
} from "./types.js";

interface NetworkAgentRow {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string;
  status: string;
  load: number;
  public_key: string | null;
  trust_level: string;
  blocked: number;
  latency_ms: number | null;
  error_rate: number;
  metadata: string;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
}

interface NetworkMessageRow {
  id: string;
  type: string;
  from_agent_id: string;
  to_agent_id: string;
  correlation_id: string;
  replay_key: string | null;
  payload: string;
  signature: string | null;
  timestamp: string;
  status: string;
  error: string | null;
  created_at: number;
  sent_at: number | null;
  received_at: number | null;
}

export interface RegisterAgentOptions {
  trustLevel?: NetworkTrustLevel;
  blocked?: boolean;
}

export interface MessageListFilter {
  from?: string;
  to?: string;
  type?: string;
  limit?: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to an empty metadata object.
  }
  return {};
}

function normalizeId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error("Agent id is required");
  return id;
}

function normalizeCapabilities(value: string[] | undefined): string[] {
  return [
    ...new Set((value ?? []).map((capability) => capability.trim().toLowerCase()).filter(Boolean)),
  ];
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim();
  if (!endpoint) throw new Error("Agent endpoint is required");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid agent endpoint: ${endpoint}`);
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Agent endpoint must use http or https");
  }
  const localHttpHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (url.protocol === "http:" && !localHttpHosts.has(url.hostname)) {
    throw new Error("Agent endpoint must use HTTPS unless it targets localhost");
  }
  return url.toString();
}

function normalizeLoad(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeStatus(value: string): NetworkAgentStatus {
  return NETWORK_AGENT_STATUSES.includes(value as NetworkAgentStatus)
    ? (value as NetworkAgentStatus)
    : "offline";
}

function normalizeTrustLevel(value: string | undefined): NetworkTrustLevel {
  return NETWORK_TRUST_LEVELS.includes(value as NetworkTrustLevel)
    ? (value as NetworkTrustLevel)
    : "untrusted";
}

function normalizeMessageStatus(value: string): NetworkMessageStatus {
  return NETWORK_MESSAGE_STATUSES.includes(value as NetworkMessageStatus)
    ? (value as NetworkMessageStatus)
    : "queued";
}

function messageReplayKey(envelope: NetworkMessageEnvelope): string {
  return JSON.stringify([envelope.from, envelope.to, envelope.correlationId]);
}

function rowToAgent(row: NetworkAgentRow): NetworkAgentRecord {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    capabilities: parseJsonArray(row.capabilities),
    status: normalizeStatus(row.status),
    load: normalizeLoad(row.load),
    publicKey: row.public_key,
    trustLevel: normalizeTrustLevel(row.trust_level),
    blocked: row.blocked === 1,
    latencyMs: row.latency_ms,
    errorRate: Math.max(0, Math.min(1, row.error_rate)),
    metadata: parseJsonObject(row.metadata),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: NetworkMessageRow): NetworkMessageRecord {
  return {
    id: row.id,
    type: NETWORK_MESSAGE_TYPES.includes(row.type as NetworkMessageRecord["type"])
      ? (row.type as NetworkMessageRecord["type"])
      : "negotiation",
    from: row.from_agent_id,
    to: row.to_agent_id,
    correlationId: row.correlation_id,
    payload: parseJsonObject(row.payload),
    signature: row.signature,
    timestamp: row.timestamp,
    status: normalizeMessageStatus(row.status),
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
  };
}

export class AgentNetworkStore {
  constructor(private readonly db: Database.Database) {}

  registerAgent(
    advertisement: AgentNetworkAdvertisement,
    options: RegisterAgentOptions = {}
  ): NetworkAgentRecord {
    const id = normalizeId(advertisement.agentId);
    const name = advertisement.name.trim() || id;
    const endpoint = normalizeEndpoint(advertisement.endpoint);
    const capabilities = normalizeCapabilities(advertisement.capabilities);
    const status = normalizeStatus(advertisement.status);
    const load = normalizeLoad(advertisement.load);
    const trustLevel = normalizeTrustLevel(options.trustLevel);
    const now = nowSeconds();
    const existing = this.getAgent(id);
    const blocked = options.blocked ?? existing?.blocked ?? false;

    this.db
      .prepare(
        `
          INSERT INTO network_agents (
            id, name, endpoint, capabilities, status, load, public_key, trust_level,
            blocked, metadata, last_seen_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            endpoint = excluded.endpoint,
            capabilities = excluded.capabilities,
            status = excluded.status,
            load = excluded.load,
            public_key = excluded.public_key,
            trust_level = excluded.trust_level,
            blocked = excluded.blocked,
            metadata = excluded.metadata,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        id,
        name,
        endpoint,
        JSON.stringify(capabilities),
        status,
        load,
        advertisement.publicKey?.trim() || null,
        existing ? existing.trustLevel : trustLevel,
        blocked ? 1 : 0,
        JSON.stringify(advertisement.metadata ?? {}),
        now,
        now,
        now
      );

    const agent = this.getAgent(id);
    if (!agent) throw new Error(`Agent registration failed: ${id}`);
    return agent;
  }

  listAgents(): NetworkAgentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM network_agents ORDER BY status ASC, load ASC, name ASC`)
      .all() as NetworkAgentRow[];
    return rows.map(rowToAgent);
  }

  getAgent(id: string): NetworkAgentRecord | null {
    const row = this.db.prepare(`SELECT * FROM network_agents WHERE id = ?`).get(id) as
      | NetworkAgentRow
      | undefined;
    return row ? rowToAgent(row) : null;
  }

  removeAgent(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM network_agents WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  updateAgentTrust(
    id: string,
    updates: { trustLevel?: NetworkTrustLevel; blocked?: boolean }
  ): NetworkAgentRecord {
    const agent = this.getAgent(id);
    if (!agent) throw new Error(`Unknown network agent: ${id}`);

    const trustLevel = updates.trustLevel
      ? normalizeTrustLevel(updates.trustLevel)
      : agent.trustLevel;
    const blocked = updates.blocked ?? agent.blocked;
    const now = nowSeconds();

    this.db
      .prepare(
        `
          UPDATE network_agents
          SET trust_level = ?, blocked = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(trustLevel, blocked ? 1 : 0, now, id);

    const updated = this.getAgent(id);
    if (!updated) throw new Error(`Agent disappeared during trust update: ${id}`);
    return updated;
  }

  recordHeartbeat(
    id: string,
    status: NetworkAgentStatus,
    values: { load?: number; latencyMs?: number | null; errorRate?: number } = {}
  ): NetworkAgentRecord {
    const agent = this.getAgent(id);
    if (!agent) throw new Error(`Unknown network agent: ${id}`);

    const now = nowSeconds();
    this.db
      .prepare(
        `
          UPDATE network_agents
          SET status = ?, load = ?, latency_ms = ?, error_rate = ?,
              last_seen_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        normalizeStatus(status),
        values.load === undefined ? agent.load : normalizeLoad(values.load),
        values.latencyMs === undefined ? agent.latencyMs : values.latencyMs,
        values.errorRate === undefined
          ? agent.errorRate
          : Math.max(0, Math.min(1, values.errorRate)),
        now,
        now,
        id
      );

    const updated = this.getAgent(id);
    if (!updated) throw new Error(`Agent disappeared during heartbeat update: ${id}`);
    return updated;
  }

  logMessage(
    envelope: NetworkMessageEnvelope,
    status: NetworkMessageStatus,
    options: {
      error?: string | null;
      id?: string;
      sentAt?: number | null;
      receivedAt?: number | null;
    } = {}
  ): NetworkMessageRecord {
    const id = options.id ?? randomUUID();
    const now = nowSeconds();
    const sentAt = options.sentAt === undefined && status === "sent" ? now : options.sentAt;
    const receivedAt =
      options.receivedAt === undefined && status === "received" ? now : options.receivedAt;
    const replayKey = status === "received" ? messageReplayKey(envelope) : null;

    this.db
      .prepare(
        `
          INSERT INTO network_messages (
            id, type, from_agent_id, to_agent_id, correlation_id, replay_key, payload,
            signature, timestamp, status, error, created_at, sent_at, received_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        envelope.type,
        envelope.from,
        envelope.to,
        envelope.correlationId,
        replayKey,
        JSON.stringify(envelope.payload ?? {}),
        envelope.signature ?? null,
        envelope.timestamp,
        status,
        options.error ?? null,
        now,
        sentAt ?? null,
        receivedAt ?? null
      );

    const row = this.db.prepare(`SELECT * FROM network_messages WHERE id = ?`).get(id) as
      | NetworkMessageRow
      | undefined;
    if (!row) throw new Error(`Network message log failed: ${id}`);
    return rowToMessage(row);
  }

  findReceivedMessage(envelope: NetworkMessageEnvelope): NetworkMessageRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM network_messages
          WHERE status = 'received'
            AND from_agent_id = ?
            AND to_agent_id = ?
            AND correlation_id = ?
          ORDER BY created_at ASC, rowid ASC
          LIMIT 1
        `
      )
      .get(envelope.from, envelope.to, envelope.correlationId) as NetworkMessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  listMessages(filter: MessageListFilter = {}): NetworkMessageRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter.from) {
      conditions.push("from_agent_id = ?");
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push("to_agent_id = ?");
      params.push(filter.to);
    }
    if (filter.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    const rows = this.db
      .prepare(
        `SELECT * FROM network_messages ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(...params, limit) as NetworkMessageRow[];
    return rows.map(rowToMessage);
  }

  getNetworkStatus(): NetworkStatusSummary {
    const agents = this.listAgents();
    const cutoff = nowSeconds() - 3600;
    const messageRow = this.db
      .prepare(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM network_messages
          WHERE created_at >= ?
        `
      )
      .get(cutoff) as { total: number; failed: number | null };

    const averageLoad =
      agents.length === 0 ? 0 : agents.reduce((sum, agent) => sum + agent.load, 0) / agents.length;

    return {
      totalAgents: agents.length,
      availableAgents: agents.filter((agent) => agent.status === "available").length,
      degradedAgents: agents.filter(
        (agent) => agent.status === "busy" || agent.status === "degraded"
      ).length,
      offlineAgents: agents.filter((agent) => agent.status === "offline").length,
      trustedAgents: agents.filter(
        (agent) =>
          !agent.blocked && (agent.trustLevel === "trusted" || agent.trustLevel === "verified")
      ).length,
      blockedAgents: agents.filter((agent) => agent.blocked).length,
      averageLoad: Number(averageLoad.toFixed(3)),
      messagesLastHour: messageRow.total,
      errorsLastHour: messageRow.failed ?? 0,
    };
  }
}

const instances = new WeakMap<Database.Database, AgentNetworkStore>();

export function getAgentNetworkStore(db: Database.Database): AgentNetworkStore {
  let store = instances.get(db);
  if (!store) {
    store = new AgentNetworkStore(db);
    instances.set(db, store);
  }
  return store;
}
