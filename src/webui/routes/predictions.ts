import { Hono } from "hono";
import type { Context } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  initPredictions,
  type Prediction,
  type PredictionEndpoint,
} from "../../services/predictions.js";
import { getTaskStore, type Task } from "../../memory/agent/tasks.js";
import { getErrorMessage } from "../../utils/errors.js";

interface PredictionConfig {
  enabled?: boolean;
  confidence_threshold?: number;
  max_suggestions?: number;
}

const VALID_ENDPOINTS: PredictionEndpoint[] = ["next", "tools", "topics"];

function getPredictionConfig(deps: WebUIServerDeps): Required<PredictionConfig> {
  const config = deps.agent.getConfig().predictions;
  return {
    enabled: config?.enabled ?? true,
    confidence_threshold: config?.confidence_threshold ?? 0.6,
    max_suggestions: config?.max_suggestions ?? 5,
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 10));
}

function predictionQuery(c: Context, deps: WebUIServerDeps) {
  const config = getPredictionConfig(deps);
  return {
    sessionId: c.req.query("sessionId"),
    chatId: c.req.query("chatId"),
    context: c.req.query("context"),
    currentAction: c.req.query("currentAction"),
    confidenceThreshold: config.confidence_threshold,
    limit: parseLimit(c.req.query("limit"), config.max_suggestions),
  };
}

function serializeTask(task: Task) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    scheduledFor: task.scheduledFor?.toISOString() ?? null,
  };
}

export function createPredictionsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const predictions = initPredictions(deps.memory.db);

  function disabledResponse(c: Context) {
    const response: APIResponse<Prediction[]> = { success: true, data: [] };
    return c.json(response);
  }

  app.get("/next", (c) => {
    try {
      if (!getPredictionConfig(deps).enabled) return disabledResponse(c);
      const data = predictions.getNextActions(predictionQuery(c, deps));
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/tools", (c) => {
    try {
      if (!getPredictionConfig(deps).enabled) return disabledResponse(c);
      const data = predictions.getLikelyTools(predictionQuery(c, deps));
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/topics", (c) => {
    try {
      if (!getPredictionConfig(deps).enabled) return disabledResponse(c);
      const data = predictions.getRelatedTopics(predictionQuery(c, deps));
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/feedback", async (c) => {
    try {
      const body = await c.req.json<{
        endpoint?: PredictionEndpoint;
        action?: string;
        confidence?: number;
        reason?: string;
        helpful?: boolean;
      }>();

      if (
        !body.action ||
        !body.endpoint ||
        !VALID_ENDPOINTS.includes(body.endpoint) ||
        typeof body.helpful !== "boolean"
      ) {
        return c.json<APIResponse>(
          { success: false, error: "valid endpoint, action, and helpful are required" },
          400
        );
      }

      predictions.recordFeedback({
        endpoint: body.endpoint,
        action: body.action,
        confidence: body.confidence,
        reason: body.reason,
        helpful: body.helpful,
      });

      return c.json<APIResponse<{ recorded: true }>>({ success: true, data: { recorded: true } });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/execute", async (c) => {
    try {
      const body = await c.req.json<{
        action?: string;
        confidence?: number;
        reason?: string;
        endpoint?: PredictionEndpoint;
      }>();

      const action = body.action?.trim();
      if (!action) {
        return c.json<APIResponse>({ success: false, error: "action is required" }, 400);
      }
      if (action.length > 500) {
        return c.json<APIResponse>({ success: false, error: "action is too long" }, 400);
      }
      if (body.endpoint && !VALID_ENDPOINTS.includes(body.endpoint)) {
        return c.json<APIResponse>({ success: false, error: "endpoint is invalid" }, 400);
      }

      const task = getTaskStore(deps.memory.db).createTask({
        description: action,
        priority: 1,
        createdBy: "prediction-engine",
        reason: body.reason ?? "Accepted prediction",
        payload: JSON.stringify({
          source: "prediction-engine",
          endpoint: body.endpoint ?? "next",
          confidence: body.confidence ?? null,
        }),
      });

      predictions.recordFeedback({
        endpoint: body.endpoint ?? "next",
        action,
        confidence: body.confidence,
        reason: body.reason,
        helpful: true,
      });

      return c.json<APIResponse<ReturnType<typeof serializeTask>>>({
        success: true,
        data: serializeTask(task),
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
