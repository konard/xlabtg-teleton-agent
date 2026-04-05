import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_cancel_task tool
 */
interface CancelTaskParams {
  taskId: string;
  reason?: string;
}

/**
 * Tool definition for cancelling a scheduled task
 */
export const telegramCancelTaskTool: Tool = {
  name: "telegram_cancel_task",
  description:
    "Cancel a pending or in-progress scheduled task. Also removes the associated Telegram scheduled message if one exists. Cannot cancel tasks that are already done, failed, or cancelled.",
  parameters: Type.Object({
    taskId: Type.String({
      description: "The task ID to cancel (UUID format)",
    }),
    reason: Type.Optional(
      Type.String({
        description: "Optional reason for cancellation (for logging purposes)",
      })
    ),
  }),
};

/**
 * Executor for telegram_cancel_task tool
 */
export const telegramCancelTaskExecutor: ToolExecutor<CancelTaskParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    if (!context.db) {
      return {
        success: false,
        error: "Database not available",
      };
    }

    const { getTaskStore } = await import("../../../../memory/agent/tasks.js");
    const taskStore = getTaskStore(context.db);

    const task = taskStore.getTask(params.taskId);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${params.taskId}`,
      };
    }

    const terminalStatuses = ["done", "failed", "cancelled"];
    if (terminalStatuses.includes(task.status)) {
      return {
        success: false,
        error: `Cannot cancel task with status "${task.status}"`,
      };
    }

    // Cancel the task in DB
    const cancelled = taskStore.cancelTask(params.taskId);
    if (!cancelled) {
      return {
        success: false,
        error: "Failed to cancel task",
      };
    }

    // If there's an associated Telegram scheduled message, delete it
    let scheduledMessageDeleted = false;
    if (task.scheduledMessageId) {
      try {
        const gramJsClient = context.bridge.getClient().getClient();
        const me = await gramJsClient.getMe();

        await gramJsClient.invoke(
          new Api.messages.DeleteScheduledMessages({
            peer: me,
            id: [task.scheduledMessageId],
          })
        );
        scheduledMessageDeleted = true;
      } catch (msgError) {
        // Log but don't fail the cancel operation — task is already cancelled in DB
        log.warn(
          { err: msgError, taskId: params.taskId },
          "Failed to delete scheduled Telegram message during task cancellation"
        );
      }
    }

    return {
      success: true,
      data: {
        taskId: params.taskId,
        status: "cancelled",
        scheduledMessageDeleted,
        reason: params.reason ?? null,
        message: `Task "${task.description}" cancelled successfully`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error cancelling task");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
