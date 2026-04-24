import type { Database } from "better-sqlite3";
import {
  ensureFeedbackSchema,
  feedbackRowToRecord,
  toUnixTimestamp,
  type FeedbackRecord,
} from "./capture.js";

export interface FeedbackTheme {
  theme: string;
  label: string;
  count: number;
  positive: number;
  negative: number;
  neutral: number;
  averageRating: number | null;
  lastSeen: number;
}

export interface FeedbackTrendPoint {
  date: string;
  count: number;
  averageRating: number | null;
  satisfactionScore: number | null;
  positive: number;
  negative: number;
}

export interface FeedbackAnalytics {
  totalFeedback: number;
  explicitFeedback: number;
  implicitFeedback: number;
  averageRating: number | null;
  satisfactionScore: number | null;
  improvementTrend: number | null;
  feedbackCoverage: number | null;
  topImprovementOpportunities: FeedbackTheme[];
  trend: FeedbackTrendPoint[];
}

interface FeedbackRow {
  id: number;
  session_id: string;
  message_id: string | null;
  type: FeedbackRecord["type"];
  rating: number | null;
  text: string | null;
  tags: string;
  implicit_signals: string;
  topic: string | null;
  agent_type: string | null;
  created_at: number;
}

interface CountRow {
  count: number;
}

const THEME_LABELS: Record<string, string> = {
  too_verbose: "Too verbose",
  too_brief: "Too brief",
  incorrect: "Incorrect answer",
  unclear: "Unclear response",
  code_quality: "Code quality",
  tool_selection: "Tool selection",
  helpful: "Helpful response",
  tone: "Tone",
  implicit_acceptance: "Implicit acceptance",
};

function ratingFor(record: FeedbackRecord): number | null {
  if (record.rating !== null) return record.rating;
  if (record.type === "positive") return 5;
  if (record.type === "negative") return 1;
  return null;
}

