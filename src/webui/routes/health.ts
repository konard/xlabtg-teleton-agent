import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { freemem, totalmem } from "node:os";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unconfigured";

export interface HealthCheck {
  status: HealthStatus;
  latency_ms?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthStatus;
  checks: {
    agent: HealthCheck;
    database: HealthCheck;
    disk: HealthCheck;
    memory: HealthCheck;
    mcp: HealthCheck;
  };
  checked_at: string;
}

function checkDatabase(deps: WebUIServerDeps): HealthCheck {
  try {
    const start = Date.now();
    const row = deps.memory.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as {
      count: number;
    };
    const latency_ms = Date.now() - start;
    return {
      status: "healthy",
      latency_ms,
      details: { session_count: row.count },
    };
  } catch (err) {
    return {
      status: "unhealthy",
      message: getErrorMessage(err),
    };
  }
}

function checkDisk(): HealthCheck {
  try {
    const freeBytes = freemem();
    const totalBytes = totalmem();
    const freeGb = freeBytes / 1024 / 1024 / 1024;
    const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
    const status: HealthStatus = freeGb < 0.5 ? "unhealthy" : freeGb < 2 ? "degraded" : "healthy";
    return {
      status,
      details: {
        free_gb: Math.round(freeGb * 100) / 100,
        used_percent: usedPercent,
      },
    };
  } catch (err) {
    return { status: "unhealthy", message: getErrorMessage(err) };
  }
}

function checkMemory(): HealthCheck {
  try {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapTotal = process.memoryUsage().heapTotal;
    const usedMb = Math.round(heapUsed / 1024 / 1024);
    const totalMb = Math.round(heapTotal / 1024 / 1024);
    const usedPercent = Math.round((heapUsed / heapTotal) * 100);
    const status: HealthStatus = usedPercent > 90 ? "degraded" : "healthy";
    return {
      status,
      details: { used_mb: usedMb, total_mb: totalMb, used_percent: usedPercent },
    };
  } catch (err) {
    return { status: "unhealthy", message: getErrorMessage(err) };
  }
}

function checkMcp(deps: WebUIServerDeps): HealthCheck {
  try {
    const servers = typeof deps.mcpServers === "function" ? deps.mcpServers() : deps.mcpServers;
    if (!servers || servers.length === 0) {
      return { status: "unconfigured" };
    }
    const connected = servers.filter((s) => s.connected).length;
    const total = servers.length;
    const status: HealthStatus =
      connected === 0 ? "unhealthy" : connected < total ? "degraded" : "healthy";
    return {
      status,
      details: { connected, total },
    };
  } catch (err) {
    return { status: "unhealthy", message: getErrorMessage(err) };
  }
}

function overallStatus(checks: HealthResponse["checks"]): HealthStatus {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes("unhealthy")) return "unhealthy";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

export function createHealthRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const agentRunning = deps.lifecycle?.getState() === "running";

      const checks: HealthResponse["checks"] = {
        agent: {
          status: agentRunning ? "healthy" : "degraded",
          details: { running: agentRunning, uptime: process.uptime() },
        },
        database: checkDatabase(deps),
        disk: checkDisk(),
        memory: checkMemory(),
        mcp: checkMcp(deps),
      };

      const response: APIResponse<HealthResponse> = {
        success: true,
        data: {
          status: overallStatus(checks),
          checks,
          checked_at: new Date().toISOString(),
        },
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
