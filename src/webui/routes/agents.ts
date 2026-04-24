import { Hono } from "hono";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CreateManagedAgentInput,
  ManagedAgentMessage,
  ManagedAgentMode,
  ManagedAgentMemoryPolicy,
  ManagedAgentRuntimeStatus,
  ManagedAgentSnapshot,
  UpdateManagedAgentInput,
} from "../../agents/types.js";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import { initAudit } from "../../services/audit.js";
import { validateBotTokenWithTelegram } from "../../telegram/bot-token.js";
import { TelegramAuthManager } from "../setup-auth.js";

const log = createLogger("agents-routes");

interface AgentOverview extends ManagedAgentSnapshot {
  kind: "primary" | "managed";
  canDelete: boolean;
  canStart: boolean;
  canStop: boolean;
  logsAvailable: boolean;
  canStartReason: string | null;
}

function makePrimaryOverview(deps: WebUIServerDeps): AgentOverview {
  const lifecycle = deps.lifecycle;
  if (!lifecycle) {
    throw new Error("Agent lifecycle not available");
  }

  const config = deps.agent.getConfig();
  const rootPath = dirname(deps.configPath);
  const state = lifecycle.getState();
  const uptimeMs = lifecycle.getUptime();

  return {
    id: "primary",
    name: "Primary Agent",
    kind: "primary",
    mode: "personal",
    memoryPolicy: "isolated",
    resources: {
      maxMemoryMb: 0,
      maxConcurrentTasks: 0,
      rateLimitPerMinute: 0,
      llmRateLimitPerMinute: 0,
      restartOnCrash: false,
      maxRestarts: 0,
      restartBackoffMs: 0,
    },
    messaging: {
      enabled: false,
      allowlist: [],
      maxMessagesPerMinute: 0,
    },
    security: {
      personalAccountAccessConfirmedAt: config.meta.created_at ?? null,
    },
    connection: {
      botUsername: config.telegram.bot_username ?? null,
    },
    homePath: rootPath,
    configPath: deps.configPath,
    workspacePath: join(rootPath, "workspace"),
    logPath: "",
    createdAt: config.meta.created_at ?? "",
    updatedAt: config.meta.last_modified_at ?? config.meta.created_at ?? "",
    sourceId: null,
    provider: config.agent.provider,
    model: config.agent.model,
    ownerId: config.telegram.owner_id ?? null,
    adminIds: config.telegram.admin_ids ?? [],
    hasBotToken: Boolean(config.telegram.bot_token),
    hasPersonalCredentials: Boolean(
      Number.isFinite(config.telegram.api_id) &&
      config.telegram.api_id > 0 &&
      config.telegram.api_hash?.trim() &&
      config.telegram.phone?.trim()
    ),
    hasPersonalSession: config.telegram.session_path
      ? existsSync(config.telegram.session_path)
      : false,
    personalPhoneMasked: config.telegram.phone
      ? `${config.telegram.phone.startsWith("+") ? "+" : ""}${"*".repeat(
          Math.max(
            3,
            config.telegram.phone.length - (config.telegram.phone.startsWith("+") ? 3 : 2)
          )
        )}${config.telegram.phone.slice(-2)}`
      : null,
    state,
    pid: process.pid,
    startedAt: uptimeMs !== null ? new Date(Date.now() - uptimeMs).toISOString() : null,
    uptimeMs,
    lastError: lifecycle.getError() ?? null,
    transport: "mtproto",
    health:
      state === "running"
        ? "healthy"
        : state === "starting" || state === "stopping"
          ? "starting"
          : "stopped",
    restartCount: 0,
    lastExitAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    pendingMessages: 0,
    canDelete: false,
    canStart: state === "stopped",
    canStop: state === "running",
    logsAvailable: false,
    canStartReason: null,
  };
}

