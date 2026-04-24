import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  CorrectionLogEntry,
  CorrectionLogInput,
  CorrectionPattern,
  OutputEvaluation,
  ReflectionPlan,
} from "./types.js";

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class CorrectionLogger {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  record(input: CorrectionLogInput): CorrectionLogEntry {
    const id = randomUUID();
    const correctedScore = input.correctedScore ?? null;
    const scoreDelta =
      correctedScore === null ? 0 : Number((correctedScore - input.evaluation.score).toFixed(4));

    this.db
      .prepare(
        `
        INSERT INTO correction_logs (
          id, session_id, task_id, chat_id, iteration, original_output, evaluation,
          reflection, corrected_output, score, corrected_score, score_delta,
          threshold, escalated, tool_recovery
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.sessionId,
        input.taskId ?? null,
        input.chatId,
        input.iteration,
        input.originalOutput,
        JSON.stringify(input.evaluation),
        input.reflection ? JSON.stringify(input.reflection) : null,
        input.correctedOutput ?? null,
        input.evaluation.score,
        correctedScore,
        scoreDelta,
        input.threshold,
        input.escalated ? 1 : 0,
        JSON.stringify(input.toolRecoveries)
      );

    const saved = this.get(id);
    if (!saved) {
      throw new Error(`Correction log ${id} was not persisted`);
    }
    return saved;
  }

  get(id: string): CorrectionLogEntry | null {
    const row = this.db.prepare(`SELECT * FROM correction_logs WHERE id = ?`).get(id);
    return row ? this.mapRow(row as CorrectionLogRow) : null;
  }

  listForSession(sessionId: string, limit = 50): CorrectionLogEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM correction_logs
        WHERE session_id = ?
        ORDER BY created_at ASC, iteration ASC
        LIMIT ?
      `
      )
      .all(sessionId, limit) as CorrectionLogRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listForTask(taskId: string, limit = 50): CorrectionLogEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM correction_logs
        WHERE task_id = ?
        ORDER BY created_at ASC, iteration ASC
        LIMIT ?
      `
      )
      .all(taskId, limit) as CorrectionLogRow[];
    return rows.map((row) => this.mapRow(row));
  }

  countForTask(taskId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM correction_logs WHERE task_id = ?`)
      .get(taskId) as { count: number };
    return row.count;
  }

  getRecurringPatterns(limit = 10): CorrectionPattern[] {
    const rows = this.db
      .prepare(
        `
        SELECT evaluation, created_at
        FROM correction_logs
        ORDER BY created_at DESC
        LIMIT 500
      `
      )
      .all() as Array<{ evaluation: string; created_at: number }>;

    const patterns = new Map<string, CorrectionPattern>();
    const addPattern = (key: string, label: string, createdAt: number) => {
      const existing = patterns.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeenAt = Math.max(existing.lastSeenAt, createdAt);
      } else {
        patterns.set(key, { key, label, count: 1, lastSeenAt: createdAt });
      }
    };

    for (const row of rows) {
      const evaluation = parseJson<OutputEvaluation | null>(row.evaluation, null);
      if (!evaluation) continue;
      for (const [criterion, score] of Object.entries(evaluation.criteria)) {
        if (score < 0.7) {
          addPattern(`criterion:${criterion}`, `Low ${criterion} score`, row.created_at);
        }
      }
      for (const issue of evaluation.issues) {
        const normalized = issue.trim().toLowerCase().slice(0, 120);
        if (normalized) addPattern(`issue:${normalized}`, issue.trim(), row.created_at);
      }
    }

    return Array.from(patterns.values())
      .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
      .slice(0, limit);
  }

  private mapRow(row: CorrectionLogRow): CorrectionLogEntry {
    const evaluation = parseJson<OutputEvaluation>(row.evaluation, {
      score: row.score,
      feedback: "Evaluation unavailable.",
      criteria: { completeness: 0, correctness: 0, toolUsage: 0, formatting: 0 },
      issues: [],
      needsCorrection: row.score < row.threshold,
    });
    const reflection = parseJson<ReflectionPlan | null>(row.reflection, null);
    return {
      id: row.id,
      sessionId: row.session_id,
      taskId: row.task_id,
      chatId: row.chat_id,
      iteration: row.iteration,
      originalOutput: row.original_output,
      evaluation,
      reflection,
      correctedOutput: row.corrected_output,
      score: row.score,
      correctedScore: row.corrected_score,
      scoreDelta: row.score_delta,
      threshold: row.threshold,
      escalated: row.escalated === 1,
      toolRecoveries: parseJson(row.tool_recovery, []),
      feedback: evaluation.feedback,
      createdAt: row.created_at,
    };
  }
}

interface CorrectionLogRow {
  id: string;
  session_id: string;
  task_id: string | null;
  chat_id: string;
  iteration: number;
  original_output: string;
  evaluation: string;
  reflection: string | null;
  corrected_output: string | null;
  score: number;
  corrected_score: number | null;
  score_delta: number;
  threshold: number;
  escalated: number;
  tool_recovery: string;
  created_at: number;
}