function sentimentFor(record: FeedbackRecord): "positive" | "negative" | "neutral" {
  const rating = ratingFor(record);
  if (rating !== null) {
    if (rating >= 4) return "positive";
    if (rating <= 2) return "negative";
  }
  if (record.type === "positive") return "positive";
  if (record.type === "negative") return "negative";
  return "neutral";
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function extractFeedbackThemes(record: FeedbackRecord): string[] {
  const text = `${record.text ?? ""} ${record.tags.join(" ")}`.toLowerCase();
  const signals = record.implicitSignals;
  const themes = new Set<string>();

  if (hasAny(text, ["too_long", "too long", "verbose", "wordy", "rambling"])) {
    themes.add("too_verbose");
  }
  if (hasAny(text, ["too_short", "too short", "brief", "more detail", "shallow"])) {
    themes.add("too_brief");
  }
  if (hasAny(text, ["wrong", "incorrect", "false", "mistake", "error", "not true"])) {
    themes.add("incorrect");
  }
  if (hasAny(text, ["unclear", "confusing", "ambiguous", "hard to follow"])) {
    themes.add("unclear");
  }
  if (hasAny(text, ["code", "example", "test", "doesn", "didn", "compile", "broken"])) {
    themes.add("code_quality");
  }
  if (hasAny(text, ["wrong_tool", "tool", "search", "command", "should have used"])) {
    themes.add("tool_selection");
  }
  if (hasAny(text, ["helpful", "works", "good", "great", "useful", "accepted"])) {
    themes.add("helpful");
  }
  if (hasAny(text, ["tone", "formal", "casual", "rude", "friendly"])) {
    themes.add("tone");
  }
  if (signals.accepted_without_modification === true) {
    themes.add("implicit_acceptance");
  }
  if (signals.follow_up_correction === true || signals.rephrased_question === true) {
    themes.add("incorrect");
  }

  return Array.from(themes);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function satisfactionFromRating(avgRating: number | null): number | null {
  if (avgRating === null) return null;
  return Math.round((avgRating / 5) * 1000) / 10;
}

function dayKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export class FeedbackAnalyzer {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    ensureFeedbackSchema(db);
  }

  getThemes(opts: { periodDays?: number; limit?: number } = {}): FeedbackTheme[] {
    const records = this.listForPeriod(opts.periodDays ?? 30);
    const stats = new Map<
      string,
      {
        count: number;
        positive: number;
        negative: number;
        neutral: number;
        ratings: number[];
        lastSeen: number;
      }
    >();

    for (const record of records) {
      const themes = extractFeedbackThemes(record);
      if (themes.length === 0) continue;
      const sentiment = sentimentFor(record);
      const rating = ratingFor(record);
      for (const theme of themes) {
        const entry = stats.get(theme) ?? {
          count: 0,
          positive: 0,
          negative: 0,
          neutral: 0,
          ratings: [],
          lastSeen: 0,
        };
        entry.count++;
        entry[sentiment]++;
        if (rating !== null) entry.ratings.push(rating);
        entry.lastSeen = Math.max(entry.lastSeen, record.createdAt);
        stats.set(theme, entry);
      }
    }

    return Array.from(stats.entries())
      .map(([theme, entry]) => ({
        theme,
        label: THEME_LABELS[theme] ?? theme.replace(/_/g, " "),
        count: entry.count,
        positive: entry.positive,
        negative: entry.negative,
        neutral: entry.neutral,
        averageRating: average(entry.ratings),
        lastSeen: entry.lastSeen,
      }))
      .sort(
        (a, b) => b.count - a.count || b.negative - a.negative || a.theme.localeCompare(b.theme)
      )
      .slice(0, Math.max(1, Math.min(opts.limit ?? 20, 50)));
  }

  getAnalytics(opts: { periodDays?: number } = {}): FeedbackAnalytics {
    const periodDays = opts.periodDays ?? 30;
    const records = this.listForPeriod(periodDays);
    const ratings = records.map(ratingFor).filter((rating): rating is number => rating !== null);
    const averageRating = average(ratings);
    const themes = this.getThemes({ periodDays, limit: 20 });
    const trend = this.buildTrend(records);
    const firstHalf = records.slice(Math.floor(records.length / 2));
    const secondHalf = records.slice(0, Math.floor(records.length / 2));
    const firstAvg = average(firstHalf.map(ratingFor).filter((r): r is number => r !== null));
    const secondAvg = average(secondHalf.map(ratingFor).filter((r): r is number => r !== null));
    const feedbackCoverage = this.getFeedbackCoverage(periodDays, records.length);

    return {
      totalFeedback: records.length,
      explicitFeedback: records.filter((record) => record.type !== "implicit").length,
      implicitFeedback: records.filter((record) => record.type === "implicit").length,
      averageRating,
      satisfactionScore: satisfactionFromRating(averageRating),
      improvementTrend:
        firstAvg !== null && secondAvg !== null
          ? Math.round((secondAvg - firstAvg) * 100) / 100
          : null,
      feedbackCoverage,
      topImprovementOpportunities: themes
        .filter((theme) => theme.negative > theme.positive)
        .sort((a, b) => b.negative - a.negative || b.count - a.count)
        .slice(0, 5),
      trend,
    };
  }

  private listForPeriod(periodDays: number): FeedbackRecord[] {
    const since = Math.floor(Date.now() / 1000) - Math.max(1, periodDays) * 86400;
    const rows = this.db
      .prepare(`SELECT * FROM feedback WHERE created_at >= ? ORDER BY created_at DESC, id DESC`)
      .all(since) as FeedbackRow[];
    return rows.map(feedbackRowToRecord);
  }

  private buildTrend(records: FeedbackRecord[]): FeedbackTrendPoint[] {
    const byDay = new Map<string, FeedbackRecord[]>();
    for (const record of records) {
      const key = dayKey(record.createdAt);
      const list = byDay.get(key) ?? [];
      list.push(record);
      byDay.set(key, list);
    }

    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, dayRecords]) => {
        const ratings = dayRecords
          .map(ratingFor)
          .filter((rating): rating is number => rating !== null);
        const avgRating = average(ratings);
        return {
          date,
          count: dayRecords.length,
          averageRating: avgRating,
          satisfactionScore: satisfactionFromRating(avgRating),
          positive: dayRecords.filter((record) => sentimentFor(record) === "positive").length,
          negative: dayRecords.filter((record) => sentimentFor(record) === "negative").length,
        };
      });
  }

  private getFeedbackCoverage(periodDays: number, feedbackCount: number): number | null {
    const since = toUnixTimestamp(Date.now() - Math.max(1, periodDays) * 86400 * 1000);
    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM tg_messages
           WHERE is_from_agent = 1
             AND (CASE WHEN timestamp > 10000000000 THEN timestamp / 1000 ELSE timestamp END) >= ?`
        )
        .get(since) as CountRow;
      if (row.count <= 0) return null;
      return Math.round((feedbackCount / row.count) * 1000) / 10;
    } catch {
      return null;
    }
  }
}
