import {
  telegramCreateScheduledTaskTool,
  telegramCreateScheduledTaskExecutor,
} from "./create-scheduled-task.js";
import { telegramListTasksTool, telegramListTasksExecutor } from "./list-tasks.js";
import { telegramGetTaskTool, telegramGetTaskExecutor } from "./get-task.js";
import { telegramCancelTaskTool, telegramCancelTaskExecutor } from "./cancel-task.js";
import { telegramUpdateTaskTool, telegramUpdateTaskExecutor } from "./update-task.js";
import type { ToolEntry } from "../../types.js";

export { telegramCreateScheduledTaskTool, telegramCreateScheduledTaskExecutor };
export { telegramListTasksTool, telegramListTasksExecutor };
export { telegramGetTaskTool, telegramGetTaskExecutor };
export { telegramCancelTaskTool, telegramCancelTaskExecutor };
export { telegramUpdateTaskTool, telegramUpdateTaskExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramCreateScheduledTaskTool, executor: telegramCreateScheduledTaskExecutor },
  { tool: telegramListTasksTool, executor: telegramListTasksExecutor },
  { tool: telegramGetTaskTool, executor: telegramGetTaskExecutor },
  { tool: telegramCancelTaskTool, executor: telegramCancelTaskExecutor },
  { tool: telegramUpdateTaskTool, executor: telegramUpdateTaskExecutor },
];
