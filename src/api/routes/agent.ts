import { Hono } from "hono";
import type { AgentLifecycle } from "../../agent/lifecycle.js";
import { createProblemResponse } from "../schemas/common.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ManagementAPI");

let restartInFlight = false;

export function createAgentRoutes(lifecycle: AgentLifecycle | null | undefined) {
  const app = new Hono();

  app.post("/restart", async (c) => {
    if (!lifecycle) {
      return createProblemResponse(c, 503, "Service Unavailable", "Agent lifecycle not available");
    }

    const state = lifecycle.getState();
    if (state === "starting" || state === "stopping") {
      return createProblemResponse(c, 409, "Conflict", `Agent is currently ${state}, please wait`);
    }

    if (restartInFlight) {
      return createProblemResponse(c, 409, "Conflict", "A restart is already in progress");
    }

    restartInFlight = true;

    // Fire-and-forget restart: stop then start
    (async () => {
      try {
        if (lifecycle.getState() === "running") {
          await lifecycle.stop();
        }
        await lifecycle.start();
        log.info("Agent restarted via Management API");
      } catch (err) {
        log.error({ err }, "Agent restart failed");
      } finally {
        restartInFlight = false;
      }
    })().catch(() => {});

    return c.json({ state: "restarting" });
  });

  return app;
}
