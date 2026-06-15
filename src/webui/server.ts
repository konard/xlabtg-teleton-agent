import { Hono } from "hono";
import type { ServerType } from "@hono/node-server";
import { cors } from "hono/cors";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WebUIServerDeps } from "./types.js";
import type { StateChangeEvent } from "../agent/lifecycle.js";
import { createLifecycleSSE } from "./lifecycle-sse.js";
import { applySecurityMiddleware, sharedBodyLimit } from "./http-common.js";
import { findWebDist, createStaticHandler } from "./static-serving.js";
import { startHonoServer, stopHonoServer } from "../utils/http-server.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("WebUI");
import {
  generateToken,
  maskToken,
  safeCompare,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from "./middleware/auth.js";
import { isHashedToken, verifyToken } from "./middleware/token-hash.js";
import { createCsrfMiddleware } from "./middleware/csrf.js";
import { isPublicSignedApiIngress } from "./middleware/public-ingress.js";
import { logInterceptor } from "./log-interceptor.js";
import { SHARED_ROUTE_FACTORIES } from "./routes/shared.js";
import { createAgentRoutes } from "../api/routes/agent.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createWalletRoutes } from "./routes/wallet.js";
import { readRawConfig, writeRawConfig } from "../config/configurable-keys.js";
// Fork-specific route factories (not part of SHARED_ROUTE_FACTORIES).
import { createGroqRoutes } from "./routes/groq.js";
import { createMtprotoRoutes } from "./routes/mtproto.js";
import { createNotificationsRoutes } from "./routes/notifications.js";
import { getNotificationService, notificationBus } from "../services/notifications.js";
import { createCacheRoutes } from "./routes/cache.js";
import { createAgentActionsRoutes } from "./routes/agent-actions.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createSessionsRoutes } from "./routes/sessions.js";
import { createAnalyticsRoutes } from "./routes/analytics.js";
import { createAnomaliesRoutes } from "./routes/anomalies.js";
import { createSecurityRoutes } from "./routes/security.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createAuditMiddleware } from "./middleware/audit.js";
import { createHealthRoutes } from "./routes/health.js";
import { createExportImportRoutes } from "./routes/export-import.js";
import { createWorkflowsRoutes } from "./routes/workflows.js";
import { createPipelinesRoutes } from "./routes/pipelines.js";
import { createEventsRoutes } from "./routes/events.js";
import { createWebhooksRoutes } from "./routes/webhooks.js";
import { createSelfImprovementRoutes } from "./routes/self-improvement.js";
import { createAutonomousRoutes } from "./routes/autonomous.js";
import { createPredictionsRoutes } from "./routes/predictions.js";
import { createAgentsRoutes } from "./routes/agents.js";
import { createIntegrationsRoutes } from "./routes/integrations.js";
import { createTemporalRoutes } from "./routes/temporal.js";
import { createFeedbackRoutes } from "./routes/feedback.js";
import { createPromptRoutes } from "./routes/prompts.js";
import { createDashboardsRoutes } from "./routes/dashboards.js";
import { createWidgetGeneratorRoutes } from "./routes/widget-generator.js";
import { createAgentNetworkIngressRoutes, createNetworkRoutes } from "./routes/network.js";

export class WebUIServer {
  private app: Hono;
  private server: ServerType | null = null;
  private deps: WebUIServerDeps;
  private authToken: string;
  private readonly startupExchangeToken: string;
  private startupExchangeTokenConsumed = false;
  /**
   * When the config stores a hashed token (`auth_token_hash`), we don't know
   * the raw value — it was handed to the client by the setup wizard. We can
   * only verify incoming tokens against the hash. In that case `authToken`
   * is a fresh random string used to mint the session cookie, while
   * `startupExchangeToken` is a separate one-time browser login token printed
   * to stderr for the local operator.
   */
  private readonly authTokenHash: string | null;

  constructor(deps: WebUIServerDeps) {
    this.deps = deps;
    this.app = new Hono();

    const configuredHash = deps.config.auth_token_hash;
    if (isHashedToken(configuredHash)) {
      this.authTokenHash = configuredHash;
      // Used to mint session cookies after a successful token exchange.
      // Never compared against raw user input.
      this.authToken = generateToken();
      this.startupExchangeToken = generateToken();
    } else {
      this.authTokenHash = null;
      this.authToken = deps.config.auth_token || generateToken();
      this.startupExchangeToken = this.authToken;
    }

    this.setupMiddleware();
    this.setupRoutes();
    this.setupNotificationTriggers();
  }

  /**
   * Compare an incoming token against the configured secret. Prefers hash
   * verification when available; falls back to the raw-token comparison
   * for configs that still store `auth_token` plaintext (legacy).
   */
  private matchToken(incoming: string | undefined | null): boolean {
    if (!incoming) return false;
    if (this.authTokenHash) return verifyToken(incoming, this.authTokenHash);
    return safeCompare(incoming, this.authToken);
  }

  /**
   * Accept either the configured token or the one-time startup exchange token
   * for browser login routes. The startup token is intentionally not accepted
   * by API Bearer/query auth.
   */
  private acceptBrowserLoginToken(incoming: string | undefined | null): boolean {
    if (this.matchToken(incoming)) return true;
    if (!incoming || this.startupExchangeTokenConsumed) return false;
    if (!safeCompare(incoming, this.startupExchangeToken)) return false;
    this.startupExchangeTokenConsumed = true;
    return true;
  }

  /** Set an HttpOnly session cookie */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context type
  private setSessionCookie(c: any): void {
    setCookie(c, COOKIE_NAME, this.authToken, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      secure: false, // localhost is HTTP
      maxAge: COOKIE_MAX_AGE,
    });
  }

  private setupMiddleware() {
    // CORS - must be first
    this.app.use(
      "*",
      cors({
        origin: this.deps.config.cors_origins,
        credentials: true,
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
        allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
        maxAge: 3600,
      })
    );

    // CSRF protection (double-submit cookie pattern)
    // Must come after CORS (which handles preflight) but before auth.
    this.app.use("*", createCsrfMiddleware());

    // Request logging (if enabled)
    if (this.deps.config.log_requests) {
      this.app.use("*", async (c, next) => {
        const start = Date.now();
        await next();
        const duration = Date.now() - start;
        log.info(`${c.req.method} ${c.req.path} → ${c.res.status} (${duration}ms)`);
      });
    }

    // Body size limit (defense-in-depth against oversized payloads)
    this.app.use(
      "*",
      sharedBodyLimit((c) =>
        c.json({ success: false, error: "Request body too large (max 2MB)" }, 413)
      )
    );

    // Security headers for all responses
    applySecurityMiddleware(this.app, { referrerPolicy: "strict-origin-when-cross-origin" });

    // Auth for all /api/* routes
    // Accepts: HttpOnly cookie > Bearer header > ?token= query param (fallback)
    this.app.use("/api/*", async (c, next) => {
      if (isPublicSignedApiIngress(c.req.path)) {
        return next();
      }

      // 1. Check HttpOnly session cookie (primary — browser).
      // The cookie always carries the in-memory session token, so a raw
      // comparison is correct regardless of whether the config stores a hash.
      const cookieToken = getCookie(c, COOKIE_NAME);
      if (cookieToken && safeCompare(cookieToken, this.authToken)) {
        return next();
      }

      // 2. Check Authorization header (secondary — API/curl). Validated
      // through matchToken so a hashed config entry is honored.
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match && this.matchToken(match[1])) {
          return next();
        }
      }

      // 3. Check ?token= query param (fallback — backward compat)
      const queryToken = c.req.query("token");
      if (queryToken && this.matchToken(queryToken)) {
        return next();
      }

      return c.json({ success: false, error: "Unauthorized" }, 401);
    });

    // Audit logging for mutating API requests (after auth, so unauthenticated requests are not logged)
    this.app.use("/api/*", createAuditMiddleware(this.deps));
  }

  private setupRoutes() {
    // Health check (no auth)
    this.app.get("/health", (c) => c.json({ status: "ok" }));

    // === Auth routes (no auth required) ===

    // Token exchange: browser opens with ?token=, gets HttpOnly cookie, redirects to /
    this.app.get("/auth/exchange", (c) => {
      const token = c.req.query("token");
      if (!this.acceptBrowserLoginToken(token ?? null)) {
        return c.json({ success: false, error: "Invalid token" }, 401);
      }

      this.setSessionCookie(c);
      return c.redirect("/");
    });

    // Manual login: POST with token, get cookie
    this.app.post("/auth/login", async (c) => {
      try {
        const body = await c.req.json<{ token: string }>();
        if (!this.acceptBrowserLoginToken(body.token)) {
          return c.json({ success: false, error: "Invalid token" }, 401);
        }

        this.setSessionCookie(c);
        return c.json({ success: true });
      } catch {
        return c.json({ success: false, error: "Invalid request body" }, 400);
      }
    });

    // Logout: clear cookie
    this.app.post("/auth/logout", (c) => {
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ success: true });
    });

    // Check auth status (no auth required — returns whether cookie is valid)
    this.app.get("/auth/check", (c) => {
      const cookieToken = getCookie(c, COOKIE_NAME);
      const authenticated = !!(cookieToken && safeCompare(cookieToken, this.authToken));
      return c.json({ success: true, data: { authenticated } });
    });

    // API routes (all require auth via middleware above)
    // Shared route factories (status, tools, logs, memory, soul, plugins, mcp,
    // workspace, tasks, config, marketplace, hooks, ton-proxy) — kept in sync
    // with the Management API server via SHARED_ROUTE_FACTORIES.
    for (const [seg, make] of SHARED_ROUTE_FACTORIES) {
      this.app.route(`/api/${seg}`, make(this.deps));
    }

    // Upstream WebUI-specific routes.
    this.app.route("/api/conversations", createConversationRoutes(this.deps));
    this.app.route("/api/wallet", createWalletRoutes(this.deps));

    // Fork-specific routes (not part of SHARED_ROUTE_FACTORIES).
    this.app.route("/api/groq", createGroqRoutes(this.deps));
    this.app.route("/api/mtproto", createMtprotoRoutes(this.deps));
    this.app.route("/api/notifications", createNotificationsRoutes(this.deps));
    this.app.route("/api/cache", createCacheRoutes(this.deps));
    this.app.route("/api/agent-actions", createAgentActionsRoutes(this.deps));
    this.app.route("/api/metrics", createMetricsRoutes(this.deps));
    this.app.route("/api/sessions", createSessionsRoutes(this.deps));
    this.app.route("/api/analytics", createAnalyticsRoutes(this.deps));
    this.app.route("/api/anomalies", createAnomaliesRoutes(this.deps));
    this.app.route("/api/security", createSecurityRoutes(this.deps));
    this.app.route("/api/audit", createAuditRoutes(this.deps));
    this.app.route("/api/health-check", createHealthRoutes(this.deps));
    this.app.route("/api/export", createExportImportRoutes(this.deps));
    this.app.route("/api/workflows", createWorkflowsRoutes(this.deps));
    this.app.route("/api/pipelines", createPipelinesRoutes(this.deps));
    this.app.route("/api/events", createEventsRoutes(this.deps));
    this.app.route("/api/webhooks", createWebhooksRoutes(this.deps));
    this.app.route("/api/self-improvement", createSelfImprovementRoutes(this.deps));
    this.app.route("/api/autonomous", createAutonomousRoutes(this.deps));
    this.app.route("/api/predictions", createPredictionsRoutes(this.deps));
    this.app.route("/api/agents", createAgentsRoutes(this.deps));
    this.app.route("/api/integrations", createIntegrationsRoutes(this.deps));
    this.app.route("/api/context", createTemporalRoutes(this.deps));
    this.app.route("/api/feedback", createFeedbackRoutes(this.deps));
    this.app.route("/api/prompts", createPromptRoutes(this.deps));
    this.app.route("/api/dashboards", createDashboardsRoutes(this.deps));
    this.app.route("/api/widgets", createWidgetGeneratorRoutes(this.deps));
    this.app.route("/api/network", createNetworkRoutes(this.deps));
    this.app.route("/api/agent-network", createAgentNetworkIngressRoutes(this.deps));

    // Debug endpoint — returns build metadata (which dist folder is served and its version)
    this.app.get("/api/debug/ui-version", (c) => {
      const webDist = findWebDist();
      let buildVersion: string | null = null;
      let buildTimestamp: string | null = null;

      if (webDist) {
        try {
          const meta = JSON.parse(readFileSync(join(webDist, "build-meta.json"), "utf-8"));
          buildVersion = meta.version ?? null;
          buildTimestamp = meta.buildTimestamp ?? null;
        } catch {
          // build-meta.json not present in older builds — acceptable
        }
      }

      return c.json({
        success: true,
        data: {
          webDistPath: webDist,
          buildVersion,
          buildTimestamp,
          nodeVersion: process.version,
          uptime: Math.floor(process.uptime()),
        },
      });
    });

    // Agent lifecycle routes (start/stop/status/restart) with WebUI error envelope
    this.app.route(
      "/api/agent",
      createAgentRoutes(this.deps.lifecycle, {
        errorResponse: (c, status, _title, detail) => c.json({ error: detail }, status as 503),
      })
    );

    this.app.get("/api/agent/mode", (c) => {
      const raw = readRawConfig(this.deps.configPath);
      const telegram = raw?.telegram || {};

      const currentMode = telegram.mode || "user";
      const hasBotToken = !!telegram.bot_token;
      const hasUserCredentials = !!(telegram.api_id && telegram.api_hash && telegram.phone);

      return c.json({
        mode: currentMode,
        canSwitchToBot: hasBotToken,
        canSwitchToUser: hasUserCredentials,
      });
    });

    this.app.post("/api/agent/mode", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }

      const body = await c.req.json<{
        mode: "user" | "bot";
        botToken?: string;
        userCredentials?: { apiId: number; apiHash: string; phone: string };
      }>();

      if (body.mode !== "user" && body.mode !== "bot") {
        return c.json({ error: "Invalid mode" }, 400);
      }

      const raw = readRawConfig(this.deps.configPath);
      if (!raw?.telegram) {
        return c.json({ error: "No telegram config found" }, 400);
      }

      if (body.mode === "bot") {
        const token = body.botToken || raw.telegram.bot_token;
        if (!token) {
          return c.json({ error: "Bot token required" }, 400);
        }

        // Validate token via Telegram API
        if (body.botToken) {
          try {
            const resp = await fetch(`https://api.telegram.org/bot${body.botToken}/getMe`);
            const result = (await resp.json()) as { ok: boolean; description?: string };
            if (!result.ok) {
              return c.json(
                { error: `Invalid bot token: ${result.description || "validation failed"}` },
                400
              );
            }
          } catch {
            return c.json({ error: "Failed to validate bot token (network error)" }, 400);
          }
          raw.telegram.bot_token = body.botToken;
        }
      } else {
        // Accept new user credentials or use existing ones
        if (body.userCredentials) {
          raw.telegram.api_id = body.userCredentials.apiId;
          raw.telegram.api_hash = body.userCredentials.apiHash;
          raw.telegram.phone = body.userCredentials.phone;
        }
        if (!raw.telegram.api_id || !raw.telegram.api_hash || !raw.telegram.phone) {
          return c.json({ error: "User credentials (api_id, api_hash, phone) required" }, 400);
        }
      }

      raw.telegram.mode = body.mode;
      writeRawConfig(raw, this.deps.configPath);

      // Fire-and-forget: restart to apply new mode
      lifecycle
        .stop()
        .then(() => lifecycle.start())
        .catch((err: Error) => {
          log.error({ err }, "Mode switch restart failed");
        });

      return c.json({ success: true, mode: body.mode, restarting: true });
    });

    this.app.get("/api/agent/events", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }

      return createLifecycleSSE(c, lifecycle);
    });

    // Serve static files in production (if built) with SPA fallback
    const webDist = findWebDist();
    if (webDist) {
      log.info(`Serving UI from: ${webDist}`);
      this.app.get("*", createStaticHandler(webDist, { async: true }));
    } else {
      log.warn(
        "Web UI build not found (dist/web/index.html missing) — run `npm run build:web` to build the frontend"
      );
    }

    // Error handler
    this.app.onError((err, c) => {
      log.error({ err }, "WebUI error");
      return c.json(
        {
          success: false,
          error: err.message || "Internal server error",
        },
        500
      );
    });
  }

  private setupNotificationTriggers() {
    const lifecycle = this.deps.lifecycle;
    if (!lifecycle) return;

    const svc = getNotificationService(this.deps.memory.db);

    lifecycle.on("stateChange", (event: StateChangeEvent) => {
      if (event.state === "stopped" && event.error) {
        svc.add("error", "Agent crashed", event.error);
        notificationBus.emit("update", svc.unreadCount());
      } else if (event.state === "stopped") {
        svc.add("info", "Agent stopped", "The agent has been stopped.");
        notificationBus.emit("update", svc.unreadCount());
      } else if (event.state === "running") {
        svc.add("info", "Agent started", "The agent is now running.");
        notificationBus.emit("update", svc.unreadCount());
      }
    });
  }

  async start(): Promise<void> {
    // Install log interceptor
    logInterceptor.install();

    try {
      this.server = await startHonoServer({
        fetch: this.app.fetch,
        hostname: this.deps.config.host,
        port: this.deps.config.port,
        onListen: (info) => {
          const url = `http://${info.address}:${info.port}`;

          log.info(`WebUI server running`);
          log.info(`URL:   ${url}/auth/exchange`);
          if (this.authTokenHash) {
            log.info(
              `Startup token: ${maskToken(this.startupExchangeToken)} (one-time browser login)`
            );
          } else {
            log.info(`Token: ${maskToken(this.authToken)} (use Bearer header for API access)`);
          }
          log.info(`One-time exchange link printed to stderr below (not logged).`);
          // Full token intentionally written via raw stderr to bypass the logger
          // so that it never ends up in journalctl, Docker log drivers, tsx
          // --log-file, CI artifacts, or `teleton --debug > log.txt`. See AUDIT-C4.
          process.stderr.write(
            `\n>>> One-time link: ${url}/auth/exchange?token=${this.startupExchangeToken}\n\n`
          );
        },
      });
    } catch (error) {
      logInterceptor.uninstall();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await stopHonoServer(this.server);
      logInterceptor.uninstall();
      log.info("WebUI server stopped");
    }
  }

  getToken(): string {
    return this.authToken;
  }
}
