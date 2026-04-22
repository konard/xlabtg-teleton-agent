/**
 * Setup WebUI Server
 *
 * Lightweight Hono server for the setup wizard.
 * Runs on port 7777 (localhost-only), no auth needed.
 * Pattern: simplified version of src/webui/server.ts.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { createSetupRoutes } from "./routes/setup.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import YAML from "yaml";
import { TELETON_ROOT } from "../workspace/paths.js";
import type { Server as HttpServer } from "node:http";
import type { Context } from "hono";
import { createLogger } from "../utils/logger.js";
import { hashToken } from "./middleware/token-hash.js";

const log = createLogger("Setup");

/** Max requests per window per client to /api/setup/launch. */
const LAUNCH_RATE_LIMIT_MAX = 5;
/** Rolling window for the launch rate limiter. */
const LAUNCH_RATE_LIMIT_WINDOW_MS = 60_000;
/** Header used to present the bootstrap nonce. */
export const SETUP_NONCE_HEADER = "X-Setup-Nonce";

function clientKey(c: Context): string {
  // `@hono/node-server` exposes the raw socket via c.env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress || "unknown";
}

function nonceMatches(provided: string | undefined | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function findWebDist(): string | null {
  const candidates = [resolve("dist/web"), resolve("web")];
  const __dirname = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(__dirname, "web"), resolve(__dirname, "../dist/web"));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function autoOpenBrowser(url: string): void {
  const os = platform();
  let prog: string;

  if (os === "darwin") {
    prog = "open";
  } else if (os === "win32") {
    prog = "explorer";
  } else {
    prog = "xdg-open";
  }

  const child = spawn(prog, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {
    log.info(`Open this URL in your browser: ${url}`);
  });
  child.unref();
}

export class SetupServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private launchResolve: ((token: string) => void) | null = null;
  private launchPromise: Promise<string>;
  /** One-time bootstrap nonce — required to call POST /api/setup/launch. */
  private readonly nonce: string;
  /** Flipped true after a successful launch. No further launches are accepted. */
  private launchConsumed = false;
  /** In-process rate limiter state for the launch endpoint, keyed by client IP. */
  private readonly launchAttempts = new Map<string, number[]>();

  constructor(private port: number = 7777) {
    this.app = new Hono();
    this.nonce = randomBytes(32).toString("hex");
    this.launchPromise = new Promise<string>((resolve) => {
      this.launchResolve = resolve;
    });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupStaticServing();
  }

  /** Returns the bootstrap nonce so the CLI can print it / embed it in the launch URL. */
  getNonce(): string {
    return this.nonce;
  }

  /** Returns a promise that resolves with the auth token when the user clicks "Start Agent" */
  waitForLaunch(): Promise<string> {
    return this.launchPromise;
  }

  /**
   * Record an attempt and return true if the caller is within the rate limit.
   * Uses a simple sliding-window counter keyed by client IP.
   */
  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const cutoff = now - LAUNCH_RATE_LIMIT_WINDOW_MS;
    const history = this.launchAttempts.get(key) ?? [];
    const recent = history.filter((ts) => ts > cutoff);
    recent.push(now);
    this.launchAttempts.set(key, recent);
    return recent.length <= LAUNCH_RATE_LIMIT_MAX;
  }

  private setupMiddleware(): void {
    // CORS for localhost
    this.app.use(
      "*",
      cors({
        origin: [
          "http://localhost:5173",
          `http://localhost:${this.port}`,
          "http://127.0.0.1:5173",
          `http://127.0.0.1:${this.port}`,
        ],
        credentials: true,
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
        allowHeaders: ["Content-Type", SETUP_NONCE_HEADER],
        maxAge: 3600,
      })
    );

    // Body size limit
    this.app.use(
      "*",
      bodyLimit({
        maxSize: 2 * 1024 * 1024,
        onError: (c) => c.json({ success: false, error: "Request body too large (max 2MB)" }, 413),
      })
    );

    // Security headers
    this.app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("X-Frame-Options", "DENY");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    });

    // No auth middleware — localhost-only setup server
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (c) => c.json({ status: "ok" }));

    // Mount setup routes
    this.app.route("/api/setup", createSetupRoutes());

    // Auth check — setup server is NOT authenticated, return a distinguishable response
    // so pollHealth can tell setup server apart from the real agent WebUI
    this.app.get("/auth/check", (c) =>
      c.json({ success: true, data: { authenticated: false, setup: true } })
    );

    // Launch endpoint — generates the auth token, hashes it into config.yaml,
    // and resolves the launch promise. Gated by a one-time bootstrap nonce and
    // a small rate limiter (see AUDIT-H7).
    this.app.post("/api/setup/launch", async (c) => {
      // 1. Rate limit first, before any work — malicious callers should not be
      // able to burn CPU on nonce comparisons or hashing.
      const key = clientKey(c);
      if (!this.checkRateLimit(key)) {
        const retryAfter = Math.ceil(LAUNCH_RATE_LIMIT_WINDOW_MS / 1000);
        return c.json(
          {
            success: false,
            error: `Too many launch attempts. Try again in ${retryAfter}s.`,
          },
          429,
          { "Retry-After": String(retryAfter) }
        );
      }

      // 2. Once a launch has succeeded, no further launches are accepted —
      // a second caller could otherwise rotate the token out from under the
      // legitimate user.
      if (this.launchConsumed) {
        return c.json(
          {
            success: false,
            error: "Setup already launched — restart `teleton setup --ui` to retry.",
          },
          409
        );
      }

      // 3. Validate the bootstrap nonce. Check header first (preferred),
      // then JSON body as a fallback for clients that can't set headers.
      let provided = c.req.header(SETUP_NONCE_HEADER);
      if (!provided) {
        try {
          const body = (await c.req.json().catch(() => null)) as { nonce?: unknown } | null;
          if (body && typeof body.nonce === "string") provided = body.nonce;
        } catch {
          // no body — fall through to 401
        }
      }
      if (!nonceMatches(provided, this.nonce)) {
        return c.json({ success: false, error: "Invalid or missing setup nonce" }, 401);
      }

      try {
        // Generate auth token — returned once to the client, never persisted in plaintext.
        const token = randomBytes(32).toString("hex");
        const tokenHash = hashToken(token);

        // Persist hashed token into config.yaml. We explicitly delete any
        // legacy `auth_token` so a prior plaintext value does not linger.
        const configPath = join(TELETON_ROOT, "config.yaml");
        const raw = readFileSync(configPath, "utf-8");
        const config = YAML.parse(raw) ?? {};
        const webui = { ...(config.webui || {}) };
        delete webui.auth_token;
        webui.enabled = true;
        webui.auth_token_hash = tokenHash;
        config.webui = webui;
        writeFileSync(configPath, YAML.stringify(config), { encoding: "utf-8", mode: 0o600 });

        // Mark launch consumed so no second caller can rotate the token.
        this.launchConsumed = true;
        log.info("Launch requested — auth token generated");

        // Resolve the launch promise AFTER the response is sent — otherwise
        // server.stop() kills the connection before the client gets the token
        const resolve = this.launchResolve;
        this.launchResolve = null;
        if (resolve) {
          setTimeout(() => resolve(token), 500);
        }

        return c.json({ success: true, data: { token } });
      } catch (err) {
        return c.json(
          { success: false, error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
    });

    // Error handler
    this.app.onError((err, c) => {
      log.error({ err }, "Setup server error");
      return c.json({ success: false, error: err.message || "Internal server error" }, 500);
    });
  }

  private setupStaticServing(): void {
    const webDist = findWebDist();
    if (!webDist) {
      log.warn(
        "Web UI build not found (dist/web/index.html missing) — run `npm run build:web` to build the frontend"
      );
      return;
    }
    log.info(`Serving UI from: ${webDist}`);

    const indexHtml = readFileSync(join(webDist, "index.html"), "utf-8");

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

    this.app.get("*", (c) => {
      const filePath = resolve(join(webDist, c.req.path));
      // Prevent path traversal
      const rel = relative(webDist, filePath);
      if (rel.startsWith("..") || resolve(filePath) !== filePath) {
        return c.html(indexHtml);
      }

      try {
        const content = readFileSync(filePath);
        const ext = filePath.split(".").pop() || "";
        if (mimeTypes[ext]) {
          // Vite hashes asset filenames (e.g. /assets/index-abc123.js) — safe to cache forever.
          // All other static files must not be cached so browsers always fetch the latest
          // version after a rebuild.
          const immutable = c.req.path.startsWith("/assets/");
          return c.body(content, 200, {
            "Content-Type": mimeTypes[ext],
            "Cache-Control": immutable
              ? "public, max-age=31536000, immutable"
              : "no-cache, no-store, must-revalidate",
          });
        }
      } catch {
        // File not found — fall through to SPA
      }

      // SPA fallback (never cache)
      return c.html(indexHtml, 200, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = serve(
          {
            fetch: this.app.fetch,
            hostname: "127.0.0.1",
            port: this.port,
          },
          () => {
            const url = `http://localhost:${this.port}/setup`;
            log.info(`Setup wizard: ${url}`);
            autoOpenBrowser(url);
            resolve();
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        // Force-close keep-alive connections so we don't wait ~30s for them to expire
        (this.server as unknown as HttpServer).closeAllConnections();
        this.server?.close(() => {
          log.info("Setup server stopped");
          resolve();
        });
      });
    }
  }
}
