import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_update_task tool
 */
interface UpdateTaskParams {
  taskId: string;
  description?: string;
  payload?: string;
  reason?: string;
  priority?: number;
  rescheduleDate?: string;
  recurrenceInterval?: number | null;
  recurrenceUntil?: string | null;
}

/**
 * Tool definition for updating a scheduled task
 */
export const telegramUpdateTaskTool: Tool = {
  name: "telegram_update_task",
  description:
    "Update a pending scheduled task. Can modify description, payload, reason, priority, recurrence interval, or reschedule to a new time. Only pending tasks can be updated.",
  parameters: Type.Object({
    taskId: Type.String({
      description: "The task ID to update (UUID format)",
    }),
    description: Type.Optional(
      Type.String({
        description: "New task description",
      })
    ),
    payload: Type.Optional(
      Type.String({
        description: `New JSON payload for task execution. Same format as telegram_create_scheduled_task:
1. Tool call: {"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}
2. Agent task: {"type":"agent_task","instructions":"Do something","context":{}}
Set to empty string "" to convert to a simple reminder with no automatic execution.`,
      })
    ),
    reason: Type.Optional(
      Type.String({
        description: "New reason for the task",
      })
    ),
    priority: Type.Optional(
      Type.Number({
        description: "New task priority (0-10)",
        minimum: 0,
        maximum: 10,
      })
    ),
    rescheduleDate: Type.Optional(
      Type.String({
        description:
          "New execution time (ISO 8601 format or Unix timestamp). Must be in the future. This cancels the old Telegram scheduled message and creates a new one.",
      })
    ),
    recurrenceInterval: Type.Optional(
      Type.Union(
        [
          Type.Number({
            description: "New recurrence interval in seconds (minimum 60)",
            minimum: 60,
          }),
          Type.Null(),
        ],
        {
          description:
            "New recurrence interval in seconds (minimum 60), or null to remove recurring behaviour.",
        }
      )
    ),
    recurrenceUntil: Type.Optional(
      Type.Union(
        [
          Type.String({
            description: "New stop date for recurrence (ISO 8601 or Unix timestamp)",
          }),
          Type.Null(),
        ],
        {
          description: "When to stop recurring, or null to recur indefinitely.",
        }
      )
    ),
  }),
};

/**
 * Executor for telegram_update_task tool
 */
