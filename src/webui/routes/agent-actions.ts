import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { getDatabase } from "../../memory/index.js";
import { isHeartbeatOk, isSilentReply } from "../../constants/tokens.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("agent-actions");

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

  // Trigger a heartbeat tick immediately (manual "run now")
  app.post("/heartbeat/trigger", async (c) => {
    try {
      const config = deps.agent.getConfig();
      const cfg = config.heartbeat;

      if (!cfg?.enabled) {
        return c.json(
          { success: false, error: "Heartbeat is disabled. Enable it first." } as APIResponse,
          422
        );
      }

      const adminChatId = config.telegram.admin_ids[0];
      if (!adminChatId) {
        return c.json(
          { success: false, error: "No admin_ids configured in Telegram settings" } as APIResponse,
          422
        );
      }

      const sessionChatId = `telegram:direct:${adminChatId}`;
      const toolContext = {
        bridge: deps.bridge,
        db: getDatabase().getDb(),
        chatId: sessionChatId,
        isGroup: false,
        senderId: adminChatId,
        config,
      };

      const response = await deps.agent.processMessage({
        chatId: sessionChatId,
        userMessage: cfg.prompt,
        userName: "heartbeat",
        timestamp: Date.now(),
        isGroup: false,
        toolContext,
        isHeartbeat: true,
      });

      const content = response.content ?? "";
      const suppressed = isHeartbeatOk(content) || isSilentReply(content);

      let sentToTelegram = false;
      if (!suppressed && content) {
        if (deps.bridge?.isAvailable()) {
          await deps.bridge.sendMessage({
            chatId: String(adminChatId),
            text: content,
          });
          sentToTelegram = true;
        } else {
          log.warn("Heartbeat trigger: bridge not available, alert not delivered to Telegram");
        }
      }

      const result: APIResponse<{ content: string; suppressed: boolean; sentToTelegram: boolean }> =
        {
          success: true,
          data: {
            content,
            suppressed,
            sentToTelegram,
          },
        };
      return c.json(result);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  return app;
}
