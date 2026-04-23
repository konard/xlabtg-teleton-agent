import { Hono } from "hono";
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

export function createAgentsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

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
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
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
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
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
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
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
      const snapshot = withManagedService(deps).updateAgent(id, body);
      logAgentAudit(deps, `agent:update:${id}`);
      const response: APIResponse<AgentOverview> = {
        success: true,
        data: makeManagedOverview(snapshot),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
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
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
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
