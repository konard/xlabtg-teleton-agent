import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { MAX_DEPENDENTS_PER_TASK } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parse a human-readable recurrence string into an interval in seconds.
 *
 * Accepts:
 *  - Plain seconds as a number string: "2700"
 *  - "every N seconds/minutes/hours/days/weeks"
 *  - Shorthands: "minutely", "hourly", "daily", "weekly"
 *
 * Returns the interval in seconds, or null if unparseable.
 */
export function parseRecurrenceInterval(recurrence: string): number | null {
  const s = recurrence.trim().toLowerCase();

  // Plain integer (seconds)
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : null;
  }

  // Shorthands
  const shorthands: Record<string, number> = {
    minutely: 60,
    hourly: 3600,
    daily: 86400,
    weekly: 604800,
  };
  if (shorthands[s] !== undefined) return shorthands[s];

  // "every N unit"
  const match = s.match(/^every\s+(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week)s?$/);
  if (match) {
    const n = parseFloat(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      second: 1,
      minute: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
    };
    const seconds = Math.round(n * multipliers[unit]);
    return seconds > 0 ? seconds : null;
  }

  return null;
}

/**
 * Parameters for telegram_create_scheduled_task tool
 */
interface CreateScheduledTaskParams {
  description: string;
  scheduleDate?: string;
  payload?: string;
  reason?: string;
  priority?: number;
  dependsOn?: string[];
  recurrence?: string;
  recurrenceUntil?: string;
}

/**
 * Tool definition for creating scheduled tasks
 *
 * Examples:
 *
 * 1. Simple tool call (auto-executed):
 *    {
 *      description: "Check TON price",
 *      scheduleDate: "2024-12-25T10:00:00Z",
 *      payload: '{"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}',
 *      reason: "Monitor for trading opportunity"
 *    }
 *
 * 2. Complex agent task (multi-step):
 *    {
 *      description: "Trade if conditions met",
 *      scheduleDate: "2024-12-25T15:00:00Z",
 *      payload: '{"type":"agent_task","instructions":"1. Check TON price\\n2. If > $5, swap 50 TON to USDT","context":{"maxAmount":50}}',
 *      reason: "Automated trading strategy"
 *    }
 *
 * 3. Simple reminder (no payload):
 *    {
 *      description: "Review trading performance this week",
 *      scheduleDate: "2024-12-31T18:00:00Z",
 *      reason: "Weekly review"
 *    }
 */