function makeManagedOverview(snapshot: ManagedAgentSnapshot): AgentOverview {
  const canStartReason =
    snapshot.memoryPolicy !== "isolated"
      ? `Memory policy "${snapshot.memoryPolicy}" is modeled but not startable yet`
      : snapshot.mode === "bot" && !snapshot.hasBotToken
        ? "Bot token is required before this bot-mode agent can start"
        : snapshot.mode === "personal" && !snapshot.security.personalAccountAccessConfirmedAt
          ? "Private-account access consent is required before this personal agent can start"
          : snapshot.mode === "personal" && !snapshot.hasPersonalCredentials
            ? "Phone, API ID, and API hash are required before this personal agent can authenticate"
            : snapshot.mode === "personal" && !snapshot.hasPersonalSession
              ? "Telegram personal auth verification is required before this agent can start"
              : null;
  const supportsStart = !canStartReason;
  return {
    ...snapshot,
    kind: "managed",
    canDelete: snapshot.state === "stopped" || snapshot.state === "error",
    canStart: supportsStart && (snapshot.state === "stopped" || snapshot.state === "error"),
    canStop: snapshot.state === "running" || snapshot.state === "starting",
    logsAvailable: true,
    canStartReason,
  };
}

function withManagedService(deps: WebUIServerDeps) {
  if (!deps.agentManager) {
    throw new Error("Managed agent service not available");
  }
  return deps.agentManager;
}

function logAgentAudit(deps: WebUIServerDeps, details: string): void {
  try {
    initAudit(deps.memory.db).log("other", details);
  } catch {
    // Audit logging is best-effort here; agent control routes still function without it.
  }
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Telegram apiId must be a positive integer");
  }
  return parsed;
}

function isAuthenticatedAuthResult(result: { status: string }): boolean {
  return result.status === "authenticated";
}

function getTelegramAuthErrorMessage(error: unknown): string {
  const telegramError = error as { errorMessage?: string; message?: string };
  return telegramError.errorMessage || telegramError.message || getErrorMessage(error);
}

