import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebUIServerDeps } from "./types.js";
import { createLifecycleSSE } from "./lifecycle-sse.js";
import { applySecurityMiddleware, sharedBodyLimit, closeServer } from "./http-common.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("WebUI");
import {
  generateToken,
  maskToken,
  safeCompare,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from "./middleware/auth.js";
import { logInterceptor } from "./log-interceptor.js";
import { createStatusRoutes } from "./routes/status.js";
import { createToolsRoutes } from "./routes/tools.js";
import { createLogsRoutes } from "./routes/logs.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createSoulRoutes } from "./routes/soul.js";
import { createPluginsRoutes } from "./routes/plugins.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createTasksRoutes } from "./routes/tasks.js";
import { createConfigRoutes } from "./routes/config.js";
import { createMarketplaceRoutes } from "./routes/marketplace.js";
import { createHooksRoutes } from "./routes/hooks.js";
import { createTonProxyRoutes } from "./routes/ton-proxy.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createWalletRoutes } from "./routes/wallet.js";
import { readRawConfig, writeRawConfig } from "../config/configurable-keys.js";

function findWebDist(): string | null {
  // Try common locations relative to CWD (where teleton is launched from)
  const candidates = [
    resolve("dist/web"), // npm start / teleton start (from project root)
    resolve("web"), // fallback
  ];
  // Also try relative to the compiled file
  const __dirname = dirname(fileURLToPath(import.meta.url));
  candidates.push(
    resolve(__dirname, "web"), // dist/web when __dirname = dist/
    resolve(__dirname, "../dist/web") // when running with tsx from src/
  );

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

export class WebUIServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private deps: WebUIServerDeps;
  private authToken: string;

  constructor(deps: WebUIServerDeps) {
    this.deps = deps;
    this.app = new Hono();

    // Generate or use configured auth token
    this.authToken = deps.config.auth_token || generateToken();

    this.setupMiddleware();
    this.setupRoutes();
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
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 3600,
      })
    );

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
      // 1. Check HttpOnly session cookie (primary — browser)
      const cookieToken = getCookie(c, COOKIE_NAME);
      if (cookieToken && safeCompare(cookieToken, this.authToken)) {
        return next();
      }

      // 2. Check Authorization header (secondary — API/curl)
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match && safeCompare(match[1], this.authToken)) {
          return next();
        }
      }

      // 3. Check ?token= query param (fallback — backward compat)
      const queryToken = c.req.query("token");
      if (queryToken && safeCompare(queryToken, this.authToken)) {
        return next();
      }

      return c.json({ success: false, error: "Unauthorized" }, 401);
    });
  }

  private setupRoutes() {
    // Health check (no auth)
    this.app.get("/health", (c) => c.json({ status: "ok" }));

    // === Auth routes (no auth required) ===

    // Token exchange: browser opens with ?token=, gets HttpOnly cookie, redirects to /
    this.app.get("/auth/exchange", (c) => {
      const token = c.req.query("token");
      if (!token || !safeCompare(token, this.authToken)) {
        return c.json({ success: false, error: "Invalid token" }, 401);
      }

      this.setSessionCookie(c);
      return c.redirect("/");
    });

    // Manual login: POST with token, get cookie
    this.app.post("/auth/login", async (c) => {
      try {
        const body = await c.req.json<{ token: string }>();
        if (!body.token || !safeCompare(body.token, this.authToken)) {
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
    this.app.route("/api/status", createStatusRoutes(this.deps));
    this.app.route("/api/tools", createToolsRoutes(this.deps));
    this.app.route("/api/logs", createLogsRoutes(this.deps));
    this.app.route("/api/memory", createMemoryRoutes(this.deps));
    this.app.route("/api/soul", createSoulRoutes(this.deps));
    this.app.route("/api/plugins", createPluginsRoutes(this.deps));
    this.app.route("/api/mcp", createMcpRoutes(this.deps));
    this.app.route("/api/workspace", createWorkspaceRoutes(this.deps));
    this.app.route("/api/tasks", createTasksRoutes(this.deps));
    this.app.route("/api/config", createConfigRoutes(this.deps));
    this.app.route("/api/marketplace", createMarketplaceRoutes(this.deps));
    this.app.route("/api/hooks", createHooksRoutes(this.deps));
    this.app.route("/api/ton-proxy", createTonProxyRoutes(this.deps));
    this.app.route("/api/conversations", createConversationRoutes(this.deps));
    this.app.route("/api/wallet", createWalletRoutes(this.deps));

    // Agent lifecycle routes
    this.app.post("/api/agent/start", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }
      const state = lifecycle.getState();
      if (state === "running") {
        return c.json({ state: "running" }, 409);
      }
      if (state === "stopping") {
        return c.json({ error: "Agent is currently stopping, please wait" }, 409);
      }
      // Fire-and-forget: start is async, we return immediately
      lifecycle.start().catch((err: Error) => {
        log.error({ err }, "Agent start failed");
      });
      return c.json({ state: "starting" });
    });

    this.app.post("/api/agent/stop", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }
      const state = lifecycle.getState();
      if (state === "stopped") {
        return c.json({ state: "stopped" }, 409);
      }
      if (state === "starting") {
        return c.json({ error: "Agent is currently starting, please wait" }, 409);
      }
      // Fire-and-forget: stop is async, we return immediately
      lifecycle.stop().catch((err: Error) => {
        log.error({ err }, "Agent stop failed");
      });
      return c.json({ state: "stopping" });
    });

    this.app.get("/api/agent/status", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }
      return c.json({
        state: lifecycle.getState(),
        uptime: lifecycle.getUptime(),
        error: lifecycle.getError() ?? null,
      });
    });

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

    // Serve static files in production (if built)
    const webDist = findWebDist();
    if (webDist) {
      const indexHtml = readFile(join(webDist, "index.html"), "utf-8");

      const mimeTypes: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        ico: "image/x-icon",
        json: "application/json",
        woff2: "font/woff2",
        woff: "font/woff",
      };

      // Serve static files (assets, images, etc.) with SPA fallback
      this.app.get("*", async (c) => {
        const filePath = resolve(join(webDist, c.req.path));
        // Prevent path traversal — resolved path must stay inside webDist
        const rel = relative(webDist, filePath);
        if (rel.startsWith("..") || resolve(filePath) !== filePath) {
          return c.html(await indexHtml);
        }

        // Try serving the actual file
        try {
          const content = await readFile(filePath);
          const ext = filePath.split(".").pop() || "";
          if (mimeTypes[ext]) {
            const immutable = c.req.path.startsWith("/assets/");
            return c.body(content, 200, {
              "Content-Type": mimeTypes[ext],
              "Cache-Control": immutable
                ? "public, max-age=31536000, immutable"
                : "public, max-age=3600",
            });
          }
        } catch {
          // File not found — fall through to SPA
        }

        // SPA fallback: serve index.html for all non-file routes
        return c.html(await indexHtml);
      });
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

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Install log interceptor
        logInterceptor.install();

        // Start HTTP server
        this.server = serve(
          {
            fetch: this.app.fetch,
            hostname: this.deps.config.host,
            port: this.deps.config.port,
          },
          (info) => {
            const url = `http://${info.address}:${info.port}`;

            log.info(`WebUI server running`);
            log.info(`URL: ${url}/auth/exchange?token=${this.authToken}`);
            log.info(`Token: ${maskToken(this.authToken)} (use Bearer header for API access)`);
            resolve();
          }
        );
      } catch (error) {
        logInterceptor.uninstall();
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await closeServer(this.server as HttpServer);
      logInterceptor.uninstall();
      log.info("WebUI server stopped");
    }
  }

  getToken(): string {
    return this.authToken;
  }
}