export const telegramCreateScheduledTaskTool: Tool = {
  name: "telegram_create_scheduled_task",
  description:
    "Schedule a task for future automatic execution — use this to automate function calls, trading operations, or multi-step workflows at a specific time. Stores in DB and schedules a reminder in Saved Messages. Unlike telegram_schedule_message (text-only), this tool actually executes other tools and agent instructions automatically. Supports tool_call (auto-execute a single tool), agent_task (multi-step instructions executed by the agent), or simple reminders. Tasks can depend on other tasks, forming automated pipelines. Supports recurring execution via repeatIntervalSeconds.",
  parameters: Type.Object({
    description: Type.String({
      description:
        "What the task is about (e.g., 'Run trade simulation and send results report at 19:15')",
    }),
    scheduleDate: Type.Optional(
      Type.String({
        description:
          "When to execute the task (ISO 8601 format, e.g., '2024-12-25T10:00:00Z' or Unix timestamp). Optional if dependsOn is provided - task will execute when dependencies complete.",
      })
    ),
    payload: Type.Optional(
      Type.String({
        description: `JSON payload defining what to execute automatically. Two types:

1. Simple tool call (auto-executed, result fed to you):
   {"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}

2. Complex agent task — multi-step instructions the agent executes (e.g., trading automation):
   {"type":"agent_task","instructions":"1. Run trade simulation\\n2. Check journal for results\\n3. Send report via telegram_send_message","context":{"chatId":"123"}}

3. Skip on parent failure (continues even if parent fails):
   {"type":"agent_task","instructions":"Send daily report","skipOnParentFailure":false}

If omitted, task is a simple reminder.`,
      })
    ),
    reason: Type.Optional(
      Type.String({
        description: "Why you're scheduling this task (helps with context when executing)",
      })
    ),
    priority: Type.Optional(
      Type.Number({
        description: "Task priority (0-10, higher = more important)",
        minimum: 0,
        maximum: 10,
      })
    ),
    dependsOn: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Array of parent task IDs that must complete before this task executes. When dependencies are provided, task executes automatically when all parents are done (scheduleDate is ignored).",
      })
    ),
    recurrence: Type.Optional(
      Type.String({
        description: `How often to repeat this task after each execution. Examples:
- "every 45 minutes" — run every 45 minutes
- "every 6 hours" — run every 6 hours
- "daily" — run once per day
- "weekly" — run once per week
- "hourly" — run once per hour
- "2700" — run every 2700 seconds (45 minutes)

When set, the task is automatically rescheduled after each completion until recurrenceUntil (if given).`,
      })
    ),
    recurrenceUntil: Type.Optional(
      Type.String({
        description:
          "When to stop recurring. ISO 8601 date (e.g., '2025-12-31T23:59:59Z') or Unix timestamp. If omitted, the task recurs indefinitely.",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_scheduled_task tool
 */
export const telegramCreateScheduledTaskExecutor: ToolExecutor<CreateScheduledTaskParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      description,
      scheduleDate,
      payload,
      reason,
      priority,
      dependsOn,
      recurrence,
      recurrenceUntil,
    } = params;

    // Validate: either scheduleDate OR dependsOn must be provided
    if (!scheduleDate && (!dependsOn || dependsOn.length === 0)) {
      return {
        success: false,
        error: "Either scheduleDate or dependsOn must be provided",
      };
    }

    // Parse recurrence interval if provided
    let recurrenceIntervalSeconds: number | undefined;
    if (recurrence) {
      const parsed = parseRecurrenceInterval(recurrence);
      if (parsed === null) {
        return {
          success: false,
          error: `Invalid recurrence format: "${recurrence}". Use formats like "every 45 minutes", "hourly", "daily", "weekly", or a plain number of seconds.`,
        };
      }
      recurrenceIntervalSeconds = parsed;
    }

    // Parse recurrenceUntil if provided
    let recurrenceUntilDate: Date | undefined;
    if (recurrenceUntil) {
      const parsed = new Date(recurrenceUntil);
      if (!isNaN(parsed.getTime())) {
        recurrenceUntilDate = parsed;
      } else {
        const ts = parseInt(recurrenceUntil, 10);
        if (!isNaN(ts)) {
          recurrenceUntilDate = new Date(ts * 1000);
        } else {
          return {
            success: false,
            error: "Invalid recurrenceUntil format",
          };
        }
      }
    }

    // Parse schedule date if provided
    let scheduleTimestamp: number | undefined;
    if (scheduleDate) {
      const parsedDate = new Date(scheduleDate);
      if (!isNaN(parsedDate.getTime())) {
        scheduleTimestamp = Math.floor(parsedDate.getTime() / 1000);
      } else {
        scheduleTimestamp = parseInt(scheduleDate, 10);
        if (isNaN(scheduleTimestamp)) {
          return {
            success: false,
            error: "Invalid scheduleDate format",
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
    }

    // Validate payload if provided
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        if (!parsed.type || !["tool_call", "agent_task"].includes(parsed.type)) {
          return {
            success: false,
            error: 'Payload must have type "tool_call" or "agent_task"',
          };
        }

        // Validate tool_call payload
        if (parsed.type === "tool_call") {
          if (!parsed.tool || typeof parsed.tool !== "string") {
            return {
              success: false,
              error: 'tool_call payload requires "tool" field (string)',
            };
          }
          if (parsed.params !== undefined && typeof parsed.params !== "object") {
            return {
              success: false,
              error: 'tool_call payload "params" must be an object',
            };
          }
          // Note: Tool existence is validated at execution time by the executor.
          // We can't easily validate here as tool registry isn't in ToolContext.
        }

        // Validate agent_task payload
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
          if (parsed.context !== undefined && typeof parsed.context !== "object") {
            return {
              success: false,
              error: 'agent_task payload "context" must be an object',
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

    // 1. Create task in TaskStore
    if (!context.db) {
      return {
        success: false,
        error: "Database not available",
      };
    }

    const { getTaskStore } = await import("../../../../memory/agent/tasks.js");
    const taskStore = getTaskStore(context.db);

    // Security: Validate that adding this task won't exceed dependent limit for any parent
    if (dependsOn && dependsOn.length > 0) {
      for (const parentId of dependsOn) {
        const existingDependents = taskStore.getDependents(parentId);
        if (existingDependents.length >= MAX_DEPENDENTS_PER_TASK) {
          return {
            success: false,
            error: `Parent task ${parentId} already has ${existingDependents.length} dependents (max: ${MAX_DEPENDENTS_PER_TASK})`,
          };
        }
      }
    }

    const task = taskStore.createTask({
      description,
      priority: priority ?? 0,
      createdBy: "agent",
      scheduledFor: scheduleTimestamp ? new Date(scheduleTimestamp * 1000) : undefined,
      payload,
      reason,
      dependsOn,
      recurrenceInterval: recurrenceIntervalSeconds,
      recurrenceUntil: recurrenceUntilDate,
    });

    // 2. Schedule Telegram message with [TASK:uuid] format (only if not dependent on other tasks)
    let scheduledMessageId: number | undefined;

    if (dependsOn && dependsOn.length > 0) {
      // Task has dependencies - will be triggered by parent completion
      return {
        success: true,
        data: {
          taskId: task.id,
          dependsOn,
          recurrenceInterval: recurrenceIntervalSeconds,
          recurrenceUntil: recurrenceUntilDate?.toISOString(),
          message: `Task created: "${description}" (will execute when ${dependsOn.length} parent task(s) complete)`,
        },
      };
    } else if (scheduleTimestamp) {
      // Task has schedule date - schedule Telegram message
      const gramJsClient = context.bridge.getClient().getClient();

      // Get "me" entity for Saved Messages
      const me = await gramJsClient.getMe();

      const taskMessage = `[TASK:${task.id}] ${description}`;

      const result = await gramJsClient.invoke(
        new Api.messages.SendMessage({
          peer: me,
          message: taskMessage,
          scheduleDate: scheduleTimestamp,
          randomId: randomLong(),
        })
      );

      // Extract scheduled message ID
      if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
        for (const update of result.updates) {
          if (update instanceof Api.UpdateMessageID) {
            scheduledMessageId = update.id;
            break;
          }
        }
      }

      // Persist the scheduled message ID back to the task record
      if (scheduledMessageId !== undefined) {
        taskStore.updateTask(task.id, { scheduledMessageId });
      }

      const recurrenceMsg = recurrenceIntervalSeconds
        ? `, repeating ${recurrence}${recurrenceUntilDate ? ` until ${recurrenceUntilDate.toISOString()}` : " indefinitely"}`
        : "";

      return {
        success: true,
        data: {
          taskId: task.id,
          scheduledFor: new Date(scheduleTimestamp * 1000).toISOString(),
          scheduledMessageId,
          recurrenceInterval: recurrenceIntervalSeconds,
          recurrenceUntil: recurrenceUntilDate?.toISOString(),
          message: `Task scheduled: "${description}" at ${new Date(scheduleTimestamp * 1000).toLocaleString()}${recurrenceMsg}`,
        },
      };
    }

    // Should never reach here due to validation above
    return {
      success: false,
      error: "Invalid state: no scheduleDate or dependsOn",
    };
  } catch (error) {
    log.error({ err: error }, "Error creating scheduled task");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