export function createAgentsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const personalAuthManager = new TelegramAuthManager();

  app.get("/", (c) => {
    try {
      const primary = makePrimaryOverview(deps);
      const managed = deps.agentManager?.listAgentSnapshots().map(makeManagedOverview) ?? [];
      const response: APIResponse<{ agents: AgentOverview[] }> = {
        success: true,
        data: { agents: [primary, ...managed] },
      };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = await c.req.json<
        Partial<CreateManagedAgentInput> & {
          name?: string;
          id?: string;
          cloneFromId?: string;
          mode?: ManagedAgentMode;
          memoryPolicy?: ManagedAgentMemoryPolicy;
        }
      >();
      const service = withManagedService(deps);
      const snapshot = service.createAgent({
        name: body.name?.trim() || "",
        id: body.id?.trim() || undefined,
        cloneFromId:
          body.cloneFromId && body.cloneFromId !== "primary" ? body.cloneFromId : undefined,
        mode: body.mode === "bot" ? "bot" : body.mode === "personal" ? "personal" : undefined,
        botToken: body.botToken?.trim() || undefined,
        botUsername: body.botUsername?.trim() || undefined,
        personalConnection: body.personalConnection
          ? {
              apiId: parseOptionalPositiveInt(body.personalConnection.apiId),
              apiHash: body.personalConnection.apiHash?.trim() || undefined,
              phone: body.personalConnection.phone?.trim() || undefined,
            }
          : undefined,
        memoryPolicy: body.memoryPolicy,
        resources: body.resources,
        messaging: body.messaging,
        acknowledgePersonalAccountAccess: body.acknowledgePersonalAccountAccess,
      });
      logAgentAudit(deps, `agent:create:${snapshot.id}:${snapshot.mode}`);
      const response: APIResponse<AgentOverview> = {
        success: true,
        data: makeManagedOverview(snapshot),
      };
      return c.json(response, 201);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/validate-bot-token", async (c) => {
    try {
      const body = await c.req.json<{ token?: string }>();
      const response: APIResponse<Awaited<ReturnType<typeof validateBotTokenWithTelegram>>> = {
        success: true,
        data: await validateBotTokenWithTelegram(body.token ?? ""),
      };
      return c.json(response);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/:id/clone", async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req
        .json<
          Partial<CreateManagedAgentInput> & {
            name?: string;
            newId?: string;
            mode?: ManagedAgentMode;
            memoryPolicy?: ManagedAgentMemoryPolicy;
          }
        >()
        .catch(
          (): Partial<CreateManagedAgentInput> & {
            name?: string;
            newId?: string;
            mode?: ManagedAgentMode;
            memoryPolicy?: ManagedAgentMemoryPolicy;
          } => ({})
        );
      const sourceName =
        id === "primary"
          ? makePrimaryOverview(deps).name
          : withManagedService(deps).getAgentSnapshot(id).name;
      const service = withManagedService(deps);
      const snapshot = service.createAgent({
        name: body.name?.trim() || `${sourceName} Copy`,
        id: body.newId?.trim() || undefined,
        cloneFromId: id === "primary" ? undefined : id,
        mode: body.mode === "bot" ? "bot" : body.mode === "personal" ? "personal" : undefined,
        botToken: body.botToken?.trim() || undefined,
        botUsername: body.botUsername?.trim() || undefined,
        personalConnection: body.personalConnection
          ? {
              apiId: parseOptionalPositiveInt(body.personalConnection.apiId),
              apiHash: body.personalConnection.apiHash?.trim() || undefined,
              phone: body.personalConnection.phone?.trim() || undefined,
            }
          : undefined,
        memoryPolicy: body.memoryPolicy,
        resources: body.resources,
        messaging: body.messaging,
        acknowledgePersonalAccountAccess: body.acknowledgePersonalAccountAccess,
      });
      logAgentAudit(deps, `agent:clone:${id}->${snapshot.id}:${snapshot.mode}`);
      const response: APIResponse<AgentOverview> = {
        success: true,
        data: makeManagedOverview(snapshot),
      };
      return c.json(response, 201);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.delete("/:id", (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          { success: false, error: "The primary agent cannot be deleted" } as APIResponse,
          400
        );
      }
      withManagedService(deps).deleteAgent(id);
      logAgentAudit(deps, `agent:delete:${id}`);
      const response: APIResponse<{ id: string }> = { success: true, data: { id } };
      return c.json(response);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.patch("/:id", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "The primary agent is not editable from managed-agent routes",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<UpdateManagedAgentInput>();
      if (body.personalConnection) {
        body.personalConnection = {
          apiId: parseOptionalPositiveInt(body.personalConnection.apiId),
          apiHash: body.personalConnection.apiHash?.trim() || undefined,
          phone: body.personalConnection.phone?.trim() || undefined,
        };
      }
      const snapshot = withManagedService(deps).updateAgent(id, body);
      logAgentAudit(deps, `agent:update:${id}`);
      const response: APIResponse<AgentOverview> = {
        success: true,
        data: makeManagedOverview(snapshot),
      };
      return c.json(response);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.get("/:id/status", (c) => {
    try {
      const { id } = c.req.param();
      let status: ManagedAgentRuntimeStatus;
      if (id === "primary") {
        const primary = makePrimaryOverview(deps);
        status = {
          state: primary.state,
          pid: primary.pid,
          startedAt: primary.startedAt,
          uptimeMs: primary.uptimeMs,
          lastError: primary.lastError,
          transport: primary.transport,
          health: primary.health,
          restartCount: primary.restartCount,
          lastExitAt: primary.lastExitAt,
          lastExitCode: primary.lastExitCode,
          lastExitSignal: primary.lastExitSignal,
          pendingMessages: primary.pendingMessages,
        };
      } else {
        status = withManagedService(deps).getRuntimeStatus(id);
      }
      const response: APIResponse<ManagedAgentRuntimeStatus> = { success: true, data: status };
      return c.json(response);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/:id/start", (c) => {
    try {
      const { id } = c.req.param();
      let status: ManagedAgentRuntimeStatus;
      if (id === "primary") {
        const lifecycle = deps.lifecycle;
        if (!lifecycle) {
          return c.json(
            { success: false, error: "Agent lifecycle not available" } as APIResponse,
            503
          );
        }
        const state = lifecycle.getState();
        if (state === "running") {
          return c.json({ success: false, error: "Agent is already running" } as APIResponse, 409);
        }
        if (state === "stopping") {
          return c.json(
            { success: false, error: "Agent is currently stopping" } as APIResponse,
            409
          );
        }
        lifecycle.start().catch((error: Error) => {
          log.error({ err: error }, "Primary agent start failed");
        });
        status = {
          state: "starting",
          pid: process.pid,
          startedAt: null,
          uptimeMs: null,
          lastError: null,
          transport: "mtproto",
          health: "starting",
          restartCount: 0,
          lastExitAt: null,
          lastExitCode: null,
          lastExitSignal: null,
          pendingMessages: 0,
        };
      } else {
        status = withManagedService(deps).startAgent(id);
        logAgentAudit(deps, `agent:start:${id}`);
      }
      const response: APIResponse<ManagedAgentRuntimeStatus> = { success: true, data: status };
      return c.json(response);
    } catch (error) {
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/:id/personal-auth/send-code", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req
        .json<{ apiId?: number; apiHash?: string; phone?: string }>()
        .catch((): { apiId?: number; apiHash?: string; phone?: string } => ({}));
      const authTarget = withManagedService(deps).resolvePersonalAuthTarget(id, {
        apiId: parseOptionalPositiveInt(body.apiId),
        apiHash: body.apiHash?.trim() || undefined,
        phone: body.phone?.trim() || undefined,
      });
      const data = await personalAuthManager.sendCode(
        authTarget.apiId,
        authTarget.apiHash,
        authTarget.phone,
        {
          configPath: authTarget.configPath,
          sessionPath: authTarget.sessionPath,
          replaceTelegramIdentity: true,
        }
      );
      logAgentAudit(deps, `agent:personal-auth:send-code:${id}`);
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error: unknown) {
      const rateLimit = error as { seconds?: number; errorMessage?: string; message?: string };
      if (rateLimit.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${rateLimit.seconds} seconds.`,
          } as APIResponse,
          429
        );
      }
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/:id/personal-auth/verify-code", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<{ authSessionId?: string; code?: string }>();
      if (!body.authSessionId || !body.code) {
        return c.json(
          { success: false, error: "Missing authSessionId or code" } as APIResponse,
          400
        );
      }
      const data = await personalAuthManager.verifyCode(body.authSessionId, body.code);
      if (isAuthenticatedAuthResult(data)) {
        withManagedService(deps).recordPersonalAuth(id);
        logAgentAudit(deps, `agent:personal-auth:verified:${id}`);
      }
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/personal-auth/verify-password", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<{ authSessionId?: string; password?: string }>();
      if (!body.authSessionId || !body.password) {
        return c.json(
          { success: false, error: "Missing authSessionId or password" } as APIResponse,
          400
        );
      }
      const data = await personalAuthManager.verifyPassword(body.authSessionId, body.password);
      if (isAuthenticatedAuthResult(data)) {
        withManagedService(deps).recordPersonalAuth(id);
        logAgentAudit(deps, `agent:personal-auth:verified:${id}`);
      }
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/personal-auth/resend-code", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<{ authSessionId?: string }>();
      if (!body.authSessionId) {
        return c.json({ success: false, error: "Missing authSessionId" } as APIResponse, 400);
      }
      const data = await personalAuthManager.resendCode(body.authSessionId);
      if (!data) {
        return c.json({ success: false, error: "Session expired or invalid" } as APIResponse, 400);
      }
      logAgentAudit(deps, `agent:personal-auth:resend-code:${id}`);
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error: unknown) {
      const rateLimit = error as { seconds?: number; errorMessage?: string; message?: string };
      if (rateLimit.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${rateLimit.seconds} seconds.`,
          } as APIResponse,
          429
        );
      }
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/personal-auth/qr-start", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req
        .json<{ apiId?: number; apiHash?: string; phone?: string }>()
        .catch((): { apiId?: number; apiHash?: string; phone?: string } => ({}));
      const authTarget = withManagedService(deps).resolvePersonalAuthTarget(id, {
        apiId: parseOptionalPositiveInt(body.apiId),
        apiHash: body.apiHash?.trim() || undefined,
        phone: body.phone?.trim() || undefined,
      });
      const data = await personalAuthManager.startQrSession(authTarget.apiId, authTarget.apiHash, {
        configPath: authTarget.configPath,
        sessionPath: authTarget.sessionPath,
        replaceTelegramIdentity: true,
      });
      logAgentAudit(deps, `agent:personal-auth:qr-start:${id}`);
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error: unknown) {
      const rateLimit = error as { seconds?: number; errorMessage?: string; message?: string };
      if (rateLimit.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${rateLimit.seconds} seconds.`,
          } as APIResponse,
          429
        );
      }
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.post("/:id/personal-auth/qr-refresh", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<{ authSessionId?: string }>();
      if (!body.authSessionId) {
        return c.json({ success: false, error: "Missing authSessionId" } as APIResponse, 400);
      }
      const data = await personalAuthManager.refreshQrToken(body.authSessionId);
      if (isAuthenticatedAuthResult(data)) {
        withManagedService(deps).recordPersonalAuth(id);
        logAgentAudit(deps, `agent:personal-auth:qr-verified:${id}`);
      }
      return c.json({ success: true, data } as APIResponse<typeof data>);
    } catch (error: unknown) {
      const rateLimit = error as { seconds?: number; errorMessage?: string; message?: string };
      if (rateLimit.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${rateLimit.seconds} seconds.`,
          } as APIResponse,
          429
        );
      }
      return c.json(
        { success: false, error: getTelegramAuthErrorMessage(error) } as APIResponse,
        400
      );
    }
  });

  app.delete("/:id/personal-auth/session", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Use the setup Telegram auth flow for the primary agent",
          } as APIResponse,
          400
        );
      }
      const body = await c.req
        .json<{ authSessionId?: string }>()
        .catch(() => ({ authSessionId: "" }));
      await personalAuthManager.cancelSession(body.authSessionId ?? "");
      logAgentAudit(deps, `agent:personal-auth:cancel:${id}`);
      return c.json({ success: true } as APIResponse);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/stop", (c) => {
    try {
      const { id } = c.req.param();
      let status: ManagedAgentRuntimeStatus;
      if (id === "primary") {
        const lifecycle = deps.lifecycle;
        if (!lifecycle) {
          return c.json(
            { success: false, error: "Agent lifecycle not available" } as APIResponse,
            503
          );
        }
        const state = lifecycle.getState();
        if (state === "stopped") {
          return c.json({ success: false, error: "Agent is already stopped" } as APIResponse, 409);
        }
        if (state === "starting") {
          return c.json(
            { success: false, error: "Agent is currently starting" } as APIResponse,
            409
          );
        }
        lifecycle.stop().catch((error: Error) => {
          log.error({ err: error }, "Primary agent stop failed");
        });
        status = {
          state: "stopping",
          pid: process.pid,
          startedAt: null,
          uptimeMs: null,
          lastError: null,
          transport: "mtproto",
          health: "starting",
          restartCount: 0,
          lastExitAt: null,
          lastExitCode: null,
          lastExitSignal: null,
          pendingMessages: 0,
        };
      } else {
        status = withManagedService(deps).stopAgent(id);
        logAgentAudit(deps, `agent:stop:${id}`);
      }
      const response: APIResponse<ManagedAgentRuntimeStatus> = { success: true, data: status };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.get("/:id/logs", (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "Primary agent logs are available through the main Logs page",
          } as APIResponse,
          400
        );
      }
      const lines = Number(c.req.query("lines") ?? "200");
      const logs = withManagedService(deps).readLogs(id, Number.isFinite(lines) ? lines : 200);
      const response: APIResponse<typeof logs> = { success: true, data: logs };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.get("/:id/messages", (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "The primary agent does not expose a managed-agent inbox",
          } as APIResponse,
          400
        );
      }
      const limit = Number(c.req.query("limit") ?? String(100));
      const data = withManagedService(deps).readMessages(id, Number.isFinite(limit) ? limit : 100);
      const response: APIResponse<{ messages: ManagedAgentMessage[] }> = { success: true, data };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/messages", async (c) => {
    try {
      const { id } = c.req.param();
      if (id === "primary") {
        return c.json(
          {
            success: false,
            error: "The primary agent cannot receive managed-agent inbox messages",
          } as APIResponse,
          400
        );
      }
      const body = await c.req.json<{ fromId?: string; text?: string }>();
      const message = withManagedService(deps).sendMessage(
        body.fromId?.trim() || "primary",
        id,
        body.text?.trim() || ""
      );
      logAgentAudit(deps, `agent:message:${message.fromId}->${message.toId}`);
      const response: APIResponse<ManagedAgentMessage> = { success: true, data: message };
      return c.json(response, 201);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  return app;
}
