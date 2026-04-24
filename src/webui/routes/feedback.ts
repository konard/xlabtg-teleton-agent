import { Hono } from "hono";
import type { Context } from "hono";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import {
  FeedbackCaptureService,
  type FeedbackInput,
  type FeedbackQuery,
  type FeedbackType,
} from "../../services/feedback/capture.js";
import { FeedbackAnalyzer } from "../../services/feedback/analyzer.js";
import {
  FeedbackLearner,
  type CodeStylePreference,
  type InteractionStylePreference,
  type ResponseLengthPreference,
  type ToolSelectionPreference,
} from "../../services/feedback/learner.js";
import { getErrorMessage } from "../../utils/errors.js";

const FEEDBACK_TYPES: FeedbackType[] = ["positive", "negative", "rating", "text", "implicit"];
const RESPONSE_LENGTH_VALUES: ResponseLengthPreference[] = ["concise", "balanced", "detailed"];
const CODE_STYLE_VALUES: CodeStylePreference[] = ["clean", "commented", "verified_examples"];
const INTERACTION_STYLE_VALUES: InteractionStylePreference[] = ["direct", "neutral", "supportive"];
const TOOL_SELECTION_VALUES: ToolSelectionPreference[] = ["conservative", "normal", "exploratory"];

type FeedbackRuntimeConfig = {
  correction_window_seconds?: number;
  acceptance_delay_seconds?: number;
};

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, max));
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFeedbackQuery(c: Context): FeedbackQuery {
  const limit = parsePositiveInt(c.req.query("limit"), 100, 500);
  const page = parsePositiveInt(c.req.query("page"), 1, 10_000);
  const type = c.req.query("type");
  return {
    sessionId: c.req.query("session"),
    messageId: c.req.query("message"),
    type:
      type && FEEDBACK_TYPES.includes(type as FeedbackType) ? (type as FeedbackType) : undefined,
    from: parseTimestamp(c.req.query("from")),
    to: parseTimestamp(c.req.query("to")),
    limit,
    offset: (page - 1) * limit,
  };
}

function validateFeedbackBody(body: Partial<FeedbackInput>): string | null {
  if (!body.sessionId || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
    return "sessionId is required";
  }
  if (!body.type || !FEEDBACK_TYPES.includes(body.type)) {
    return "type must be one of positive, negative, rating, text, implicit";
  }
  if (body.rating !== undefined && body.rating !== null) {
    if (!Number.isFinite(body.rating) || body.rating < 1 || body.rating > 5) {
      return "rating must be between 1 and 5";
    }
  }
  if (body.type === "rating" && body.rating === undefined) {
    return "rating is required when type is rating";
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string")) {
      return "tags must be an array of strings";
    }
  }
  if (
    body.implicitSignals !== undefined &&
    (typeof body.implicitSignals !== "object" ||
      body.implicitSignals === null ||
      Array.isArray(body.implicitSignals))
  ) {
    return "implicitSignals must be an object";
  }
  return null;
}

function assertOption<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${field} has invalid value`);
  }
  return value as T;
}

function getFeedbackConfig(deps: WebUIServerDeps): FeedbackRuntimeConfig | undefined {
  try {
    return deps.agent?.getConfig?.().feedback;
  } catch {
    return undefined;
  }
}

export function createFeedbackRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const feedbackConfig = getFeedbackConfig(deps);
  const feedback = new FeedbackCaptureService(deps.memory.db, {
    correctionWindowSeconds: feedbackConfig?.correction_window_seconds,
    acceptanceDelaySeconds: feedbackConfig?.acceptance_delay_seconds,
  });
  const analyzer = new FeedbackAnalyzer(deps.memory.db);
  const learner = new FeedbackLearner(deps.memory.db);

  app.post("/", async (c) => {
    try {
      const body = await c.req.json<Partial<FeedbackInput>>();
      const validation = validateFeedbackBody(body);
      if (validation) {
        return c.json<APIResponse>({ success: false, error: validation }, 400);
      }

      const record = feedback.submitFeedback(body as FeedbackInput);
      return c.json<APIResponse<typeof record>>({ success: true, data: record }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/", (c) => {
    try {
      const query = parseFeedbackQuery(c);
      const rows = feedback.listFeedback(query);
      const total = feedback.countFeedback(query);
      const limit = query.limit ?? 100;
      const page = Math.floor((query.offset ?? 0) / limit) + 1;
      return c.json<
        APIResponse<{
          feedback: typeof rows;
          total: number;
          page: number;
          limit: number;
        }>
      >({
        success: true,
        data: { feedback: rows, total, page, limit },
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/analytics", (c) => {
    try {
      const periodDays = parsePositiveInt(c.req.query("periodDays"), 30, 365);
      const data = analyzer.getAnalytics({ periodDays });
      return c.json<APIResponse<typeof data>>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/themes", (c) => {
    try {
      const periodDays = parsePositiveInt(c.req.query("periodDays"), 30, 365);
      const limit = parsePositiveInt(c.req.query("limit"), 20, 50);
      const data = analyzer.getThemes({ periodDays, limit });
      return c.json<APIResponse<typeof data>>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/preferences", (c) => {
    try {
      const data = learner.getPreferences();
      return c.json<APIResponse<typeof data>>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.put("/preferences", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const data = learner.updatePreferences({
        responseLength: assertOption(body.responseLength, RESPONSE_LENGTH_VALUES, "responseLength"),
        codeStyle: assertOption(body.codeStyle, CODE_STYLE_VALUES, "codeStyle"),
        interactionStyle: assertOption(
          body.interactionStyle,
          INTERACTION_STYLE_VALUES,
          "interactionStyle"
        ),
        toolSelection: assertOption(body.toolSelection, TOOL_SELECTION_VALUES, "toolSelection"),
      });
      return c.json<APIResponse<typeof data>>({ success: true, data });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("invalid value") ? 400 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  return app;
}
