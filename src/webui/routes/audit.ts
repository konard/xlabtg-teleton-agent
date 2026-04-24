import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import {
  auditTrailBus,
  initAuditTrail,
  type AuditEventType,
  type AuditExportFormat,
  type AuditReportType,
} from "../../services/audit-trail.js";
import { getErrorMessage } from "../../utils/errors.js";

const REPORT_TYPES = new Set<AuditReportType>([
  "daily_activity",
  "security_events",
  "cost_resource",
  "tool_usage",
]);

function parseUnix(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFormat(value: unknown): AuditExportFormat {
  return value === "csv" ? "csv" : "json";
}

interface AuditExportBody {
  format?: AuditExportFormat;
  type?: AuditEventType | null;
  session?: string | null;
  actor?: string | null;
  from?: number | null;
  to?: number | null;
}

export function createAuditRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const audit = initAuditTrail(deps.memory.db);

  // GET /api/audit/events?type=tool.result&session=...&actor=...&from=...&to=...
  app.get("/events", (c) => {
    try {
      const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
      const data = audit.listEvents({
        page,
        limit,
        eventType: (c.req.query("type") as AuditEventType | undefined) ?? null,
        sessionId: c.req.query("session") ?? null,
        actor: c.req.query("actor") ?? null,
        since: parseUnix(c.req.query("from") ?? c.req.query("since")),
        until: parseUnix(c.req.query("to") ?? c.req.query("until")),
      });
      return c.json<APIResponse>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/audit/chain/:event_id
  app.get("/chain/:event_id", (c) => {
    try {
      const data = audit.getDecisionChain(c.req.param("event_id"));
      if (data.events.length === 0) {
        return c.json<APIResponse>({ success: false, error: "Audit event not found" }, 404);
      }
      return c.json<APIResponse>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // POST /api/audit/verify?from=...&to=...
  app.post("/verify", (c) => {
    try {
      const data = audit.verifyIntegrity({
        since: parseUnix(c.req.query("from") ?? c.req.query("since")),
        until: parseUnix(c.req.query("to") ?? c.req.query("until")),
      });
      return c.json<APIResponse>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/audit/reports/:type?period=24&format=json|csv
  app.get("/reports/:type", (c) => {
    try {
      const type = c.req.param("type") as AuditReportType;
      if (!REPORT_TYPES.has(type)) {
        return c.json<APIResponse>({ success: false, error: "Unknown report type" }, 400);
      }

      const periodHours = Math.max(1, parseInt(c.req.query("period") || "24", 10));
      const report = audit.generateReport(type, { periodHours });
      if (c.req.query("format") === "csv") {
        return c.body(audit.reportToCsv(report), 200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-report-${type}-${Date.now()}.csv"`,
        });
      }
      return c.json<APIResponse>({ success: true, data: report });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // POST /api/audit/export
  app.post("/export", async (c) => {
    try {
      const body: AuditExportBody = await c.req.json<AuditExportBody>().catch(() => ({}));
      const exported = audit.exportEvents({
        format: parseFormat(body.format),
        eventType: body.type ?? null,
        sessionId: body.session ?? null,
        actor: body.actor ?? null,
        since: body.from ?? null,
        until: body.to ?? null,
      });
      return c.body(exported.body, 200, {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Audit-Signature": exported.signature,
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  // GET /api/audit/stream - SSE event stream for the Audit Trail tab.
  app.get("/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const onEvent = (event: unknown) => {
        if (aborted) return;
        void stream.writeSSE({
          event: "audit-event",
          data: JSON.stringify(event),
        });
      };

      auditTrailBus.on("event", onEvent);

      while (!aborted) {
        await stream.sleep(30_000);
        if (!aborted) await stream.writeSSE({ event: "ping", data: "" });
      }

      auditTrailBus.off("event", onEvent);
    });
  });

  return app;
}
