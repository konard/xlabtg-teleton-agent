import type { Database } from "better-sqlite3";
import { ensureFeedbackSchema } from "./capture.js";
import { FeedbackAnalyzer } from "./analyzer.js";

export type ResponseLengthPreference = "concise" | "balanced" | "detailed";
export type CodeStylePreference = "clean" | "commented" | "verified_examples";
export type InteractionStylePreference = "direct" | "neutral" | "supportive";
export type ToolSelectionPreference = "conservative" | "normal" | "exploratory";

export interface PreferenceEntry<T extends string> {
  value: T;
  confidence: number;
  source: "learned" | "manual";
  updatedAt: number | null;
}

export interface FeedbackPreferenceProfile {
  responseLength: PreferenceEntry<ResponseLengthPreference>;
  codeStyle: PreferenceEntry<CodeStylePreference>;
  interactionStyle: PreferenceEntry<InteractionStylePreference>;
  toolSelection: PreferenceEntry<ToolSelectionPreference>;
}

export interface PreferenceUpdate {
  responseLength?: ResponseLengthPreference;
  codeStyle?: CodeStylePreference;
  interactionStyle?: InteractionStylePreference;
  toolSelection?: ToolSelectionPreference;
}

interface PreferenceRow {
  key: string;
  value: string;
  confidence: number;
  source: "learned" | "manual";
  updated_at: number;
}

const RESPONSE_LENGTH_VALUES = new Set<ResponseLengthPreference>([
  "concise",
  "balanced",
  "detailed",
]);
const CODE_STYLE_VALUES = new Set<CodeStylePreference>(["clean", "commented", "verified_examples"]);
const INTERACTION_STYLE_VALUES = new Set<InteractionStylePreference>([
  "direct",
  "neutral",
  "supportive",
]);
const TOOL_SELECTION_VALUES = new Set<ToolSelectionPreference>([
  "conservative",
  "normal",
  "exploratory",
]);

function confidenceFromDelta(primary: number, secondary: number): number {
  const total = primary + secondary;
  if (total === 0) return 0.25;
  return Math.max(0.35, Math.min(0.9, primary / total));
}

export class FeedbackLearner {
  private db: Database;
  private analyzer: FeedbackAnalyzer;

  constructor(db: Database) {
    this.db = db;
    ensureFeedbackSchema(db);
    this.analyzer = new FeedbackAnalyzer(db);
  }

  getPreferences(): FeedbackPreferenceProfile {
    const learned = this.inferPreferences();
    const rows = this.getPreferenceRows();
    return {
      responseLength: this.resolvePreference(
        rows,
        "response_length",
        learned.responseLength,
        RESPONSE_LENGTH_VALUES
      ),
      codeStyle: this.resolvePreference(rows, "code_style", learned.codeStyle, CODE_STYLE_VALUES),
      interactionStyle: this.resolvePreference(
        rows,
        "interaction_style",
        learned.interactionStyle,
        INTERACTION_STYLE_VALUES
      ),
      toolSelection: this.resolvePreference(
        rows,
        "tool_selection",
        learned.toolSelection,
        TOOL_SELECTION_VALUES
      ),
    };
  }

  updatePreferences(update: PreferenceUpdate): FeedbackPreferenceProfile {
    if (update.responseLength) {
      this.assertAllowed(update.responseLength, RESPONSE_LENGTH_VALUES, "responseLength");
      this.upsertPreference("response_length", update.responseLength);
    }
    if (update.codeStyle) {
      this.assertAllowed(update.codeStyle, CODE_STYLE_VALUES, "codeStyle");
      this.upsertPreference("code_style", update.codeStyle);
    }
    if (update.interactionStyle) {
      this.assertAllowed(update.interactionStyle, INTERACTION_STYLE_VALUES, "interactionStyle");
      this.upsertPreference("interaction_style", update.interactionStyle);
    }
    if (update.toolSelection) {
      this.assertAllowed(update.toolSelection, TOOL_SELECTION_VALUES, "toolSelection");
      this.upsertPreference("tool_selection", update.toolSelection);
    }
    return this.getPreferences();
  }

