import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { extractTopics } from "../behavior-tracker.js";

export type FeedbackType = "positive" | "negative" | "rating" | "text" | "implicit";

export interface FeedbackInput {
  sessionId: string;
  messageId?: string | null;
  type: FeedbackType;
  rating?: number | null;
  text?: string | null;
  tags?: string[];
  implicitSignals?: Record<string, unknown>;
  topic?: string | null;
  agentType?: string | null;
  createdAt?: number;
}

export interface FeedbackRecord {
  id: number;
  sessionId: string;
  messageId: string | null;
  type: FeedbackType;
  rating: number | null;
  text: string | null;
  tags: string[];
  implicitSignals: Record<string, unknown>;
  topic: string | null;
  agentType: string | null;
  createdAt: number;
}

export interface FeedbackQuery {
  sessionId?: string;
  messageId?: string;
  type?: FeedbackType;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface FeedbackResponseInput {
  id?: string;
  sessionId: string;
  chatId: string;
  messageId?: string | null;
  userMessage: string;
  responseText: string;
  toolsUsed?: string[];
  timestamp?: number;
}

export interface FeedbackResponseRecord {
  id: string;
  sessionId: string;
  chatId: string;
  messageId: string;
  userMessage: string;
  responseText: string;
  toolsUsed: string[];
  createdAt: number;
  implicitProcessedAt: number | null;
}

export interface ImplicitSignalOptions {
  correctionWindowSeconds?: number;
  rephraseWindowSeconds?: number;
  acceptanceDelaySeconds?: number;
  rephraseSimilarityThreshold?: number;
}

export interface ObserveImplicitInput {
  sessionId: string;
  chatId: string;
  userMessage: string;
  timestamp?: number;
}

interface FeedbackRow {
  id: number;
  session_id: string;
  message_id: string | null;
  type: FeedbackType;
  rating: number | null;
  text: string | null;
  tags: string;
  implicit_signals: string;
  topic: string | null;
  agent_type: string | null;
  created_at: number;
}

interface FeedbackResponseRow {
  id: string;
  session_id: string;
  chat_id: string;
  message_id: string | null;
  user_message: string;
  response_text: string;
  tools_used: string;
  created_at: number;
  implicit_processed_at: number | null;
}

const MAX_TEXT_LENGTH = 4000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;
const DEFAULT_IMPLICIT: Required<ImplicitSignalOptions> = {
  correctionWindowSeconds: 10 * 60,
  rephraseWindowSeconds: 30 * 60,
  acceptanceDelaySeconds: 5 * 60,
  rephraseSimilarityThreshold: 0.45,
};

const CORRECTION_PATTERN =
  /\b(no|wrong|incorrect|actually|mistake|fix|correct|correction|error|instead|not what|doesn'?t work|didn'?t work|that is not|that's not)\b/i;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function toUnixTimestamp(timestamp?: number): number {
  if (!timestamp) return nowUnix();
  return Math.floor(timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp);
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const clean = tag
      .trim()
      .toLowerCase()
      .replace(/[^\w:+-]/g, "_")
      .slice(0, MAX_TAG_LENGTH);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
    if (normalized.length >= MAX_TAGS) break;
  }
  return normalized;
}

function clampRating(rating: number | null | undefined): number | null {
  if (rating === null || rating === undefined || Number.isNaN(rating)) return null;
  return Math.max(1, Math.min(5, Math.round(rating)));
}

function defaultRating(type: FeedbackType, rating: number | null | undefined): number | null {
  const clamped = clampRating(rating);
  if (clamped !== null) return clamped;
  if (type === "positive") return 5;
  if (type === "negative") return 1;
  return null;
}

function cleanText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

function tokenSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s+-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
  return new Set(words);
}

function jaccardSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

export function feedbackRowToRecord(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    type: row.type,
    rating: row.rating,
    text: row.text,
    tags: parseJsonArray(row.tags),
    implicitSignals: parseJsonObject(row.implicit_signals),
    topic: row.topic,
    agentType: row.agent_type,
    createdAt: row.created_at,
  };
}

function responseRowToRecord(row: FeedbackResponseRow): FeedbackResponseRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    chatId: row.chat_id,
    messageId: row.message_id ?? row.id,
    userMessage: row.user_message,
    responseText: row.response_text,
    toolsUsed: parseJsonArray(row.tools_used),
    createdAt: row.created_at,
    implicitProcessedAt: row.implicit_processed_at,
  };
}

