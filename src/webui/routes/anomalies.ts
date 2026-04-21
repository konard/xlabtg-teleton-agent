import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  initAnomalyDetector,
  DEFAULT_ANOMALY_DETECTION_CONFIG,
  type AnomalyDetectionConfig,
  type AnomalySeverity,
} from "../../services/anomaly-detector.js";
import { getErrorMessage } from "../../utils/errors.js";

function parsePeriodHours(period: string | undefined): number {
  switch (period) {
    case "7d":
      return 7 * 24;
    case "30d":
      return 30 * 24;
    default:
      return 24;
  }
}

function parseSeverity(severity: string | undefined): AnomalySeverity | undefined {
  return severity === "warning" || severity === "critical" ? severity : undefined;
}

function getConfig(deps: WebUIServerDeps): AnomalyDetectionConfig {
  return (deps.agent.getConfig().anomaly_detection ??
    DEFAULT_ANOMALY_DETECTION_CONFIG) as AnomalyDetectionConfig;
}

export function createAnomaliesRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function detector() {
    return initAnomalyDetector(deps.memory.db, getConfig(deps));
  }

  // GET /api/anomalies?period=24h|7d|30d&severity=critical&acknowledged=false
  app.get("/", (c) => {
    try {
      const periodHours = parsePeriodHours(c.req.query("period"));
      const severity = parseSeverity(c.req.query("severity"));
      const acknowledgedParam = c.req.query("acknowledged");
      const acknowledged =
        acknowledgedParam === "true" ? true : acknowledgedParam === "false" ? false : undefined;
      const data = detector().listEvents({ periodHours, severity, acknowledged });
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/anomalies/baselines
  app.get("/baselines", (c) => {
    try {
      const data = detector().getBaselines();
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/anomalies/stats?period=24h|7d|30d
  app.get("/stats", (c) => {
    try {
      const data = detector().getStats(parsePeriodHours(c.req.query("period")));
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // POST /api/anomalies/:id/acknowledge
  app.post("/:id/acknowledge", (c) => {
    try {
      const id = c.req.param("id");
      const ok = detector().acknowledge(id);
      if (!ok) {
        return c.json<APIResponse>({ success: false, error: "Anomaly not found" }, 404);
      }
      const data = detector().getEvent(id);
      const response: APIResponse<typeof data> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
