// ── Audit Logging Middleware ──────────────────────────────────────────────────
// Intercepts mutating API requests (PUT, POST, DELETE, PATCH) and records them
// to the audit_log table via AuditService.

import type { MiddlewareHandler } from "hono";
import type { WebUIServerDeps } from "../types.js";
import { initAudit, type AuditActionType } from "../../services/audit.js";

/** Map a request path to a meaningful audit action type. */
function inferActionType(method: string, path: string): AuditActionType {
  const lower = path.toLowerCase();

  if (lower.includes("/api/config")) return "config_change";
  if (lower.includes("/api/tools")) return "tool_toggle";
  if (lower.includes("/api/soul")) return "soul_edit";
  if (lower.includes("/api/agent/start") || lower.includes("/api/agent/stop")) {
    return method === "POST" && lower.includes("stop") ? "agent_stop" : "agent_restart";
  }
  if (lower.includes("/api/plugins") || lower.includes("/api/marketplace"))
    return method === "DELETE" ? "plugin_remove" : "plugin_install";
  if (lower.includes("/api/hooks")) return "hook_change";
  if (lower.includes("/api/mcp")) return "mcp_change";
  if (lower.includes("/api/memory")) return "memory_delete";
  if (lower.includes("/api/workspace")) return "workspace_change";
  if (lower.includes("/api/sessions")) return "session_delete";
  if (lower.includes("/api/security")) return "security_change";
  if (lower.includes("/auth/login")) return "login";
  if (lower.includes("/auth/logout")) return "logout";
  if (lower.includes("/api/workflows")) return "hook_change";
  if (lower.includes("/api/tasks")) return "workspace_change";
  if (lower.includes("/api/secret")) return "secret_change";

  return "other";
}

/** Extract the real client IP from common proxy headers. */
function extractIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns a Hono middleware that logs all mutating requests to the audit table.
 * Should be applied after the auth middleware.
 */
export function createAuditMiddleware(deps: WebUIServerDeps): MiddlewareHandler {
  const audit = initAudit(deps.memory.db);

  return async (c, next) => {
    const method = c.req.method.toUpperCase();

    // Only log mutating requests to API paths
    if (!MUTATION_METHODS.has(method) || !c.req.path.startsWith("/api/")) {
      return next();
    }

    const action = inferActionType(method, c.req.path);
    const ip = extractIp(c.req.raw) ?? null;
    const userAgent = c.req.header("user-agent") ?? null;
    const details = `${method} ${c.req.path}`;

    // Run the actual handler first, then log (so we know it was executed)
    await next();

    // Only log successful (2xx/3xx) mutations to keep audit log clean
    const status = c.res.status;
    if (status >= 200 && status < 400) {
      audit.log(action, details, { ip, userAgent });
    }
  };
}
