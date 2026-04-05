import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_get_task tool
 */
interface GetTaskParams {
  taskId: string;
}

/**
 * Tool definition for getting a single scheduled task
 */
export const telegramGetTaskTool: Tool = {
  name: "telegram_get_task",
  description:
    "Get details of a specific scheduled task by ID. Returns full task info including status, payload, result, error, and dependencies.",
  parameters: Type.Object({
    taskId: Type.String({
      description: "The task ID to retrieve (UUID format)",
    }),
  }),
};

/**
 * Executor for telegram_get_task tool
 */
export const telegramGetTaskExecutor: ToolExecutor<GetTaskParams> = async (
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

    const enriched = {
      id: task.id,
      description: task.description,
      status: task.status,
      priority: task.priority,
      createdBy: task.createdBy,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      scheduledFor: task.scheduledFor?.toISOString() ?? null,
      payload: task.payload ?? null,
      reason: task.reason ?? null,
      result: task.result ?? null,
      error: task.error ?? null,
      scheduledMessageId: task.scheduledMessageId ?? null,
      recurrenceInterval: task.recurrenceInterval ?? null,
      recurrenceUntil: task.recurrenceUntil?.toISOString() ?? null,
      dependencies: taskStore.getDependencies(task.id),
      dependents: taskStore.getDependents(task.id),
      parentResults: taskStore.getParentResults(task.id),
    };

    return {
      success: true,
      data: enriched,
    };
  } catch (error) {
    log.error({ err: error }, "Error getting task");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
