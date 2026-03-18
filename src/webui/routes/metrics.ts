import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { initMetrics } from "../../services/metrics.js";
import { getErrorMessage } from "../../utils/errors.js";

// Period query param → hours
function parsePeriod(period: string | undefined): number {
  switch (period) {
    case "7d":
      return 7 * 24;
    case "30d":
      return 30 * 24;
    default:
      return 24; // 24h
  }
}

export function createMetricsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  // Initialize the singleton from the memory DB (idempotent on server start)
  const metrics = initMetrics(deps.memory.db);

  // GET /api/metrics/tokens?period=24h|7d|30d
  app.get("/tokens", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const data = metrics.getTokenUsage(hours);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/metrics/tools?period=24h|7d|30d
  app.get("/tools", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const data = metrics.getToolUsage(hours);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/metrics/activity?period=24h|7d|30d
  app.get("/activity", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const data = metrics.getActivity(hours);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
