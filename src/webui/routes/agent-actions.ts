import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createAgentActionsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // Send a test message to the configured Telegram owner/admin chat
  app.post("/test/message", async (c) => {
    try {
      if (!deps.bridge) {
        const response: APIResponse = {
          success: false,
          error: "Telegram bridge not available",
        };
        return c.json(response, 503);
      }

      if (!deps.bridge.isAvailable()) {
        const response: APIResponse = {
          success: false,
          error: "Telegram client is not connected",
        };
        return c.json(response, 503);
      }

      const config = deps.agent.getConfig();
      const ownerId = config.telegram.owner_id;
      const adminIds = config.telegram.admin_ids ?? [];

      // Determine target: prefer owner_id, fall back to first admin
      const targetId = ownerId ?? adminIds[0];
      if (!targetId) {
        const response: APIResponse = {
          success: false,
          error: "No owner_id or admin_ids configured in Telegram settings",
        };
        return c.json(response, 422);
      }

      await deps.bridge.sendMessage({
        chatId: String(targetId),
        text: "Test message from Web UI",
      });

      const response: APIResponse<{ message: string; targetId: number }> = {
        success: true,
        data: {
          message: "Test message sent successfully",
          targetId,
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
