import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  TemporalContextService,
  type TemporalEntityType,
} from "../../services/temporal-context.js";
import { getErrorMessage } from "../../utils/errors.js";

function getService(deps: WebUIServerDeps): TemporalContextService {
  return new TemporalContextService(deps.memory.db, deps.agent?.getConfig?.()?.temporal_context);
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 1000));
}

function parseEntityType(value: string | undefined): TemporalEntityType | undefined {
  if (
    value === "knowledge" ||
    value === "message" ||
    value === "session" ||
    value === "task" ||
    value === "behavior" ||
    value === "request" ||
    value === "tool"
  ) {
    return value;
  }
  return undefined;
}

export function createTemporalRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.get("/temporal", (c) => {
    try {
      const service = getService(deps);
      service.syncTemporalMetadata();
      const data = service.getCurrentTemporalContext({
        time: c.req.query("time") ?? undefined,
        limit: parseLimit(c.req.query("limit"), 5),
      });
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/patterns", (c) => {
    try {
      const service = getService(deps);
      service.analyzeAndStorePatterns();
      const data = service.listPatterns({
        includeDisabled: c.req.query("includeDisabled") === "true",
        limit: parseLimit(c.req.query("limit"), 100),
      });
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.put("/patterns/:id", async (c) => {
    try {
      const body = await c.req.json<{
        enabled?: boolean;
        confidence?: number;
        description?: string;
        scheduleCron?: string | null;
      }>();
      const service = getService(deps);
      const data = service.updatePattern(c.req.param("id"), body);
      if (!data) {
        return c.json<APIResponse>({ success: false, error: "Pattern not found" }, 404);
      }
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/timeline", (c) => {
    try {
      const service = getService(deps);
      const data = service.getTimeline({
        from: c.req.query("from") ?? undefined,
        to: c.req.query("to") ?? undefined,
        entityType: parseEntityType(c.req.query("entityType")),
        limit: parseLimit(c.req.query("limit"), 200),
      });
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