export const telegramUpdateTaskExecutor: ToolExecutor<UpdateTaskParams> = async (
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

    // Only pending tasks can be updated
    if (task.status !== "pending") {
      return {
        success: false,
        error: `Cannot update task with status "${task.status}" — only pending tasks can be updated`,
      };
    }

    // Validate payload if provided
    if (params.payload !== undefined && params.payload !== "") {
      try {
        const parsed = JSON.parse(params.payload);
        if (!parsed.type || !["tool_call", "agent_task"].includes(parsed.type)) {
          return {
            success: false,
            error: 'Payload must have type "tool_call" or "agent_task"',
          };
        }
        if (parsed.type === "tool_call") {
          if (!parsed.tool || typeof parsed.tool !== "string") {
            return {
              success: false,
              error: 'tool_call payload requires "tool" field (string)',
            };
          }
        }
        if (parsed.type === "agent_task") {
          if (!parsed.instructions || typeof parsed.instructions !== "string") {
            return {
              success: false,
              error: 'agent_task payload requires "instructions" field (string)',
            };
          }
          if (parsed.instructions.length < 5) {
            return {
              success: false,
              error: "Instructions too short (min 5 characters)",
            };
          }
        }
      } catch {
        return {
          success: false,
          error: "Invalid JSON payload",
        };
      }
    }

    // Validate recurrenceInterval
    if (params.recurrenceInterval !== undefined && params.recurrenceInterval !== null) {
      if (!Number.isInteger(params.recurrenceInterval) || params.recurrenceInterval < 60) {
        return {
          success: false,
          error: "recurrenceInterval must be an integer >= 60 (minimum 1 minute)",
        };
      }
    }

    // Parse recurrenceUntil if provided
    let recurrenceUntilTimestamp: number | null | undefined;
    if (params.recurrenceUntil !== undefined) {
      if (params.recurrenceUntil === null) {
        recurrenceUntilTimestamp = null;
      } else {
        const parsed = new Date(params.recurrenceUntil);
        if (!isNaN(parsed.getTime())) {
          recurrenceUntilTimestamp = Math.floor(parsed.getTime() / 1000);
        } else {
          const ts = parseInt(params.recurrenceUntil, 10);
          if (!isNaN(ts)) {
            recurrenceUntilTimestamp = ts;
          } else {
            return {
              success: false,
              error: "Invalid recurrenceUntil format",
            };
          }
        }
      }
    }

    // Parse rescheduleDate if provided
    let newScheduleTimestamp: number | undefined;
    if (params.rescheduleDate) {
      const parsedDate = new Date(params.rescheduleDate);
      if (!isNaN(parsedDate.getTime())) {
        newScheduleTimestamp = Math.floor(parsedDate.getTime() / 1000);
      } else {
        newScheduleTimestamp = parseInt(params.rescheduleDate, 10);
        if (isNaN(newScheduleTimestamp)) {
          return {
            success: false,
            error: "Invalid rescheduleDate format",
          };
        }
      }

      const now = Math.floor(Date.now() / 1000);
      if (newScheduleTimestamp <= now) {
        return {
          success: false,
          error: "rescheduleDate must be in the future",
        };
      }
    }

    // Apply DB updates (description, payload, reason, priority)
    const dbUpdates: Parameters<typeof taskStore.updateTask>[1] = {};
    if (params.description !== undefined) dbUpdates.description = params.description;
    if (params.priority !== undefined) dbUpdates.priority = params.priority;

    // For payload and reason we use the extended update path
    if (Object.keys(dbUpdates).length > 0) {
      taskStore.updateTask(params.taskId, dbUpdates);
    }

    // Update payload, reason, recurrenceInterval, recurrenceUntil, scheduledFor via direct SQL
    // (these fields are not exposed on the standard updateTask method)
    const extraFields: string[] = [];
    const extraValues: (string | number | null)[] = [];

    if (params.payload !== undefined) {
      extraFields.push("payload = ?");
      extraValues.push(params.payload === "" ? null : params.payload);
    }
    if (params.reason !== undefined) {
      extraFields.push("reason = ?");
      extraValues.push(params.reason);
    }
    if (params.recurrenceInterval !== undefined) {
      extraFields.push("recurrence_interval = ?");
      extraValues.push(params.recurrenceInterval);
    }
    if (recurrenceUntilTimestamp !== undefined) {
      extraFields.push("recurrence_until = ?");
      extraValues.push(recurrenceUntilTimestamp);
    }
    if (newScheduleTimestamp !== undefined) {
      extraFields.push("scheduled_for = ?");
      extraValues.push(newScheduleTimestamp);
    }

    if (extraFields.length > 0) {
      extraValues.push(params.taskId);
      context.db
        .prepare(`UPDATE tasks SET ${extraFields.join(", ")} WHERE id = ?`)
        .run(...extraValues);
    }

    // Handle Telegram scheduled message rescheduling
    let newScheduledMessageId: number | undefined;
    let oldMessageDeleted = false;

    if (newScheduleTimestamp !== undefined) {
      // Delete old Telegram scheduled message if it exists
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
          oldMessageDeleted = true;
        } catch (msgError) {
          log.warn(
            { err: msgError, taskId: params.taskId },
            "Failed to delete old Telegram scheduled message during task update"
          );
        }
      }

      // Schedule new Telegram message at the new time
      try {
        const gramJsClient = context.bridge.getClient().getClient();
        const me = await gramJsClient.getMe();
        const updatedDescription = params.description ?? task.description;
        const taskMessage = `[TASK:${params.taskId}] ${updatedDescription}`;

        const result = await gramJsClient.invoke(
          new Api.messages.SendMessage({
            peer: me,
            message: taskMessage,
            scheduleDate: newScheduleTimestamp,
            randomId: randomLong(),
          })
        );

        if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
          for (const update of result.updates) {
            if (update instanceof Api.UpdateMessageID) {
              newScheduledMessageId = update.id;
              break;
            }
          }
        }

        if (newScheduledMessageId !== undefined) {
          taskStore.updateTask(params.taskId, { scheduledMessageId: newScheduledMessageId });
        }
      } catch (msgError) {
        log.warn(
          { err: msgError, taskId: params.taskId },
          "Failed to schedule new Telegram message during task update"
        );
      }
    }

    const updatedTask = taskStore.getTask(params.taskId);
    return {
      success: true,
      data: {
        taskId: params.taskId,
        description: updatedTask?.description ?? task.description,
        scheduledFor:
          updatedTask?.scheduledFor?.toISOString() ?? task.scheduledFor?.toISOString() ?? null,
        recurrenceInterval: updatedTask?.recurrenceInterval ?? null,
        recurrenceUntil: updatedTask?.recurrenceUntil?.toISOString() ?? null,
        scheduledMessageId: updatedTask?.scheduledMessageId ?? null,
        oldScheduledMessageDeleted: oldMessageDeleted,
        message: `Task "${updatedTask?.description ?? task.description}" updated successfully`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error updating task");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
