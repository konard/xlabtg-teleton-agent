import { createHash } from "crypto";
import type { Database } from "better-sqlite3";
import { upsertTemporalMetadata } from "./temporal-context.js";

export type BehaviorActionType = "message" | "tool";
export type BehaviorPatternType = "sequential" | "temporal" | "contextual";

export interface BehaviorEvent {
  id: number;
  sessionId: string;
  chatId: string;
  actionType: BehaviorActionType;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface BehaviorPattern<
  TPattern extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  patternType: BehaviorPatternType;
  pattern: TPattern;
  confidence: number;
  frequency: number;
  lastSeen: number;
  createdAt: number;
}

interface BehaviorEventRow {
  id: number;
  session_id: string;
  chat_id: string;
  action_type: string;
  action: string;
  metadata: string;
  created_at: number;
}

interface BehaviorPatternRow {
  id: string;
  pattern_type: BehaviorPatternType;
  pattern: string;
  confidence: number;
  frequency: number;
  last_seen: number;
  created_at: number;
}

const DEFAULT_HISTORY_LIMIT = 5000;
const MAX_ACTION_LENGTH = 160;

const TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "api",
  "are",
  "but",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "get",
  "give",
  "has",
  "have",
  "how",
  "into",
  "make",
  "need",
  "now",
  "please",
  "run",
  "show",
  "that",
  "the",
  "this",
  "to",
  "use",
  "want",
  "what",
  "when",
  "with",
  "would",
  "you",
  "your",
]);

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function toUnixTimestamp(timestamp?: number): number {
  if (!timestamp) return nowUnix();
  return Math.floor(timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function patternId(patternType: BehaviorPatternType, pattern: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${patternType}:${stableJson(pattern)}`)
    .digest("hex");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToEvent(row: BehaviorEventRow): BehaviorEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    chatId: row.chat_id,
    actionType: row.action_type as BehaviorActionType,
    action: row.action,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
  };
}

function rowToPattern(row: BehaviorPatternRow): BehaviorPattern {
  return {
    id: row.id,
    patternType: row.pattern_type,
    pattern: parseJsonObject(row.pattern),
    confidence: row.confidence,
    frequency: row.frequency,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
  };
}

export function normalizeActionText(text: string, maxLength = MAX_ACTION_LENGTH): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s./:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function behaviorActionKey(actionType: BehaviorActionType, action: string): string {
  return `${actionType}:${action}`;
}

export function extractTopics(text: string, limit = 6): string[] {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  const normalized = normalizeActionText(text, 500);
  const words = normalized.match(/[a-z0-9_+-]{3,}/g) ?? [];

  words.forEach((word, index) => {
    if (TOPIC_STOP_WORDS.has(word)) return;
    if (/^\d+$/.test(word)) return;
    const current = counts.get(word);
    if (current) {
      current.count++;
    } else {
      counts.set(word, { count: 1, firstSeen: index });
    }
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count || a[1].firstSeen - b[1].firstSeen)
    .slice(0, limit)
    .map(([word]) => word);
}

export function ensureBehaviorSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS behavior_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      chat_id     TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('message', 'tool')),
      action      TEXT NOT NULL,
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_behavior_events_session
      ON behavior_events(session_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_behavior_events_chat
      ON behavior_events(chat_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_behavior_events_action
      ON behavior_events(action_type, action);

    CREATE TABLE IF NOT EXISTS behavior_patterns (
      id           TEXT PRIMARY KEY,
      pattern_type TEXT NOT NULL CHECK(pattern_type IN ('sequential', 'temporal', 'contextual')),
      pattern      TEXT NOT NULL,
      confidence   REAL NOT NULL DEFAULT 0,
      frequency    INTEGER NOT NULL DEFAULT 1,
      last_seen    INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_behavior_patterns_type
      ON behavior_patterns(pattern_type, confidence DESC, frequency DESC);
    CREATE INDEX IF NOT EXISTS idx_behavior_patterns_last_seen
      ON behavior_patterns(last_seen DESC);

    CREATE TABLE IF NOT EXISTS prediction_feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint    TEXT NOT NULL,
      action      TEXT NOT NULL,
      confidence  REAL,
      reason      TEXT,
      helpful     INTEGER NOT NULL CHECK(helpful IN (0, 1)),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export class BehaviorTracker {
  private db: Database;
  private historyLimit: number;

  constructor(db: Database, opts: { historyLimit?: number } = {}) {
    this.db = db;
    this.historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    ensureBehaviorSchema(db);
  }

  recordMessage(opts: {
    sessionId: string;
    chatId: string;
    text: string;
    timestamp?: number;
  }): BehaviorEvent | null {
    const action = normalizeActionText(opts.text);
    if (!action) return null;
    return this.recordAction({
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      actionType: "message",
      action,
      metadata: { topics: extractTopics(opts.text) },
      timestamp: opts.timestamp,
    });
  }

  recordToolInvocation(opts: {
    sessionId: string;
    chatId: string;
    toolName: string;
    timestamp?: number;
  }): BehaviorEvent | null {
    const action = normalizeActionText(opts.toolName);
    if (!action) return null;
    return this.recordAction({
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      actionType: "tool",
      action,
      metadata: { tool: action },
      timestamp: opts.timestamp,
    });
  }

  getLatestEvent(filters: { sessionId?: string; chatId?: string } = {}): BehaviorEvent | null {
    let sql = `SELECT * FROM behavior_events WHERE 1=1`;
    const params: string[] = [];

    if (filters.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(filters.sessionId);
    }
    if (filters.chatId) {
      sql += ` AND chat_id = ?`;
      params.push(filters.chatId);
    }

    sql += ` ORDER BY created_at DESC, id DESC LIMIT 1`;
    const row = this.db.prepare(sql).get(...params) as BehaviorEventRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  private recordAction(opts: {
    sessionId: string;
    chatId: string;
    actionType: BehaviorActionType;
    action: string;
    metadata: Record<string, unknown>;
    timestamp?: number;
  }): BehaviorEvent {
    const createdAt = toUnixTimestamp(opts.timestamp);
    const previous = this.getLatestEvent({ sessionId: opts.sessionId });

    const result = this.db
      .prepare(
        `INSERT INTO behavior_events (session_id, chat_id, action_type, action, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.sessionId,
        opts.chatId,
        opts.actionType,
        opts.action,
        JSON.stringify(opts.metadata),
        createdAt
      );

    const event: BehaviorEvent = {
      id: Number(result.lastInsertRowid),
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      actionType: opts.actionType,
      action: opts.action,
      metadata: opts.metadata,
      createdAt,
    };

    if (previous) {
      this.observeSequential(previous, event);
    }
    upsertTemporalMetadata(this.db, "behavior", String(event.id), createdAt, {
      metadata: {
        sessionId: event.sessionId,
        chatId: event.chatId,
        actionType: event.actionType,
        action: event.action,
      },
    });
    this.observeTemporal(event);
    if (event.actionType === "tool") {
      this.observeContextualTool(event);
    }
    this.pruneEvents();

    return event;
  }

  private observeSequential(previous: BehaviorEvent, current: BehaviorEvent): void {
    const from = behaviorActionKey(previous.actionType, previous.action);
    const to = behaviorActionKey(current.actionType, current.action);
    this.incrementPattern("sequential", {
      from,
      to,
      fromType: previous.actionType,
      fromAction: previous.action,
      toType: current.actionType,
      toAction: current.action,
    });
    this.recomputeConfidence("sequential", (pattern) => pattern.from === from);
  }

  private observeTemporal(event: BehaviorEvent): void {
    const date = new Date(event.createdAt * 1000);
    const actionKey = behaviorActionKey(event.actionType, event.action);
    this.incrementPattern("temporal", {
      actionKey,
      actionType: event.actionType,
      action: event.action,
      dayOfWeek: date.getDay(),
      hour: date.getHours(),
    });
    this.recomputeConfidence("temporal", (pattern) => pattern.actionKey === actionKey);
  }

  private observeContextualTool(toolEvent: BehaviorEvent): void {
    const message = this.db
      .prepare(
        `SELECT * FROM behavior_events
         WHERE session_id = ? AND action_type = 'message'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(toolEvent.sessionId) as BehaviorEventRow | undefined;

    if (!message) return;
    const metadata = parseJsonObject(message.metadata);
    const topics = Array.isArray(metadata.topics)
      ? metadata.topics.filter((topic): topic is string => typeof topic === "string")
      : [];

    for (const topic of topics) {
      this.incrementPattern("contextual", {
        topic,
        tool: toolEvent.action,
      });
      this.recomputeConfidence("contextual", (pattern) => pattern.topic === topic);
    }
  }

  private incrementPattern(
    patternType: BehaviorPatternType,
    pattern: Record<string, unknown>
  ): string {
    const id = patternId(patternType, pattern);
    const serialized = JSON.stringify(pattern);
    this.db
      .prepare(
        `INSERT INTO behavior_patterns
           (id, pattern_type, pattern, confidence, frequency, last_seen, created_at)
         VALUES (?, ?, ?, 0, 1, unixepoch(), unixepoch())
         ON CONFLICT(id) DO UPDATE SET
           pattern = excluded.pattern,
           frequency = frequency + 1,
           last_seen = excluded.last_seen`
      )
      .run(id, patternType, serialized);
    return id;
  }

  private getPatterns(patternType: BehaviorPatternType): BehaviorPattern[] {
    const rows = this.db
      .prepare(`SELECT * FROM behavior_patterns WHERE pattern_type = ?`)
      .all(patternType) as BehaviorPatternRow[];
    return rows.map(rowToPattern);
  }

  private recomputeConfidence(
    patternType: BehaviorPatternType,
    predicate: (pattern: Record<string, unknown>) => boolean
  ): void {
    const patterns = this.getPatterns(patternType).filter((entry) => predicate(entry.pattern));
    const total = patterns.reduce((sum, pattern) => sum + pattern.frequency, 0);
    if (total <= 0) return;

    const update = this.db.prepare(`UPDATE behavior_patterns SET confidence = ? WHERE id = ?`);
    for (const pattern of patterns) {
      update.run(pattern.frequency / total, pattern.id);
    }
  }

  private pruneEvents(): void {
    if (this.historyLimit <= 0) return;
    this.db
      .prepare(
        `DELETE FROM behavior_events
         WHERE id NOT IN (
           SELECT id FROM behavior_events
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )`
      )
      .run(this.historyLimit);
  }
}

let _instance: BehaviorTracker | null = null;

export function initBehaviorTracker(
  db: Database,
  opts: { historyLimit?: number } = {}
): BehaviorTracker {
  _instance = new BehaviorTracker(db, opts);
  return _instance;
}

export function getBehaviorTracker(): BehaviorTracker | null {
  return _instance;
}