export function ensureFeedbackSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       TEXT NOT NULL,
      message_id       TEXT,
      type             TEXT NOT NULL CHECK(type IN ('positive', 'negative', 'rating', 'text', 'implicit')),
      rating           INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
      text             TEXT,
      tags             TEXT NOT NULL DEFAULT '[]',
      implicit_signals TEXT NOT NULL DEFAULT '{}',
      topic            TEXT,
      agent_type       TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_session
      ON feedback(session_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_message
      ON feedback(message_id, created_at DESC) WHERE message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_feedback_type
      ON feedback(type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_rating
      ON feedback(rating, created_at DESC) WHERE rating IS NOT NULL;

    CREATE TABLE IF NOT EXISTS feedback_responses (
      id                    TEXT PRIMARY KEY,
      session_id            TEXT NOT NULL,
      chat_id               TEXT NOT NULL,
      message_id            TEXT,
      user_message          TEXT NOT NULL,
      response_text         TEXT NOT NULL,
      tools_used            TEXT NOT NULL DEFAULT '[]',
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      implicit_processed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_responses_session
      ON feedback_responses(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_responses_chat
      ON feedback_responses(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_responses_message
      ON feedback_responses(message_id) WHERE message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS feedback_preferences (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      source     TEXT NOT NULL DEFAULT 'learned' CHECK(source IN ('learned', 'manual')),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export class FeedbackCaptureService {
  private db: Database;
  private implicitOptions: Required<ImplicitSignalOptions>;

  constructor(db: Database, implicitOptions: ImplicitSignalOptions = {}) {
    this.db = db;
    this.implicitOptions = {
      correctionWindowSeconds:
        implicitOptions.correctionWindowSeconds ?? DEFAULT_IMPLICIT.correctionWindowSeconds,
      rephraseWindowSeconds:
        implicitOptions.rephraseWindowSeconds ?? DEFAULT_IMPLICIT.rephraseWindowSeconds,
      acceptanceDelaySeconds:
        implicitOptions.acceptanceDelaySeconds ?? DEFAULT_IMPLICIT.acceptanceDelaySeconds,
      rephraseSimilarityThreshold:
        implicitOptions.rephraseSimilarityThreshold ?? DEFAULT_IMPLICIT.rephraseSimilarityThreshold,
    };
    ensureFeedbackSchema(db);
  }

  submitFeedback(input: FeedbackInput): FeedbackRecord {
    const sessionId = input.sessionId.trim();
    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    const type = input.type;
    const tags = normalizeTags(input.tags);
    const text = cleanText(input.text);
    const rating = defaultRating(type, input.rating);
    const createdAt = toUnixTimestamp(input.createdAt);
    const implicitSignals = input.implicitSignals ?? {};
    const topic =
      cleanText(input.topic) ??
      (text ? extractTopics(text, 1)[0] : undefined) ??
      (input.implicitSignals?.topic as string | undefined) ??
      null;

    const result = this.db
      .prepare(
        `INSERT INTO feedback
           (session_id, message_id, type, rating, text, tags, implicit_signals, topic, agent_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        input.messageId ?? null,
        type,
        rating,
        text,
        JSON.stringify(tags),
        JSON.stringify(implicitSignals),
        topic,
        cleanText(input.agentType),
        createdAt
      );

    return this.getFeedbackById(Number(result.lastInsertRowid));
  }

  listFeedback(query: FeedbackQuery = {}): FeedbackRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.sessionId) {
      clauses.push("session_id = ?");
      params.push(query.sessionId);
    }
    if (query.messageId) {
      clauses.push("message_id = ?");
      params.push(query.messageId);
    }
    if (query.type) {
      clauses.push("type = ?");
      params.push(query.type);
    }
    if (query.from !== undefined) {
      clauses.push("created_at >= ?");
      params.push(toUnixTimestamp(query.from));
    }
    if (query.to !== undefined) {
      clauses.push("created_at <= ?");
      params.push(toUnixTimestamp(query.to));
    }

    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const offset = Math.max(0, query.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT * FROM feedback
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as FeedbackRow[];

    return rows.map(feedbackRowToRecord);
  }

  countFeedback(query: Omit<FeedbackQuery, "limit" | "offset"> = {}): number {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.sessionId) {
      clauses.push("session_id = ?");
      params.push(query.sessionId);
    }
    if (query.messageId) {
      clauses.push("message_id = ?");
      params.push(query.messageId);
    }
    if (query.type) {
      clauses.push("type = ?");
      params.push(query.type);
    }
    if (query.from !== undefined) {
      clauses.push("created_at >= ?");
      params.push(toUnixTimestamp(query.from));
    }
    if (query.to !== undefined) {
      clauses.push("created_at <= ?");
      params.push(toUnixTimestamp(query.to));
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM feedback ${where}`)
      .get(...params) as { count: number };
    return row.count;
  }

  recordResponse(input: FeedbackResponseInput): FeedbackResponseRecord {
    const id = input.id ?? randomUUID();
    const createdAt = toUnixTimestamp(input.timestamp);
    const messageId = input.messageId ?? id;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO feedback_responses
           (id, session_id, chat_id, message_id, user_message, response_text, tools_used, created_at, implicit_processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT implicit_processed_at FROM feedback_responses WHERE id = ?), NULL))`
      )
      .run(
        id,
        input.sessionId,
        input.chatId,
        messageId,
        input.userMessage.slice(0, MAX_TEXT_LENGTH),
        input.responseText.slice(0, MAX_TEXT_LENGTH),
        JSON.stringify(normalizeTags(input.toolsUsed).map((tool) => tool.replace(/^tool:/, ""))),
        createdAt,
        id
      );

    const row = this.db
      .prepare(`SELECT * FROM feedback_responses WHERE id = ?`)
      .get(id) as FeedbackResponseRow;
    return responseRowToRecord(row);
  }

  observeImplicitSignals(input: ObserveImplicitInput): FeedbackRecord | null {
    const timestamp = toUnixTimestamp(input.timestamp);
    const previous = this.db
      .prepare(
        `SELECT * FROM feedback_responses
         WHERE session_id = ?
           AND chat_id = ?
           AND created_at < ?
           AND implicit_processed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(input.sessionId, input.chatId, timestamp) as FeedbackResponseRow | undefined;

    if (!previous) return null;

    const response = responseRowToRecord(previous);
    const delaySeconds = Math.max(0, timestamp - response.createdAt);
    const similarity = jaccardSimilarity(response.userMessage, input.userMessage);
    const tags: string[] = [];
    const signals: Record<string, unknown> = {
      response_delay_seconds: delaySeconds,
      previous_response_id: response.id,
      previous_user_similarity: Number(similarity.toFixed(3)),
      tools_used: response.toolsUsed,
    };

    let rating: number | null = null;
    if (
      delaySeconds <= this.implicitOptions.correctionWindowSeconds &&
      CORRECTION_PATTERN.test(input.userMessage)
    ) {
      tags.push("follow_up_correction");
      signals.follow_up_correction = true;
      rating = 2;
    } else if (
      delaySeconds <= this.implicitOptions.rephraseWindowSeconds &&
      similarity >= this.implicitOptions.rephraseSimilarityThreshold
    ) {
      tags.push("rephrased_question");
      signals.rephrased_question = true;
      rating = 2;
    } else if (delaySeconds >= this.implicitOptions.acceptanceDelaySeconds) {
      tags.push("accepted_without_modification");
      signals.accepted_without_modification = true;
      rating = 4;
    }

    this.markResponseImplicitProcessed(response.id, timestamp);
    if (rating === null) return null;

    return this.submitFeedback({
      sessionId: input.sessionId,
      messageId: response.messageId,
      type: "implicit",
      rating,
      tags,
      implicitSignals: signals,
      topic: extractTopics(response.userMessage, 1)[0] ?? null,
      createdAt: timestamp,
    });
  }

  private markResponseImplicitProcessed(responseId: string, timestamp: number): void {
    this.db
      .prepare(`UPDATE feedback_responses SET implicit_processed_at = ? WHERE id = ?`)
      .run(timestamp, responseId);
  }

  private getFeedbackById(id: number): FeedbackRecord {
    const row = this.db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(id) as
      | FeedbackRow
      | undefined;
    if (!row) throw new Error(`Feedback row not found: ${id}`);
    return feedbackRowToRecord(row);
  }
}

let _instance: FeedbackCaptureService | null = null;

export function initFeedback(
  db: Database,
  implicitOptions: ImplicitSignalOptions = {}
): FeedbackCaptureService {
  _instance = new FeedbackCaptureService(db, implicitOptions);
  return _instance;
}

export function getFeedback(): FeedbackCaptureService | null {
  return _instance;
}