  buildPromptAdjustment(opts: { minThemeCount?: number } = {}): string {
    const minThemeCount = opts.minThemeCount ?? 2;
    const profile = this.getPreferences();
    const themes = this.analyzer.getThemes({ periodDays: 90, limit: 10 });
    const lines: string[] = [];

    if (profile.responseLength.value === "concise") {
      lines.push("Keep responses concise and avoid unnecessary elaboration.");
    } else if (profile.responseLength.value === "detailed") {
      lines.push("Include enough detail and context when answering non-trivial requests.");
    }

    if (profile.codeStyle.value === "verified_examples") {
      lines.push("When giving code, prefer runnable examples and call out assumptions.");
    } else if (profile.codeStyle.value === "commented") {
      lines.push("Add short comments for non-obvious code choices.");
    }

    if (profile.interactionStyle.value === "direct") {
      lines.push("Use a direct, task-focused interaction style.");
    } else if (profile.interactionStyle.value === "supportive") {
      lines.push("Use a warmer tone while staying precise.");
    }

    if (profile.toolSelection.value === "conservative") {
      lines.push("Select tools conservatively and verify tool results before relying on them.");
    }

    for (const theme of themes) {
      if (theme.count < minThemeCount || theme.negative <= theme.positive) continue;
      if (theme.theme === "incorrect") {
        lines.push(
          "Double-check factual claims and reconcile conflicts before presenting an answer."
        );
      } else if (theme.theme === "unclear") {
        lines.push("State assumptions explicitly when a request can be interpreted multiple ways.");
      } else if (theme.theme === "tool_selection") {
        lines.push("Prefer the most specific available tool for the user's current task.");
      } else if (theme.theme === "code_quality") {
        lines.push("For code answers, include commands or tests that can verify the result.");
      }
    }

    const unique = Array.from(new Set(lines));
    if (unique.length === 0) return "";
    return `[Learned feedback preferences]\n${unique.map((line) => `- ${line}`).join("\n")}`;
  }

  private inferPreferences(): FeedbackPreferenceProfile {
    const themes = this.analyzer.getThemes({ periodDays: 90, limit: 50 });
    const count = (theme: string) => themes.find((entry) => entry.theme === theme)?.negative ?? 0;
    const tooVerbose = count("too_verbose");
    const tooBrief = count("too_brief");
    const codeQuality = count("code_quality");
    const toolSelection = count("tool_selection");
    const unclear = count("unclear");

    const responseLength =
      tooVerbose >= 2 && tooVerbose >= tooBrief
        ? {
            value: "concise" as const,
            confidence: confidenceFromDelta(tooVerbose, tooBrief),
          }
        : tooBrief >= 2
          ? {
              value: "detailed" as const,
              confidence: confidenceFromDelta(tooBrief, tooVerbose),
            }
          : { value: "balanced" as const, confidence: 0.35 };

    const codeStyle =
      codeQuality >= 2
        ? {
            value: "verified_examples" as const,
            confidence: Math.min(0.9, 0.45 + codeQuality * 0.1),
          }
        : { value: "clean" as const, confidence: 0.35 };

    const interactionStyle =
      tooVerbose + unclear >= 2
        ? {
            value: "direct" as const,
            confidence: Math.min(0.85, 0.4 + (tooVerbose + unclear) * 0.08),
          }
        : { value: "neutral" as const, confidence: 0.35 };

    const toolPreference =
      toolSelection >= 2
        ? {
            value: "conservative" as const,
            confidence: Math.min(0.85, 0.4 + toolSelection * 0.1),
          }
        : { value: "normal" as const, confidence: 0.35 };

    return {
      responseLength: {
        ...responseLength,
        source: "learned",
        updatedAt: null,
      },
      codeStyle: {
        ...codeStyle,
        source: "learned",
        updatedAt: null,
      },
      interactionStyle: {
        ...interactionStyle,
        source: "learned",
        updatedAt: null,
      },
      toolSelection: {
        ...toolPreference,
        source: "learned",
        updatedAt: null,
      },
    };
  }

  private getPreferenceRows(): Map<string, PreferenceRow> {
    const rows = this.db
      .prepare(`SELECT key, value, confidence, source, updated_at FROM feedback_preferences`)
      .all() as PreferenceRow[];
    return new Map(rows.map((row) => [row.key, row]));
  }

  private resolvePreference<T extends string>(
    rows: Map<string, PreferenceRow>,
    key: string,
    learned: PreferenceEntry<T>,
    allowed: Set<T>
  ): PreferenceEntry<T> {
    const row = rows.get(key);
    if (!row || !allowed.has(row.value as T)) return learned;
    return {
      value: row.value as T,
      confidence: row.confidence,
      source: row.source,
      updatedAt: row.updated_at,
    };
  }

  private upsertPreference(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO feedback_preferences (key, value, confidence, source, updated_at)
         VALUES (?, ?, 1, 'manual', unixepoch())
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           confidence = excluded.confidence,
           source = excluded.source,
           updated_at = excluded.updated_at`
      )
      .run(key, value);
  }

  private assertAllowed<T extends string>(value: string, allowed: Set<T>, field: string): void {
    if (!allowed.has(value as T)) {
      throw new Error(`${field} has invalid value: ${value}`);
    }
  }
}
