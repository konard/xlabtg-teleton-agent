import { Hono } from "hono";
import { dirname, join } from "node:path";
import type {
  ManagedAgentMode,
  ManagedAgentRuntimeStatus,
  ManagedAgentSnapshot,
} from "../../agents/types.js";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("agents-routes");

interface AgentOverview extends ManagedAgentSnapshot {
  kind: "primary" | "managed";
  canDelete: boolean;
  canStart: boolean;
  canStop: boolean;
  logsAvailable: boolean;
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
    canDelete: false,
    canStart: state === "stopped",
    canStop: state === "running",
    logsAvailable: false,
  };
}

function makeManagedOverview(snapshot: ManagedAgentSnapshot): AgentOverview {
  const supportsStart = snapshot.mode === "personal";
  return {
    ...snapshot,
    kind: "managed",
    canDelete: snapshot.state === "stopped" || snapshot.state === "error",
    canStart: supportsStart && (snapshot.state === "stopped" || snapshot.state === "error"),
    canStop: snapshot.state === "running" || snapshot.state === "starting",
    logsAvailable: true,
  };
}

function withManagedService(deps: WebUIServerDeps) {
  if (!deps.agentManager) {
    throw new Error("Managed agent service not available");
  }
  return deps.agentManager;
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
      const body = await c.req.json<{
        name?: string;
        id?: string;
        cloneFromId?: string;
        mode?: ManagedAgentMode;
      }>();
      const service = withManagedService(deps);
      const snapshot = service.createAgent({
        name: body.name?.trim() || "",
        id: body.id?.trim() || undefined,
        cloneFromId:
          body.cloneFromId && body.cloneFromId !== "primary" ? body.cloneFromId : undefined,
        mode: body.mode === "bot" ? "bot" : body.mode === "personal" ? "personal" : undefined,
      });
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
        .json<{ name?: string; newId?: string; mode?: ManagedAgentMode }>()
        .catch((): { name?: string; newId?: string; mode?: ManagedAgentMode } => ({}));
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
      });
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
      const response: APIResponse<{ id: string }> = { success: true, data: { id } };
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
        };
      } else {
        status = withManagedService(deps).startAgent(id);
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
        };
      } else {
        status = withManagedService(deps).stopAgent(id);
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

  return app;
}
