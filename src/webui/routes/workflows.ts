import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getWorkflowStore, type WorkflowConfig, type Workflow } from "../../services/workflows.js";
import { getErrorMessage } from "../../utils/errors.js";

const MAX_WORKFLOWS = 100;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

export function createWorkflowsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function store() {
    return getWorkflowStore(deps.memory.db);
  }

  // List all workflows
  app.get("/", (c) => {
    try {
      const workflows = store().list();
      return c.json<APIResponse<Workflow[]>>({ success: true, data: workflows });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Get single workflow
  app.get("/:id", (c) => {
    try {
      const wf = store().get(c.req.param("id"));
      if (!wf) {
        return c.json<APIResponse>({ success: false, error: "Workflow not found" }, 404);
      }
      return c.json<APIResponse<Workflow>>({ success: true, data: wf });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Create workflow
  app.post("/", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        description?: string;
        enabled?: boolean;
        config?: WorkflowConfig;
      }>();

      const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
      if (name.length < 1) {
        return c.json<APIResponse>({ success: false, error: "name is required" }, 400);
      }

      if (!body.config || typeof body.config !== "object") {
        return c.json<APIResponse>({ success: false, error: "config is required" }, 400);
      }

      const validationError = validateConfig(body.config);
      if (validationError) {
        return c.json<APIResponse>({ success: false, error: validationError }, 400);
      }

      const workflows = store().list();
      if (workflows.length >= MAX_WORKFLOWS) {
        return c.json<APIResponse>(
          { success: false, error: `Maximum ${MAX_WORKFLOWS} workflows allowed` },
          400
        );
      }

      const description =
        typeof body.description === "string"
          ? body.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
          : undefined;

      const config = body.config;
      if (config.trigger.type === "webhook" && !config.trigger.secret) {
        config.trigger.secret = randomUUID().replace(/-/g, "");
      }

      const wf = store().create({
        name,
        description,
        enabled: body.enabled !== false,
        config,
      });

      return c.json<APIResponse<Workflow>>({ success: true, data: wf }, 201);
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Update workflow
  app.put("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{
        name?: string;
        description?: string | null;
        enabled?: boolean;
        config?: WorkflowConfig;
      }>();

      const existing = store().get(id);
      if (!existing) {
        return c.json<APIResponse>({ success: false, error: "Workflow not found" }, 404);
      }

      const updates: Parameters<ReturnType<typeof store>["update"]>[1] = {};

      if (typeof body.name === "string") {
        const name = body.name.trim().slice(0, MAX_NAME_LENGTH);
        if (name.length < 1) {
          return c.json<APIResponse>({ success: false, error: "name cannot be empty" }, 400);
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description =
          body.description === null
            ? null
            : body.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
      }

      if (typeof body.enabled === "boolean") {
        updates.enabled = body.enabled;
      }

      if (body.config !== undefined) {
        if (typeof body.config !== "object") {
          return c.json<APIResponse>({ success: false, error: "config must be an object" }, 400);
        }
        const validationError = validateConfig(body.config);
        if (validationError) {
          return c.json<APIResponse>({ success: false, error: validationError }, 400);
        }
        updates.config = body.config;
      }

      const updated = store().update(id, updates);
      if (!updated) {
        return c.json<APIResponse>({ success: false, error: "Workflow not found" }, 404);
      }

      return c.json<APIResponse<Workflow>>({ success: true, data: updated });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Toggle workflow enabled/disabled
  app.patch("/:id/toggle", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ enabled?: boolean }>();

      if (typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "enabled must be a boolean" }, 400);
      }

      const updated = store().update(id, { enabled: body.enabled });
      if (!updated) {
        return c.json<APIResponse>({ success: false, error: "Workflow not found" }, 404);
      }

      return c.json<APIResponse<{ id: string; enabled: boolean }>>({
        success: true,
        data: { id, enabled: body.enabled },
      });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Delete workflow
  app.delete("/:id", (c) => {
    try {
      const deleted = store().delete(c.req.param("id"));
      if (!deleted) {
        return c.json<APIResponse>({ success: false, error: "Workflow not found" }, 404);
      }
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Webhook trigger endpoint — public, authenticated via secret token in URL
  app.post("/webhook/:secret", async (c) => {
    try {
      const secret = c.req.param("secret");
      const scheduler =
        typeof deps.workflowScheduler === "function"
          ? deps.workflowScheduler()
          : deps.workflowScheduler;
      if (!scheduler) {
        return c.json<APIResponse>(
          { success: false, error: "Workflow scheduler unavailable" },
          503
        );
      }
      const triggered = await scheduler.handleWebhook(secret);
      if (!triggered) {
        return c.json<APIResponse>(
          { success: false, error: "No workflow found for this webhook" },
          404
        );
      }
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  return app;
}

// ── Config validation ───────────────────────────────────────────────────────

function validateConfig(config: WorkflowConfig): string | null {
  if (!config.trigger || typeof config.trigger !== "object") {
    return "config.trigger is required";
  }

  const trigger = config.trigger;
  const validTriggerTypes = ["cron", "webhook", "event"];
  if (!validTriggerTypes.includes(trigger.type)) {
    return `trigger.type must be one of: ${validTriggerTypes.join(", ")}`;
  }

  if (trigger.type === "cron") {
    if (typeof trigger.cron !== "string" || trigger.cron.trim().length === 0) {
      return "cron trigger requires a non-empty cron expression";
    }
    if (!isValidCronExpression(trigger.cron)) {
      return "invalid cron expression (expected 5 fields: minute hour day month weekday)";
    }
  }

  if (trigger.type === "event") {
    const validEvents = ["agent.start", "agent.stop", "agent.error", "tool.complete"];
    if (!validEvents.includes(trigger.event)) {
      return `event trigger.event must be one of: ${validEvents.join(", ")}`;
    }
  }

  if (!Array.isArray(config.actions)) {
    return "config.actions must be an array";
  }

  if (config.actions.length > 10) {
    return "maximum 10 actions per workflow";
  }

  for (let i = 0; i < config.actions.length; i++) {
    const action = config.actions[i];
    const validActionTypes = ["send_message", "call_api", "set_variable"];
    if (!validActionTypes.includes(action.type)) {
      return `actions[${i}].type must be one of: ${validActionTypes.join(", ")}`;
    }

    if (action.type === "send_message") {
      if (typeof action.chatId !== "string" || action.chatId.trim().length === 0) {
        return `actions[${i}] send_message requires a non-empty chatId`;
      }
      if (typeof action.text !== "string" || action.text.trim().length === 0) {
        return `actions[${i}] send_message requires a non-empty text`;
      }
    }

    if (action.type === "call_api") {
      const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      if (!validMethods.includes(action.method)) {
        return `actions[${i}] call_api method must be one of: ${validMethods.join(", ")}`;
      }
      if (typeof action.url !== "string" || !action.url.startsWith("http")) {
        return `actions[${i}] call_api requires a valid HTTP URL`;
      }
    }

    if (action.type === "set_variable") {
      if (typeof action.name !== "string" || action.name.trim().length === 0) {
        return `actions[${i}] set_variable requires a non-empty name`;
      }
      if (typeof action.value !== "string") {
        return `actions[${i}] set_variable requires a value`;
      }
    }
  }

  return null;
}

function isValidCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 1, max: 12 }, // month
    { min: 0, max: 7 }, // day of week (0 and 7 = Sunday)
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    const { min, max } = ranges[i];
    if (!isValidCronField(part, min, max)) return false;
  }

  return true;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;

  // Step values: */n or start/n
  if (field.includes("/")) {
    const [range, step] = field.split("/");
    const stepNum = Number(step);
    if (!Number.isInteger(stepNum) || stepNum < 1) return false;
    if (range === "*") return true;
    const rangeNum = Number(range);
    return Number.isInteger(rangeNum) && rangeNum >= min && rangeNum <= max;
  }

  // Lists: 1,2,3
  if (field.includes(",")) {
    return field.split(",").every((v) => isValidCronField(v, min, max));
  }

  // Ranges: 1-5
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    return (
      Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end
    );
  }

  // Single value
  const num = Number(field);
  return Number.isInteger(num) && num >= min && num <= max;
}
