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
  {
    tool: telegramCreateScheduledTaskTool,
    executor: telegramCreateScheduledTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramListTasksTool,
    executor: telegramListTasksExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramGetTaskTool,
    executor: telegramGetTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramCancelTaskTool,
    executor: telegramCancelTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramUpdateTaskTool,
    executor: telegramUpdateTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
];
