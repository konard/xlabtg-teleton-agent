import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import type {
  AutonomousTask,
  AutonomousTaskStatus,
  TaskStrategy,
  TaskPriority,
  TaskConstraints,
} from "../../memory/agent/autonomous-tasks.js";
import { getErrorMessage } from "../../utils/errors.js";
import { parseGoalFromNaturalLanguage } from "../../autonomous/goal-parser.js";

const VALID_STATUSES: AutonomousTaskStatus[] = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

const TERMINAL_STATUSES: AutonomousTaskStatus[] = ["completed", "failed", "cancelled"];

function serializeTask(task: AutonomousTask) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

export function createAutonomousRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function store() {
    return getAutonomousTaskStore(deps.memory.db);
  }

  // List autonomous tasks (optional ?status= filter)
  app.get("/", (c) => {
    try {
      const statusParam = c.req.query("status") as AutonomousTaskStatus | undefined;
      const filter =
        statusParam && VALID_STATUSES.includes(statusParam) ? { status: statusParam } : undefined;

      const tasks = store().listTasks(filter);
      const data = tasks.map(serializeTask);

      const response: APIResponse = { success: true, data };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Get single task with logs
  app.get("/:id", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const checkpoint = task.lastCheckpointId
        ? store().getCheckpoint(task.lastCheckpointId)
        : undefined;

      const logs = store().getExecutionLogs(task.id, 100);

      const data = {
        ...serializeTask(task),
        lastCheckpoint: checkpoint
          ? {
              id: checkpoint.id,
              step: checkpoint.step,
              nextActionHint: checkpoint.nextActionHint,
              createdAt: checkpoint.createdAt.toISOString(),
            }
          : null,
        executionLogs: logs.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
      };

      const response: APIResponse = { success: true, data };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Parse a natural-language description into a structured autonomous task spec.
  // Must be registered before "/:id" routes so the static path wins.
  app.post("/parse-goal", async (c) => {
    try {
      const body = await c.req.json<{ naturalLanguage?: string }>();
      const naturalLanguage = typeof body.naturalLanguage === "string" ? body.naturalLanguage : "";

      if (!naturalLanguage.trim()) {
        return c.json({ success: false, error: "naturalLanguage is required" } as APIResponse, 400);
      }

      const agentConfig = deps.agent.getConfig().agent;
      const parsed = await parseGoalFromNaturalLanguage(naturalLanguage, agentConfig);

      return c.json({ success: true, data: parsed } as APIResponse, 200);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Create a new autonomous task
  app.post("/", async (c) => {
    try {
      const body = await c.req.json<{
        goal: string;
        successCriteria?: string[];
        failureConditions?: string[];
        constraints?: TaskConstraints;
        strategy?: TaskStrategy;
        retryPolicy?: { maxRetries: number; backoff: "linear" | "exponential" };
        context?: Record<string, unknown>;
        priority?: TaskPriority;
      }>();

      if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
        return c.json({ success: false, error: "goal is required" } as APIResponse, 400);
      }

      const task = store().createTask({
        goal: body.goal.trim(),
        successCriteria: body.successCriteria,
        failureConditions: body.failureConditions,
        constraints: body.constraints,
        strategy: body.strategy,
        retryPolicy: body.retryPolicy,
        context: body.context,
        priority: body.priority,
      });

      const response: APIResponse = { success: true, data: serializeTask(task) };
      return c.json(response, 201);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Pause a task
  app.post("/:id/pause", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }
      if (task.status !== "running" && task.status !== "pending") {
        return c.json(
          {
            success: false,
            error: `Cannot pause task with status "${task.status}"`,
          } as APIResponse,
          409
        );
      }
      const updated = store().updateTaskStatus(task.id, "paused");
      const response: APIResponse = {
        success: true,
        data: updated ? serializeTask(updated) : null,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Resume a paused task
  app.post("/:id/resume", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }
      if (task.status !== "paused") {
        return c.json(
          { success: false, error: `Task is not paused (status: "${task.status}")` } as APIResponse,
          409
        );
      }
      const updated = store().updateTaskStatus(task.id, "pending");
      const response: APIResponse = {
        success: true,
        data: updated ? serializeTask(updated) : null,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Stop (cancel) a task
  app.post("/:id/stop", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }
      if (TERMINAL_STATUSES.includes(task.status)) {
        return c.json(
          {
            success: false,
            error: `Task already in terminal state "${task.status}"`,
          } as APIResponse,
          409
        );
      }
      const updated = store().updateTaskStatus(task.id, "cancelled");
      const response: APIResponse = {
        success: true,
        data: updated ? serializeTask(updated) : null,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Inject context into a running task
  app.post("/:id/context", async (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const body = await c.req.json<{ context: Record<string, unknown> }>();
      if (!body.context || typeof body.context !== "object") {
        return c.json({ success: false, error: "context object required" } as APIResponse, 400);
      }

      const merged = { ...task.context, ...body.context };
      store().updateContext(task.id, merged);
      store().appendLog({
        taskId: task.id,
        step: task.currentStep,
        eventType: "info",
        message: "Context injected by user",
        data: body.context,
      });

      const updated = store().getTask(task.id);
      const response: APIResponse = {
        success: true,
        data: updated ? serializeTask(updated) : null,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Get execution logs for a task
  app.get("/:id/logs", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const limitParam = c.req.query("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : 100;
      const logs = store().getExecutionLogs(task.id, limit);

      const data = logs.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      }));

      const response: APIResponse = { success: true, data };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Delete a task
  app.delete("/:id", (c) => {
    try {
      const deleted = store().deleteTask(c.req.param("id"));
      if (!deleted) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }
      const response: APIResponse = { success: true, data: { message: "Task deleted" } };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  // Clean old checkpoints
  app.post("/checkpoints/clean", (c) => {
    try {
      const deleted = store().cleanOldCheckpoints();
      const response: APIResponse = { success: true, data: { deleted } };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = { success: false, error: getErrorMessage(error) };
      return c.json(response, 500);
    }
  });

  return app;
}
