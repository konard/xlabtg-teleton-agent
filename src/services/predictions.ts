import type { Database } from "better-sqlite3";
import {
  behaviorActionKey,
  ensureBehaviorSchema,
  extractTopics,
  normalizeActionText,
  type BehaviorActionType,
  type BehaviorPatternType,
} from "./behavior-tracker.js";

export interface Prediction {
  action: string;
  confidence: number;
  reason: string;
}

export type PredictionEndpoint = "next" | "tools" | "topics";

export interface PredictionQuery {
  sessionId?: string;
  chatId?: string;
  context?: string;
  currentAction?: string;
  confidenceThreshold?: number;
  limit?: number;
}

export interface PredictionFeedback {
  endpoint: PredictionEndpoint;
  action: string;
  confidence?: number;
  reason?: string;
  helpful: boolean;
}

interface PatternRow {
  id: string;
  pattern_type: BehaviorPatternType;
  pattern: string;
  confidence: number;
  frequency: number;
  last_seen: number;
}

interface EventRow {
  action_type: BehaviorActionType;
  action: string;
  metadata: string;
}

interface CountRow {
  action: string;
  count: number;
}

function parsePattern(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function threshold(query: PredictionQuery): number {
  return query.confidenceThreshold ?? 0.6;
}

function limit(query: PredictionQuery): number {
  return Math.max(1, Math.min(query.limit ?? 5, 10));
}

function normalizeConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sorted(predictions: Prediction[], query: PredictionQuery): Prediction[] {
  return predictions
    .filter((prediction) => prediction.confidence >= threshold(query))
    .sort((a, b) => b.confidence - a.confidence || a.action.localeCompare(b.action))
    .slice(0, limit(query));
}

function mergePrediction(
  byAction: Map<string, Prediction>,
  action: string,
  confidence: number,
  reason: string
): void {
  const normalized = normalizeConfidence(confidence);
  const existing = byAction.get(action);
  if (!existing || normalized > existing.confidence) {
    byAction.set(action, { action, confidence: normalized, reason });
  }
}

export class PredictionService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    ensureBehaviorSchema(db);
  }

  getNextActions(query: PredictionQuery = {}): Prediction[] {
    const currentKey = this.getCurrentActionKey(query);
    if (!currentKey) return [];

    const predictions: Prediction[] = [];
    for (const row of this.getPatternRows("sequential")) {
      const pattern = parsePattern(row.pattern);
      if (pattern.from !== currentKey) continue;
      if (typeof pattern.toAction !== "string") continue;
      const fromAction = typeof pattern.fromAction === "string" ? pattern.fromAction : "this";
      predictions.push({
        action: pattern.toAction,
        confidence: normalizeConfidence(row.confidence),
        reason: `Usually follows "${fromAction}" (${row.frequency} time${row.frequency === 1 ? "" : "s"})`,
      });
    }

    return sorted(predictions, query);
  }

  getLikelyTools(query: PredictionQuery = {}): Prediction[] {
    const topics = this.getContextTopics(query);
    const byAction = new Map<string, Prediction>();

    if (topics.length > 0) {
      for (const row of this.getPatternRows("contextual")) {
        const pattern = parsePattern(row.pattern);
        if (typeof pattern.topic !== "string" || typeof pattern.tool !== "string") continue;
        if (!topics.includes(pattern.topic)) continue;
        mergePrediction(
          byAction,
          pattern.tool,
          row.confidence,
          `Matched topic "${pattern.topic}" from prior tool usage`
        );
      }
    }

    const contextual = sorted(Array.from(byAction.values()), query);
    if (contextual.length > 0) return contextual;

    return this.getPopularToolPredictions(query);
  }

  getRelatedTopics(query: PredictionQuery = {}): Prediction[] {
    const topics = this.getContextTopics(query);
    const contextualRows = this.getPatternRows("contextual").map((row) => ({
      row,
      pattern: parsePattern(row.pattern),
    }));
    const byAction = new Map<string, Prediction>();

    if (topics.length > 0) {
      const tools = new Set<string>();
      for (const { pattern } of contextualRows) {
        if (typeof pattern.topic !== "string" || typeof pattern.tool !== "string") continue;
        if (topics.includes(pattern.topic)) tools.add(pattern.tool);
      }

      for (const { row, pattern } of contextualRows) {
        if (typeof pattern.topic !== "string" || typeof pattern.tool !== "string") continue;
        if (!tools.has(pattern.tool) || topics.includes(pattern.topic)) continue;
        mergePrediction(
          byAction,
          pattern.topic,
          row.confidence,
          `Often appears with tool "${pattern.tool}"`
        );
      }
    }

    if (byAction.size === 0) {
      const totals = new Map<string, number>();
      for (const { row, pattern } of contextualRows) {
        if (typeof pattern.topic !== "string") continue;
        totals.set(pattern.topic, (totals.get(pattern.topic) ?? 0) + row.frequency);
      }
      const max = Math.max(1, ...totals.values());
      for (const [topic, count] of totals) {
        mergePrediction(byAction, topic, count / max, `Frequent topic from ${count} event(s)`);
      }
    }

    return sorted(Array.from(byAction.values()), query);
  }

  recordFeedback(feedback: PredictionFeedback): void {
    this.db
      .prepare(
        `INSERT INTO prediction_feedback (endpoint, action, confidence, reason, helpful)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        feedback.endpoint,
        feedback.action,
        feedback.confidence ?? null,
        feedback.reason ?? null,
        feedback.helpful ? 1 : 0
      );
  }

  private getCurrentActionKey(query: PredictionQuery): string | null {
    const explicit = query.currentAction ?? query.context;
    if (explicit) {
      const action = normalizeActionText(explicit);
      return action ? behaviorActionKey("message", action) : null;
    }

    const clauses: string[] = [];
    const params: string[] = [];
    if (query.sessionId) {
      clauses.push("session_id = ?");
      params.push(query.sessionId);
    }
    if (query.chatId) {
      clauses.push("chat_id = ?");
      params.push(query.chatId);
    }
    const row = this.db
      .prepare(
        `SELECT action_type, action, metadata FROM behavior_events
         ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(...params) as EventRow | undefined;

    return row ? behaviorActionKey(row.action_type, row.action) : null;
  }

  private getContextTopics(query: PredictionQuery): string[] {
    if (query.context) {
      return extractTopics(query.context, 8);
    }

    const clauses: string[] = ["action_type = 'message'"];
    const params: string[] = [];
    if (query.sessionId) {
      clauses.push("session_id = ?");
      params.push(query.sessionId);
    }
    if (query.chatId) {
      clauses.push("chat_id = ?");
      params.push(query.chatId);
    }
    if (params.length === 0) return [];

    const row = this.db
      .prepare(
        `SELECT action_type, action, metadata FROM behavior_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(...params) as EventRow | undefined;

    if (!row) return [];
    const metadata = parsePattern(row.metadata);
    return Array.isArray(metadata.topics)
      ? metadata.topics.filter((topic): topic is string => typeof topic === "string")
      : [];
  }

  private getPopularToolPredictions(query: PredictionQuery): Prediction[] {
    const eventRows = this.db
      .prepare(
        `SELECT action, COUNT(*) AS count
         FROM behavior_events
         WHERE action_type = 'tool'
         GROUP BY action
         ORDER BY count DESC
         LIMIT ?`
      )
      .all(limit(query)) as CountRow[];

    const rows = eventRows.length > 0 ? eventRows : this.getRequestMetricToolRows(limit(query));
    if (rows.length === 0) return [];

    const max = Math.max(...rows.map((row) => row.count), 1);
    return sorted(
      rows.map((row) => ({
        action: row.action,
        confidence: row.count / max,
        reason: `Frequently used tool (${row.count} call${row.count === 1 ? "" : "s"})`,
      })),
      query
    );
  }

  private getRequestMetricToolRows(rowLimit: number): CountRow[] {
    try {
      return this.db
        .prepare(
          `SELECT tool_name AS action, COUNT(*) AS count
           FROM request_metrics
           WHERE tool_name IS NOT NULL
           GROUP BY tool_name
           ORDER BY count DESC
           LIMIT ?`
        )
        .all(rowLimit) as CountRow[];
    } catch {
      return [];
    }
  }

  private getPatternRows(patternType: BehaviorPatternType): PatternRow[] {
    return this.db
      .prepare(
        `SELECT id, pattern_type, pattern, confidence, frequency, last_seen
         FROM behavior_patterns
         WHERE pattern_type = ?`
      )
      .all(patternType) as PatternRow[];
  }
}

let _instance: PredictionService | null = null;

export function initPredictions(db: Database): PredictionService {
  _instance = new PredictionService(db);
  return _instance;
}

export function getPredictions(): PredictionService | null {
  return _instance;
}
