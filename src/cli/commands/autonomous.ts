import { getDatabase } from "../../memory/index.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { join } from "path";

function printTask(task: {
  id: string;
  goal: string;
  status: string;
  priority: string;
  currentStep: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}): void {
  console.log(`  ID:       ${task.id}`);
  console.log(`  Goal:     ${task.goal}`);
  console.log(`  Status:   ${task.status}`);
  console.log(`  Priority: ${task.priority}`);
  console.log(`  Step:     ${task.currentStep}`);
  console.log(`  Created:  ${task.createdAt.toISOString()}`);
  if (task.startedAt) console.log(`  Started:  ${task.startedAt.toISOString()}`);
  if (task.completedAt) console.log(`  Done:     ${task.completedAt.toISOString()}`);
  console.log();
}

export async function autonomousCommand(
  action: string,
  options: {
    config?: string;
    task?: string;
    priority?: string;
    strategy?: string;
    maxIterations?: string;
    maxHours?: string;
    successCriteria?: string[];
    force?: boolean;
    id?: string;
    limit?: string;
  }
): Promise<void> {
  const openDb = () => {
    return getDatabase({
      path: join(TELETON_ROOT, "memory.db"),
      enableVectorSearch: false,
    }).getDb();
  };

  switch (action) {
    case "enable":
    case "start": {
      if (!options.task) {
        console.error('Usage: teleton autonomous enable --task="<goal>" [options]');
        console.error("Options:");
        console.error("  --priority <low|medium|high|critical>  Task priority (default: medium)");
        console.error("  --strategy <conservative|balanced|aggressive>  Execution strategy");
        console.error("  --max-iterations <n>   Maximum loop iterations");
        console.error("  --max-hours <n>         Maximum execution duration in hours");
        console.error("  --success-criteria <c>  Criteria (repeatable)");
        process.exit(1);
      }

      const db = await openDb();
      const store = getAutonomousTaskStore(db);

      const constraints: Record<string, number> = {};
      if (options.maxIterations) constraints.maxIterations = parseInt(options.maxIterations, 10);
      if (options.maxHours) constraints.maxDurationHours = parseFloat(options.maxHours);

      const task = store.createTask({
        goal: options.task,
        successCriteria: options.successCriteria ?? [],
        constraints,
        strategy: (options.strategy as "conservative" | "balanced" | "aggressive") ?? "balanced",
        priority: (options.priority as "low" | "medium" | "high" | "critical") ?? "medium",
      });

      console.log("Autonomous task created:");
      console.log(`  ID: ${task.id}`);
      console.log(`  Goal: ${task.goal}`);
      console.log(`  Status: ${task.status}`);
      console.log();
      console.log("Note: The task will run when the agent is started with autonomous mode support.");
      console.log(`      Monitor progress: teleton autonomous status --id ${task.id}`);
      break;
    }

    case "disable":
    case "stop": {
      const db = await openDb();
      const store = getAutonomousTaskStore(db);

      if (options.id) {
        const task = store.getTask(options.id);
        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
        }
        store.updateTaskStatus(options.id, "cancelled");
        console.log(`Task ${options.id} cancelled.`);
      } else if (options.force) {
        const active = store.getActiveTasks();
        for (const t of active) {
          store.updateTaskStatus(t.id, "cancelled");
        }
        console.log(`Cancelled ${active.length} active task(s).`);
      } else {
        console.error("Specify --id <taskId> or use --force to stop all active tasks.");
        process.exit(1);
      }
      break;
    }

    case "pause": {
      if (!options.id) {
        console.error("Usage: teleton autonomous pause --id <taskId>");
        process.exit(1);
      }
      const db = await openDb();
      const store = getAutonomousTaskStore(db);
      const task = store.updateTaskStatus(options.id, "paused");
      if (!task) {
        console.error(`Task not found: ${options.id}`);
        process.exit(1);
      }
      console.log(`Task ${options.id} paused.`);
      break;
    }

    case "resume": {
      if (!options.id) {
        console.error("Usage: teleton autonomous resume --id <taskId>");
        process.exit(1);
      }
      const db = await openDb();
      const store = getAutonomousTaskStore(db);
      const task = store.getTask(options.id);
      if (!task) {
        console.error(`Task not found: ${options.id}`);
        process.exit(1);
      }
      if (task.status !== "paused") {
        console.error(`Task is not paused (status: ${task.status})`);
        process.exit(1);
      }
      store.updateTaskStatus(options.id, "pending");
      console.log(`Task ${options.id} queued for resumption.`);
      break;
    }

    case "status": {
      const db = await openDb();
      const store = getAutonomousTaskStore(db);

      if (options.id) {
        const task = store.getTask(options.id);
        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
        }
        console.log("Autonomous task:");
        printTask(task);

        const logs = store.getExecutionLogs(options.id, 20);
        if (logs.length > 0) {
          console.log("Recent execution log:");
          for (const entry of logs) {
            const ts = entry.createdAt.toISOString();
            console.log(`  [${ts}] [${entry.eventType.padEnd(12)}] ${entry.message}`);
          }
        }
      } else {
        const tasks = store.getActiveTasks();
        if (tasks.length === 0) {
          console.log("No active autonomous tasks.");
        } else {
          console.log(`Active autonomous tasks (${tasks.length}):`);
          for (const t of tasks) printTask(t);
        }
      }
      break;
    }

    case "list": {
      const db = await openDb();
      const store = getAutonomousTaskStore(db);
      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      const tasks = store.listTasks();

      if (tasks.length === 0) {
        console.log("No autonomous tasks found.");
        break;
      }

      const display = tasks.slice(0, limit);
      console.log(`Autonomous tasks (showing ${display.length} of ${tasks.length}):`);
      for (const t of display) {
        const statusIcon =
          t.status === "completed"
            ? "✓"
            : t.status === "failed"
              ? "✗"
              : t.status === "running"
                ? "▶"
                : t.status === "paused"
                  ? "⏸"
                  : "·";
        console.log(`  ${statusIcon} [${t.status.padEnd(9)}] ${t.id.slice(0, 8)}… ${t.goal}`);
      }
      break;
    }

    case "clean": {
      const db = await openDb();
      const store = getAutonomousTaskStore(db);
      const deleted = store.cleanOldCheckpoints();
      console.log(`Cleaned ${deleted} old checkpoint(s).`);
      break;
    }

    default:
      console.error(`Unknown action: ${action}`);
      console.error("Available actions: enable, disable, pause, resume, status, list, clean");
      process.exit(1);
  }
}
