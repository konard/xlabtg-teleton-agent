import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timeout } from "hono/timeout";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { createServer as createHttpsServer } from "node:https";
import { randomBytes, createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { HTTPException } from "hono/http-exception";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { ensureTlsCert, type TlsCert } from "./tls.js";
import type { ApiServerDeps } from "./deps.js";
import { createDepsAdapter } from "./deps.js";
import type { ApiConfig } from "../config/schema.js";
import type { StateChangeEvent } from "../agent/lifecycle.js";
import { createProblem } from "./schemas/common.js";

// Middleware
import { requestId } from "./middleware/request-id.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { globalRateLimit, mutatingRateLimit, readRateLimit } from "./middleware/rate-limit.js";
import { auditMiddleware } from "./middleware/audit.js";

// Existing WebUI route factories
import { createStatusRoutes } from "../webui/routes/status.js";
import { createToolsRoutes } from "../webui/routes/tools.js";
import { createLogsRoutes } from "../webui/routes/logs.js";
import { createMemoryRoutes } from "../webui/routes/memory.js";
import { createSoulRoutes } from "../webui/routes/soul.js";
import { createPluginsRoutes } from "../webui/routes/plugins.js";
import { createMcpRoutes } from "../webui/routes/mcp.js";
import { createWorkspaceRoutes } from "../webui/routes/workspace.js";
import { createTasksRoutes } from "../webui/routes/tasks.js";
import { createConfigRoutes } from "../webui/routes/config.js";
import { createMarketplaceRoutes } from "../webui/routes/marketplace.js";
import { createHooksRoutes } from "../webui/routes/hooks.js";
import { createTonProxyRoutes } from "../webui/routes/ton-proxy.js";
import { createSetupRoutes } from "../webui/routes/setup.js";

// New API routes
import { createAgentRoutes } from "./routes/agent.js";
import { createSystemRoutes } from "./routes/system.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createApiLogsRoutes } from "./routes/logs.js";
import { createApiMemoryRoutes } from "./routes/memory.js";

const log = createLogger("ManagementAPI");

/** API key prefix */
const KEY_PREFIX = "tltn_";

/** Generate a new API key with tltn_ prefix */
function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Hash an API key with SHA-256 */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Check setup completeness by probing key files */
function getSetupStatus(): Record<string, boolean> {
  return {
    workspace: existsSync(join(TELETON_ROOT, "workspace")),
    config: existsSync(join(TELETON_ROOT, "config.yaml")),
    wallet: existsSync(join(TELETON_ROOT, "wallet.json")),
    telegram_session: existsSync(join(TELETON_ROOT, "telegram_session.txt")),
    embeddings_cached: (() => {
      try {
        return (
          statSync(join(TELETON_ROOT, "models", "Xenova", "all-MiniLM-L6-v2", "onnx", "model.onnx"))
            .size > 1_000_000
        );
      } catch {
        return false;
      }
    })(),
  };
}

/** SSE path patterns that must be excluded from timeout middleware */
const SSE_PATHS = ["/v1/agent/events", "/v1/logs/stream"];

export interface ApiCredentials {
  apiKey: string;
  fingerprint: string;
  port: number;
}

export class ApiServer {
  private app: Hono<{ Bindings: HttpBindings }>;
  private server: ServerType | null = null;
  private deps: ApiServerDeps;
  private config: ApiConfig;
  private tls: TlsCert | null = null;
  private apiKey: string | null = null;
  private keyHash: string;

  constructor(deps: ApiServerDeps, config: ApiConfig) {
    this.deps = deps;
    this.config = config;
    this.app = new Hono<{ Bindings: HttpBindings }>();

    // Determine key hash: use configured or generate new
    if (config.key_hash) {
      this.keyHash = config.key_hash;
    } else {
      this.apiKey = generateApiKey();
      this.keyHash = hashApiKey(this.apiKey);
    }
  }

  /** Get current API key hash (for persisting in config) */
  getKeyHash(): string {
    return this.keyHash;
  }

  /** Update live deps (e.g., when agent starts/stops) */
  updateDeps(partial: Partial<ApiServerDeps>): void {
    Object.assign(this.deps, partial);
  }

  private setupMiddleware(): void {
    // 0. Extract source IP from Node.js socket and expose via c.env.ip
    this.app.use("*", async (c, next) => {
      const incoming = c.env?.incoming;
      if (incoming?.socket?.remoteAddress) {
        // Expose IP in env for auth middleware
        (c.env as Record<string, unknown>).ip = incoming.socket.remoteAddress;
      }
      await next();
    });

    // 1. Request ID
    this.app.use("*", requestId);

    // 2. Body limit (2MB)
    this.app.use(
      "*",
      bodyLimit({
        maxSize: 2 * 1024 * 1024,
        onError: (c) => {
          return c.json(
            createProblem(413, "Payload Too Large", "Request body exceeds 2MB limit"),
            413,
            {
              "Content-Type": "application/problem+json",
            }
          );
        },
      })
    );

    // 3. Timeout (30s) — exclude SSE endpoints
    this.app.use("*", async (c, next) => {
      if (SSE_PATHS.some((p) => c.req.path === p)) {
        return next();
      }
      return timeout(30_000)(c, next);
    });

    // 4. Security headers
    this.app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("X-Frame-Options", "DENY");
      c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    });
  }

  private setupRoutes(): void {
    // Health probes at root (no auth)
    this.app.get("/healthz", (c) => c.json({ status: "ok" }));

    this.app.get("/readyz", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ status: "not_ready", reason: "lifecycle not initialized" }, 503);
      }
      const state = lifecycle.getState();
      if (state === "running") {
        return c.json({ status: "ready", state });
      }

      // Include setup completeness when agent is not running
      const setup = getSetupStatus();
      return c.json({ status: "not_ready", state, setup }, 503);
    });

    // Auth middleware for /v1/* routes
    const authMw = createAuthMiddleware({
      keyHash: this.keyHash,
      allowedIps: this.config.allowed_ips,
    });
    this.app.use("/v1/*", authMw);

    // Rate limiting after auth
    this.app.use("/v1/*", globalRateLimit);
    this.app.use("/v1/*", mutatingRateLimit);
    this.app.use("/v1/*", readRateLimit);

    // Audit logging
    this.app.use("/v1/*", auditMiddleware);

    // OpenAPI spec endpoint
    this.app.get("/v1/openapi.json", (c) => {
      return c.json({
        openapi: "3.1.0",
        info: {
          title: "Teleton Management API",
          version: "1.0.0",
          description: "HTTPS management API for remote teleton agent administration",
        },
        servers: [{ url: `https://localhost:${this.config.port}` }],
      });
    });

    // Adapt deps for existing WebUI route factories
    const adaptedDeps = createDepsAdapter(this.deps);

    // Mount existing WebUI route factories under /v1/
    this.app.route("/v1/status", createStatusRoutes(adaptedDeps));
    this.app.route("/v1/tools", createToolsRoutes(adaptedDeps));
    this.app.route("/v1/logs", createLogsRoutes(adaptedDeps));
    this.app.route("/v1/memory", createMemoryRoutes(adaptedDeps));
    this.app.route("/v1/soul", createSoulRoutes(adaptedDeps));
    this.app.route("/v1/plugins", createPluginsRoutes(adaptedDeps));
    this.app.route("/v1/mcp", createMcpRoutes(adaptedDeps));
    this.app.route("/v1/workspace", createWorkspaceRoutes(adaptedDeps));
    this.app.route("/v1/tasks", createTasksRoutes(adaptedDeps));
    this.app.route("/v1/config", createConfigRoutes(adaptedDeps));
    this.app.route("/v1/marketplace", createMarketplaceRoutes(adaptedDeps));
    this.app.route("/v1/hooks", createHooksRoutes(adaptedDeps));
    this.app.route("/v1/ton-proxy", createTonProxyRoutes(adaptedDeps));

    // Setup routes (no agent deps needed, keyHash for config persistence)
    this.app.route("/v1/setup", createSetupRoutes({ keyHash: this.keyHash }));

    // Agent lifecycle routes (inline, same pattern as WebUI)
    this.app.post("/v1/agent/start", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json(
          createProblem(503, "Service Unavailable", "Agent lifecycle not available"),
          503,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }
      const state = lifecycle.getState();
      if (state === "running") {
        return c.json({ state: "running" }, 409);
      }
      if (state === "stopping") {
        return c.json(
          createProblem(409, "Conflict", "Agent is currently stopping, please wait"),
          409,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }
      lifecycle.start().catch((err: Error) => {
        log.error({ err }, "Agent start failed");
      });
      return c.json({ state: "starting" });
    });

    this.app.post("/v1/agent/stop", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json(
          createProblem(503, "Service Unavailable", "Agent lifecycle not available"),
          503,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }
      const state = lifecycle.getState();
      if (state === "stopped") {
        return c.json({ state: "stopped" }, 409);
      }
      if (state === "starting") {
        return c.json(
          createProblem(409, "Conflict", "Agent is currently starting, please wait"),
          409,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }
      lifecycle.stop().catch((err: Error) => {
        log.error({ err }, "Agent stop failed");
      });
      return c.json({ state: "stopping" });
    });

    this.app.get("/v1/agent/status", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json(
          createProblem(503, "Service Unavailable", "Agent lifecycle not available"),
          503,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }
      return c.json({
        state: lifecycle.getState(),
        uptime: lifecycle.getUptime(),
        error: lifecycle.getError() ?? null,
      });
    });

    this.app.get("/v1/agent/events", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json(
          createProblem(503, "Service Unavailable", "Agent lifecycle not available"),
          503,
          {
            "Content-Type": "application/problem+json",
          }
        );
      }

      return streamSSE(c, async (stream) => {
        let aborted = false;

        stream.onAbort(() => {
          aborted = true;
        });

        const now = Date.now();
        await stream.writeSSE({
          event: "status",
          id: String(now),
          data: JSON.stringify({
            state: lifecycle.getState(),
            error: lifecycle.getError() ?? null,
            timestamp: now,
          }),
          retry: 3000,
        });

        const onStateChange = (event: StateChangeEvent) => {
          if (aborted) return;
          void stream.writeSSE({
            event: "status",
            id: String(event.timestamp),
            data: JSON.stringify({
              state: event.state,
              error: event.error ?? null,
              timestamp: event.timestamp,
            }),
          });
        };

        lifecycle.on("stateChange", onStateChange);

        while (!aborted) {
          await stream.sleep(30_000);
          if (aborted) break;
          await stream.writeSSE({
            event: "ping",
            data: "",
          });
        }

        lifecycle.off("stateChange", onStateChange);
      });
    });

    // New API-only routes under /v1/
    this.app.route("/v1/agent", createAgentRoutes(this.deps.lifecycle));
    this.app.route("/v1/system", createSystemRoutes());
    this.app.route("/v1/auth", createAuthRoutes());
    this.app.route("/v1/api-logs", createApiLogsRoutes());
    this.app.route(
      "/v1/api-memory",
      createApiMemoryRoutes(() => this.deps.memory?.db ?? null)
    );

    // Global error handler — RFC 9457
    this.app.onError((err, c) => {
      log.error({ err }, "Management API error");

      // HTTPException from Hono middleware
      if (err instanceof HTTPException) {
        if (err.res) return err.res;
        return c.json(createProblem(err.status, err.message || "Error"), err.status as 400, {
          "Content-Type": "application/problem+json",
        });
      }

      return c.json(
        createProblem(500, "Internal Server Error", err.message || "An unexpected error occurred"),
        500,
        { "Content-Type": "application/problem+json" }
      );
    });
  }

  async start(): Promise<void> {
    // Generate TLS cert
    const tls = await ensureTlsCert(TELETON_ROOT);
    this.tls = tls;

    // Setup app
    this.setupMiddleware();
    this.setupRoutes();

    return new Promise((resolve, reject) => {
      try {
        const bindHost = this.config.host ?? "127.0.0.1";
        if (bindHost !== "127.0.0.1") {
          log.warn(
            `Management API is binding on ${bindHost} (all interfaces). ` +
              "Set api.host = \"127.0.0.1\" in config.yaml to restrict to localhost only."
          );
        }
        this.server = serve(
          {
            fetch: this.app.fetch as Parameters<typeof serve>[0]["fetch"],
            port: this.config.port,
            hostname: bindHost,
            createServer: createHttpsServer,
            serverOptions: {
              cert: tls.cert,
              key: tls.key,
            },
          },
          (info) => {
            (this.server as HttpServer).maxConnections = 20;
            log.info(`Management API server running on https://${bindHost}:${info.port}`);
            if (this.apiKey) {
              log.info(
                `API key: ${KEY_PREFIX}${this.apiKey.slice(KEY_PREFIX.length, KEY_PREFIX.length + 4)}...`
              );
            }
            log.info(`TLS fingerprint: ${tls.fingerprint.slice(0, 16)}...`);
            resolve();
          }
        );

        (this.server as HttpServer).on("error", (err: Error) => {
          log.error({ err }, "Management API server error");
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        (this.server as HttpServer).closeAllConnections();
        (this.server as HttpServer).close(() => {
          log.info("Management API server stopped");
          resolve();
        });
      });
    }
  }

  getCredentials(): ApiCredentials | null {
    if (!this.tls) return null;
    return {
      apiKey: this.apiKey ?? "",
      fingerprint: this.tls.fingerprint,
      port: this.config.port,
    };
  }
}
