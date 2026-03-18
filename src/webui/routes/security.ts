// ── Security API Routes ───────────────────────────────────────────────────────
// GET  /api/security/audit          — list audit log entries (paginated)
// GET  /api/security/audit/export   — download audit log as CSV
// GET  /api/security/settings       — get security settings
// PUT  /api/security/settings       — update security settings

import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { initAudit, type AuditActionType, type AuditLogPage } from "../../services/audit.js";
import { initSecurity, type SecuritySettings } from "../../services/security.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createSecurityRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const audit = initAudit(deps.memory.db);
  const security = initSecurity(deps.memory.db);

  // ── Audit Log ────────────────────────────────────────────────────

  // GET /api/security/audit?page=1&limit=50&type=config_change&since=<unix>&until=<unix>
  app.get("/audit", (c) => {
    try {
      const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
      const actionParam = c.req.query("type");
      const sinceParam = c.req.query("since");
      const untilParam = c.req.query("until");

      const data = audit.list({
        page,
        limit,
        action: (actionParam as AuditActionType) || null,
        since: sinceParam ? parseInt(sinceParam, 10) : null,
        until: untilParam ? parseInt(untilParam, 10) : null,
      });

      const response: APIResponse<AuditLogPage> = { success: true, data };
      return c.json(response);
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // GET /api/security/audit/export?type=config_change&since=<unix>&until=<unix>
  app.get("/audit/export", (c) => {
    try {
      const actionParam = c.req.query("type");
      const sinceParam = c.req.query("since");
      const untilParam = c.req.query("until");

      const csv = audit.exportCsv({
        action: (actionParam as AuditActionType) || null,
        since: sinceParam ? parseInt(sinceParam, 10) : null,
        until: untilParam ? parseInt(untilParam, 10) : null,
      });

      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${Date.now()}.csv"`,
      });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // ── Security Settings ────────────────────────────────────────────

  // GET /api/security/settings
  app.get("/settings", (c) => {
    try {
      const data = security.getSettings();
      const response: APIResponse<SecuritySettings> = { success: true, data };
      return c.json(response);
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // PUT /api/security/settings
  app.put("/settings", async (c) => {
    try {
      const body = await c.req.json<Partial<SecuritySettings>>();

      // Validate types before persisting
      if (
        body.session_timeout_minutes !== undefined &&
        body.session_timeout_minutes !== null &&
        (typeof body.session_timeout_minutes !== "number" || body.session_timeout_minutes <= 0)
      ) {
        return c.json<APIResponse>(
          { success: false, error: "session_timeout_minutes must be a positive number or null" },
          400
        );
      }

      if (
        body.ip_allowlist !== undefined &&
        (!Array.isArray(body.ip_allowlist) ||
          body.ip_allowlist.some((ip) => typeof ip !== "string"))
      ) {
        return c.json<APIResponse>(
          { success: false, error: "ip_allowlist must be an array of strings" },
          400
        );
      }

      if (
        body.rate_limit_rpm !== undefined &&
        body.rate_limit_rpm !== null &&
        (typeof body.rate_limit_rpm !== "number" || body.rate_limit_rpm <= 0)
      ) {
        return c.json<APIResponse>(
          { success: false, error: "rate_limit_rpm must be a positive number or null" },
          400
        );
      }

      const data = security.updateSettings(body);
      const response: APIResponse<SecuritySettings> = { success: true, data };
      return c.json(response);
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  return app;
}
