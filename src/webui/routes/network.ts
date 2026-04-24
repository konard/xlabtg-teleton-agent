import { Hono } from "hono";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { AuditTrailService } from "../../services/audit-trail.js";
import { NetworkTaskCoordinator } from "../../services/network/coordinator.js";
import { getAgentNetworkStore } from "../../services/network/discovery.js";
import { NetworkMessageReplayError, NetworkMessenger } from "../../services/network/messenger.js";
import {
  NETWORK_AGENT_STATUSES,
  NETWORK_TRUST_LEVELS,
  type AgentNetworkAdvertisement,
  type NetworkAgentStatus,
  type NetworkMessageEnvelope,
  type NetworkTrustLevel,
} from "../../services/network/types.js";
import { getErrorMessage } from "../../utils/errors.js";
import type { APIResponse, WebUIServerDeps } from "../types.js";

interface RegisterAgentBody extends Partial<AgentNetworkAdvertisement> {
  id?: string;
  trustLevel?: NetworkTrustLevel;
  blocked?: boolean;
}

interface TrustBody {
  trustLevel?: NetworkTrustLevel;
  blocked?: boolean;
}

interface TaskBody {
  description?: string;
  requiredCapabilities?: string[];
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeStatus(value: unknown): NetworkAgentStatus {
  return NETWORK_AGENT_STATUSES.includes(value as NetworkAgentStatus)
    ? (value as NetworkAgentStatus)
    : "available";
}

function normalizeTrustLevel(value: unknown): NetworkTrustLevel {
  return NETWORK_TRUST_LEVELS.includes(value as NetworkTrustLevel)
    ? (value as NetworkTrustLevel)
    : "untrusted";
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function localAgentId(deps: WebUIServerDeps): string {
  return deps.networkConfig?.agent_id?.trim() || "primary";
}

function localAgentName(deps: WebUIServerDeps): string {
  return deps.networkConfig?.agent_name?.trim() || "Primary Agent";
}

function networkEnabled(deps: WebUIServerDeps): boolean {
  return deps.networkConfig?.enabled === true;
}

function createCoordinator(deps: WebUIServerDeps): NetworkTaskCoordinator {
  return new NetworkTaskCoordinator({
    store: getAgentNetworkStore(deps.memory.db),
    localAgentId: localAgentId(deps),
    privateKey: deps.networkConfig?.private_key ?? null,
    fetcher: fetch,
    timeoutMs: deps.networkConfig?.message_timeout_ms,
    allowlist: deps.networkConfig?.allowlist,
    blocklist: deps.networkConfig?.blocklist,
  });
}

function createMessenger(deps: WebUIServerDeps): NetworkMessenger {
  return new NetworkMessenger({
    store: getAgentNetworkStore(deps.memory.db),
    localAgentId: localAgentId(deps),
    privateKey: deps.networkConfig?.private_key ?? null,
    fetcher: fetch,
    timeoutMs: deps.networkConfig?.message_timeout_ms,
    maxClockSkewSeconds: deps.networkConfig?.max_clock_skew_seconds,
    auditTrail: new AuditTrailService(deps.memory.db),
  });
}

function localCapabilities(deps: WebUIServerDeps): string[] {
  const tools = deps.toolRegistry?.getAll?.().map((tool) => tool.name) ?? [];
  return [...new Set(["task-delegation", ...tools])].sort();
}

export function createNetworkRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.get("/agents", (c) => {
    const agents = getAgentNetworkStore(deps.memory.db).listAgents();
    return c.json({ success: true, data: { agents } } as APIResponse);
  });

  app.post("/agents", async (c) => {
    try {
      const body = await c.req.json<RegisterAgentBody>();
      const agentId = body.agentId ?? body.id;
      if (!agentId || !body.name || !body.endpoint) {
        return c.json(
          { success: false, error: "agentId, name, and endpoint are required" } as APIResponse,
          400
        );
      }

      const agent = getAgentNetworkStore(deps.memory.db).registerAgent(
        {
          agentId,
          name: body.name,
          endpoint: body.endpoint,
          capabilities: normalizeStringArray(body.capabilities),
          status: normalizeStatus(body.status),
          load: normalizeNumber(body.load, 0),
          publicKey: body.publicKey ?? null,
          metadata: normalizePayload(body.metadata),
        },
        {
          trustLevel: body.trustLevel ?? deps.networkConfig?.default_trust_level ?? "untrusted",
          blocked: body.blocked,
        }
      );

      return c.json({ success: true, data: { agent } } as APIResponse, 201);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.delete("/agents/:id", (c) => {
    const removed = getAgentNetworkStore(deps.memory.db).removeAgent(c.req.param("id"));
    if (!removed) {
      return c.json({ success: false, error: "Network agent not found" } as APIResponse, 404);
    }
    return c.json({ success: true, data: null } as APIResponse);
  });

  app.get("/agents/:id/capabilities", (c) => {
    const agent = getAgentNetworkStore(deps.memory.db).getAgent(c.req.param("id"));
    if (!agent) {
      return c.json({ success: false, error: "Network agent not found" } as APIResponse, 404);
    }
    return c.json({
      success: true,
      data: {
        agentId: agent.id,
        capabilities: agent.capabilities,
        status: agent.status,
        load: agent.load,
      },
    } as APIResponse);
  });

  app.put("/agents/:id/trust", async (c) => {
    try {
      const body = await c.req.json<TrustBody>();
      const agent = getAgentNetworkStore(deps.memory.db).updateAgentTrust(c.req.param("id"), {
        trustLevel: body.trustLevel ? normalizeTrustLevel(body.trustLevel) : undefined,
        blocked: body.blocked,
      });
      return c.json({ success: true, data: { agent } } as APIResponse);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/agents/:id/tasks", async (c) => {
    if (!networkEnabled(deps)) {
      return c.json({ success: false, error: "Agent network is disabled" } as APIResponse, 403);
    }

    try {
      const body = await c.req.json<TaskBody>();
      const description = body.description?.trim();
      if (!description) {
        return c.json({ success: false, error: "description is required" } as APIResponse, 400);
      }
      const result = await createCoordinator(deps).delegateTask({
        agentId: c.req.param("id"),
        description,
        requiredCapabilities: normalizeStringArray(body.requiredCapabilities),
        payload: normalizePayload(body.payload),
        timeoutMs: body.timeoutMs,
      });
      return c.json(
        {
          success: true,
          data: result,
        } as APIResponse,
        202
      );
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.get("/status", (c) => {
    const status = getAgentNetworkStore(deps.memory.db).getNetworkStatus();
    return c.json({ success: true, data: status } as APIResponse);
  });

  app.get("/messages", (c) => {
    const messages = getAgentNetworkStore(deps.memory.db).listMessages({
      from: c.req.query("from"),
      to: c.req.query("to"),
      type: c.req.query("type"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json({ success: true, data: { messages } } as APIResponse);
  });

  return app;
}

export function createAgentNetworkIngressRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.post("/", async (c) => {
    if (!networkEnabled(deps)) {
      return c.json({ success: false, error: "Agent network is disabled" } as APIResponse, 403);
    }

    try {
      const message = await c.req.json<NetworkMessageEnvelope>();
      const record = createMessenger(deps).receiveMessage(message);
      const payload = normalizePayload(message.payload);

      if (message.type === "heartbeat") {
        const status = normalizeStatus(payload.status);
        getAgentNetworkStore(deps.memory.db).recordHeartbeat(message.from, status, {
          load: normalizeNumber(payload.load, 0),
          latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : undefined,
          errorRate: typeof payload.errorRate === "number" ? payload.errorRate : undefined,
        });
      }

      if (message.type === "task_request") {
        const description =
          typeof payload.description === "string" && payload.description.trim()
            ? payload.description.trim()
            : `Network task from ${message.from}`;
        const task = getTaskStore(deps.memory.db).createTask({
          description,
          createdBy: `network:${message.from}`,
          payload: JSON.stringify(payload.payload ?? {}),
          reason: `Remote network task ${message.correlationId}`,
        });
        return c.json(
          {
            success: true,
            data: {
              accepted: true,
              message: record,
              taskId: task.id,
            },
          } as APIResponse,
          202
        );
      }

      if (message.type === "capability_query") {
        return c.json({
          success: true,
          data: {
            agentId: localAgentId(deps),
            name: localAgentName(deps),
            endpoint: deps.networkConfig?.endpoint ?? null,
            capabilities: localCapabilities(deps),
            status: deps.lifecycle?.getState?.() === "running" ? "available" : "degraded",
          },
        } as APIResponse);
      }

      return c.json({ success: true, data: { accepted: true, message: record } } as APIResponse);
    } catch (error) {
      const status = error instanceof NetworkMessageReplayError ? 409 : 400;
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, status);
    }
  });

  return app;
}
