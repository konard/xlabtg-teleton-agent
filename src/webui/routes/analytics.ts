import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { initAnalytics } from "../../services/analytics.js";
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

// Period query param → days (for cost records)
function parsePeriodDays(period: string | undefined): number {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    default:
      return 1; // 24h
  }
}

export function createAnalyticsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const analytics = initAnalytics(deps.memory.db);
  // Ensure metrics singleton is also initialised (idempotent)
  const metrics = initMetrics(deps.memory.db);

  // GET /api/analytics/usage?period=24h|7d|30d
  // Token usage over time (hourly buckets)
  app.get("/usage", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const data = metrics.getTokenUsage(hours);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/analytics/tools?period=24h|7d|30d
  // Tool usage breakdown (top 10 by call count)
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

  // GET /api/analytics/heatmap?period=30d
  // Activity heatmap (7×24 grid of day-of-week × hour)
  app.get("/heatmap", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const data = metrics.getActivity(hours);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/analytics/performance?period=24h|7d|30d
  // Response time, success/failure rate, error frequency
  app.get("/performance", (c) => {
    try {
      const hours = parsePeriod(c.req.query("period"));
      const summary = analytics.getPerformanceSummary(hours);
      const errorFrequency = analytics.getErrorFrequency(hours);
      const data = { summary, errorFrequency };
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/analytics/cost?period=7d|30d
  // Daily/weekly/monthly cost breakdown
  app.get("/cost", (c) => {
    try {
      const days = parsePeriodDays(c.req.query("period"));
      const daily = analytics.getDailyCost(days);
      const perTool = analytics.getCostPerTool(days * 24);
      const data = { daily, perTool };
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/analytics/budget
  // Current budget config and month-to-date status
  app.get("/budget", (c) => {
    try {
      const data = analytics.getBudgetStatus();
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // PUT /api/analytics/budget
  // Set budget limit
  app.put("/budget", async (c) => {
    try {
      const body = await c.req.json<{ monthly_limit_usd: number | null }>();
      analytics.setBudgetConfig({ monthly_limit_usd: body.monthly_limit_usd ?? null });
      const data = analytics.getBudgetStatus();
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
