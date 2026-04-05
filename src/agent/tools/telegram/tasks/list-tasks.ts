import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_list_tasks tool
 */
interface ListTasksParams {
  status?: "pending" | "in_progress" | "done" | "failed" | "cancelled";
}

/**
 * Tool definition for listing scheduled tasks
 */
export const telegramListTasksTool: Tool = {
  name: "telegram_list_tasks",
  description:
    "List all scheduled tasks, optionally filtered by status. Returns task IDs, descriptions, statuses, schedules, and dependencies.",
  parameters: Type.Object({
    status: Type.Optional(
      Type.String({
        description:
          "Filter by task status. One of: 'pending', 'in_progress', 'done', 'failed', 'cancelled'. Omit to list all tasks.",
        enum: ["pending", "in_progress", "done", "failed", "cancelled"],
      })
    ),
  }),
};

/**
 * Executor for telegram_list_tasks tool
 */
export const telegramListTasksExecutor: ToolExecutor<ListTasksParams> = async (
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

    const filter = params.status ? { status: params.status } : undefined;
    const tasks = taskStore.listTasks(filter);

    const enriched = tasks.map((t) => ({
      id: t.id,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      scheduledFor: t.scheduledFor?.toISOString() ?? null,
      payload: t.payload ?? null,
      reason: t.reason ?? null,
      repeatIntervalSeconds: t.repeatIntervalSeconds ?? null,
      dependencies: taskStore.getDependencies(t.id),
      dependents: taskStore.getDependents(t.id),
    }));

    return {
      success: true,
      data: {
        tasks: enriched,
        count: enriched.length,
        filter: params.status ?? "all",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error listing tasks");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
