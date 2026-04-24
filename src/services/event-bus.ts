import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger.js";

const log = createLogger("EventBus");

export const EVENT_TYPES = [
  "agent.message.received",
  "agent.message.sent",
  "agent.message.failed",
  "agent.state.changed",
  "tool.executed",
  "tool.failed",
  "session.started",
  "session.ended",
  "config.changed",
  "security.alert",
  "schedule.triggered",
  "anomaly.detected",
  "webhook.incoming",
  "webhook.test",
] as const;

export type BuiltInEventType = (typeof EVENT_TYPES)[number];
export type EventType = BuiltInEventType | (string & {});
export type EventPayload = Record<string, unknown>;

export interface TeletonEvent {
  id: string;
  type: EventType;
  payload: EventPayload;
  timestamp: string;
  source: string;
  correlationId: string;
}

export interface PublishEventInput {
  id?: string;
  type: EventType;
  payload?: EventPayload;
  timestamp?: Date | string | number;
  source?: string;
  correlationId?: string;
}

export interface EventBusOptions {
  enabled?: boolean;
  maxLogEntries?: number;
}

export interface EventListFilters {
  type?: string;
  from?: string | number | Date;
  to?: string | number | Date;
  limit?: number;
  offset?: number;
}

export interface EventListResult {
  events: TeletonEvent[];
  total: number;
  limit: number;
  offset: number;
}

type EventHandler = (event: TeletonEvent) => void | Promise<void>;

interface EventRow {
  id: string;
  type: string;
  payload: string;
  timestamp: number;
  source: string;
  correlation_id: string;
}

const DEFAULT_MAX_LOG_ENTRIES = 1_000;
const MAX_QUERY_LIMIT = 500;

function toTimestampMs(value: Date | string | number | undefined): number {
  if (value === undefined) return Date.now();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
}

function toEvent(row: EventRow): TeletonEvent {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload) as EventPayload,
    timestamp: new Date(row.timestamp).toISOString(),
    source: row.source,
    correlationId: row.correlation_id,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  if (!Number.isInteger(limit) || limit < 1) return 100;
  return Math.min(limit, MAX_QUERY_LIMIT);
}

export class EventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();
  private readonly enabled: boolean;
  private readonly maxLogEntries: number;

  constructor(
    private readonly db: Database,
    options: EventBusOptions = {}
  ) {
    this.enabled = options.enabled ?? true;
    this.maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
    this.migrate();
  }

  subscribe(type: EventType | "*", handler: EventHandler): () => void {
    const key = type;
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set<EventHandler>();
      this.subscribers.set(key, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set?.size === 0) this.subscribers.delete(key);
    };
  }

  async publish(input: PublishEventInput): Promise<TeletonEvent> {
    const timestampMs = toTimestampMs(input.timestamp);
    const event: TeletonEvent = {
      id: input.id ?? randomUUID(),
      type: input.type,
      payload: input.payload ?? {},
      timestamp: new Date(timestampMs).toISOString(),
      source: input.source ?? "system",
      correlationId: input.correlationId ?? randomUUID(),
    };

    if (!this.enabled) return event;

    this.db
      .prepare(
        `INSERT INTO event_log (id, type, payload, timestamp, source, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.type,
        JSON.stringify(event.payload),
        timestampMs,
        event.source,
        event.correlationId
      );
    this.prune();
    this.dispatchAsync(event);
    return event;
  }

  listEvents(filters: EventListFilters): EventListResult {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.type) {
      where.push("type = ?");
      params.push(filters.type);
    }
    if (filters.from !== undefined) {
      where.push("timestamp >= ?");
      params.push(toTimestampMs(filters.from));
    }
    if (filters.to !== undefined) {
      where.push("timestamp <= ?");
      params.push(toTimestampMs(filters.to));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = clampLimit(filters.limit);
    const offset =
      filters.offset !== undefined && Number.isInteger(filters.offset) && filters.offset > 0
        ? filters.offset
        : 0;

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM event_log ${whereClause}`)
      .get(...params) as { count: number };
    const rows = this.db
      .prepare(
        `SELECT * FROM event_log ${whereClause}
         ORDER BY timestamp DESC, rowid DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as EventRow[];

    return {
      events: rows.map(toEvent),
      total: totalRow.count,
      limit,
      offset,
    };
  }

  getEvent(id: string): TeletonEvent | null {
    const row = this.db.prepare("SELECT * FROM event_log WHERE id = ?").get(id) as
      | EventRow
      | undefined;
    return row ? toEvent(row) : null;
  }

  async replay(id: string): Promise<TeletonEvent> {
    const original = this.getEvent(id);
    if (!original) throw new Error("Event not found");
    return this.publish({
      type: original.type,
      payload: original.payload,
      source: "event-replay",
      correlationId: original.correlationId,
    });
  }

  clearSubscribers(): void {
    this.subscribers.clear();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id             TEXT PRIMARY KEY,
        type           TEXT NOT NULL,
        payload        TEXT NOT NULL DEFAULT '{}',
        timestamp      INTEGER NOT NULL,
        source         TEXT NOT NULL,
        correlation_id TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_type_time ON event_log(type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_event_log_time ON event_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log(correlation_id);
    `);
  }

  private prune(): void {
    this.db
      .prepare(
        `DELETE FROM event_log
         WHERE rowid NOT IN (
           SELECT rowid FROM event_log ORDER BY timestamp DESC, rowid DESC LIMIT ?
         )`
      )
      .run(this.maxLogEntries);
  }

  private dispatchAsync(event: TeletonEvent): void {
    const handlers = [
      ...(this.subscribers.get(event.type) ?? []),
      ...(this.subscribers.get("*") ?? []),
    ];
    if (handlers.length === 0) return;

    setImmediate(() => {
      for (const handler of handlers) {
        Promise.resolve(handler(event)).catch((err: unknown) => {
          log.warn({ err, eventId: event.id, eventType: event.type }, "Event subscriber failed");
        });
      }
    });
  }
}

const instances = new WeakMap<Database, EventBus>();

export function getEventBus(db: Database, options?: EventBusOptions): EventBus {
  let instance = instances.get(db);
  if (!instance) {
    instance = new EventBus(db, options);
    instances.set(db, instance);
  }
  return instance;
}

export function resetEventBusForTesting(db: Database): void {
  const instance = instances.get(db);
  instance?.clearSubscribers();
  instances.delete(db);
}
