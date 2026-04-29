import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_schedule_message tool
 */
interface ScheduleMessageParams {
  chatId: string;
  text: string;
  scheduleDate: string; // ISO 8601 string
}

/**
 * Deprecation warning shown to the LLM and logged at runtime.
 * Kept as a constant so tests can assert on the same string.
 */
export const TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE =
  "telegram_schedule_message is DEPRECATED and will be removed in a future release. " +
  "It only queues plain text — it cannot execute tools, trading functions, or multi-step workflows. " +
  "Use telegram_create_scheduled_task instead (with a tool_call or agent_task payload) for any automation that must run at a scheduled time.";

/**
 * Tool definition for scheduling Telegram messages
 *
 * @deprecated Use telegram_create_scheduled_task instead. This tool only queues
 * plain text and cannot trigger tool calls or agent actions when the message
 * is delivered. See issue #459.
 */
export const telegramScheduleMessageTool: Tool = {
  name: "telegram_schedule_message",
  description:
    "[DEPRECATED — use telegram_create_scheduled_task instead] Queue a plain text message for delayed delivery at a specific date/time. Sends ONLY text — does NOT execute any functions, tools, or agent instructions, even if the message text reads like a command (e.g., 'Check TON price', 'Buy USDT'). Pass scheduleDate as ISO 8601 string or Unix timestamp (must be in the future). For ANY automation that must run at a scheduled time — trading functions, tool calls, multi-step workflows, recurring tasks — use telegram_create_scheduled_task with a tool_call or agent_task payload. Manage pending messages with telegram_get_scheduled_messages.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the scheduled message to",
    }),
    text: Type.String({
      description: "The message text to send (max 4096 characters)",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
    scheduleDate: Type.String({
      description:
        "When to send the message (ISO 8601 format, e.g., '2024-12-25T10:00:00Z' or Unix timestamp as string)",
    }),
  }),
};

/**
 * Executor for telegram_schedule_message tool
 */
export const telegramScheduleMessageExecutor: ToolExecutor<ScheduleMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  log.warn(
    { tool: "telegram_schedule_message", replacement: "telegram_create_scheduled_task" },
    TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE
  );

  try {
    const { chatId, text, scheduleDate } = params;

    // Parse schedule date to Unix timestamp
    let scheduleTimestamp: number;

    // Try to parse as ISO 8601 date
    const parsedDate = new Date(scheduleDate);
    if (!isNaN(parsedDate.getTime())) {
      scheduleTimestamp = Math.floor(parsedDate.getTime() / 1000);
    } else {
      // Try as Unix timestamp
      scheduleTimestamp = parseInt(scheduleDate, 10);
      if (isNaN(scheduleTimestamp)) {
        return {
          success: false,
          error:
            "Invalid scheduleDate format. Use ISO 8601 (e.g., '2024-12-25T10:00:00Z') or Unix timestamp.",
        };
      }
    }

    // Validate future date
    const now = Math.floor(Date.now() / 1000);
    if (scheduleTimestamp <= now) {
      return {
        success: false,
        error: "Schedule date must be in the future",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get chat entity
    const entity = await gramJsClient.getEntity(chatId);

    // Send scheduled message using GramJS
    const result = await gramJsClient.invoke(
      new Api.messages.SendMessage({
        peer: entity,
        message: text,
        scheduleDate: scheduleTimestamp,
        randomId: randomLong(),
      })
    );

    const messageId =
      result instanceof Api.Updates && result.updates.length > 0
        ? ((
            result.updates.find(
              (u): u is Api.UpdateNewMessage => u.className === "UpdateNewMessage"
            ) as Api.UpdateNewMessage | undefined
          )?.message?.id ?? null)
        : null;
    return {
      success: true,
      data: {
        chatId,
        scheduledFor: new Date(scheduleTimestamp * 1000).toISOString(),
        messageId,
        deprecated: true,
        deprecationNotice: TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error scheduling Telegram message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
