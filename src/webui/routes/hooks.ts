import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  getBlocklistConfig,
  setBlocklistConfig,
  getTriggersConfig,
  setTriggersConfig,
  getRulesConfig,
  setRulesConfig,
  type BlocklistConfig,
  type TriggerEntry,
  type StructuredRule,
  type RuleBlock,
} from "../../agent/hooks/user-hook-store.js";
import { UserHookEvaluator, type UserHookTestResult } from "../../agent/hooks/user-hook-evaluator.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createHooksRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // ── Blocklist ────────────────────────────────────────────────────

  app.get("/blocklist", (c) => {
    try {
      const data = getBlocklistConfig(deps.memory.db);
      return c.json<APIResponse<BlocklistConfig>>({ success: true, data });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.put("/blocklist", async (c) => {
    try {
      const body = await c.req.json<{
        enabled?: boolean;
        keywords?: string[];
        message?: string;
      }>();

      if (typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "enabled must be a boolean" }, 400);
      }
      if (!Array.isArray(body.keywords)) {
        return c.json<APIResponse>({ success: false, error: "keywords must be an array" }, 400);
      }
      if (body.keywords.length > 200) {
        return c.json<APIResponse>({ success: false, error: "Maximum 200 keywords" }, 400);
      }

      const keywords = body.keywords
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k.length >= 2);

      const message = typeof body.message === "string" ? body.message.slice(0, 500) : "";

      const config: BlocklistConfig = {
        enabled: body.enabled,
        keywords,
        message,
      };
      setBlocklistConfig(deps.memory.db, config);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<BlocklistConfig>>({ success: true, data: config });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // ── Context Triggers ─────────────────────────────────────────────

  app.get("/triggers", (c) => {
    try {
      const data = getTriggersConfig(deps.memory.db);
      return c.json<APIResponse<TriggerEntry[]>>({ success: true, data });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.post("/triggers", async (c) => {
    try {
      const body = await c.req.json<{
        keyword?: string;
        context?: string;
        enabled?: boolean;
      }>();

      const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
      const context = typeof body.context === "string" ? body.context.trim() : "";

      if (keyword.length < 2 || keyword.length > 100) {
        return c.json<APIResponse>(
          { success: false, error: "keyword must be 2-100 characters" },
          400
        );
      }
      if (context.length < 1 || context.length > 2000) {
        return c.json<APIResponse>(
          { success: false, error: "context must be 1-2000 characters" },
          400
        );
      }

      const triggers = getTriggersConfig(deps.memory.db);
      if (triggers.length >= 50) {
        return c.json<APIResponse>({ success: false, error: "Maximum 50 triggers" }, 400);
      }

      const entry: TriggerEntry = {
        id: randomUUID(),
        keyword,
        context,
        enabled: body.enabled !== false,
      };
      triggers.push(entry);
      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<TriggerEntry>>({ success: true, data: entry });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.put("/triggers/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{
        keyword?: string;
        context?: string;
        enabled?: boolean;
      }>();

      const triggers = getTriggersConfig(deps.memory.db);
      const idx = triggers.findIndex((t) => t.id === id);
      if (idx === -1) {
        return c.json<APIResponse>({ success: false, error: "Trigger not found" }, 404);
      }

      if (typeof body.keyword === "string") {
        const kw = body.keyword.trim();
        if (kw.length < 2 || kw.length > 100) {
          return c.json<APIResponse>(
            { success: false, error: "keyword must be 2-100 characters" },
            400
          );
        }
        triggers[idx].keyword = kw;
      }
      if (typeof body.context === "string") {
        const ctx = body.context.trim();
        if (ctx.length < 1 || ctx.length > 2000) {
          return c.json<APIResponse>(
            { success: false, error: "context must be 1-2000 characters" },
            400
          );
        }
        triggers[idx].context = ctx;
      }
      if (typeof body.enabled === "boolean") {
        triggers[idx].enabled = body.enabled;
      }

      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<TriggerEntry>>({ success: true, data: triggers[idx] });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.delete("/triggers/:id", (c) => {
    try {
      const id = c.req.param("id");
      const triggers = getTriggersConfig(deps.memory.db);
      const filtered = triggers.filter((t) => t.id !== id);
      setTriggersConfig(deps.memory.db, filtered);
      deps.userHookEvaluator?.reload();
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.patch("/triggers/:id/toggle", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ enabled?: boolean }>();

      if (typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "enabled must be a boolean" }, 400);
      }

      const triggers = getTriggersConfig(deps.memory.db);
      const trigger = triggers.find((t) => t.id === id);
      if (!trigger) {
        return c.json<APIResponse>({ success: false, error: "Trigger not found" }, 404);
      }

      trigger.enabled = body.enabled;
      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<{ id: string; enabled: boolean }>>({
        success: true,
        data: { id, enabled: body.enabled },
      });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // ── Structured Rules (Visual Rule Builder) ───────────────────────

  app.get("/rules", (c) => {
    try {
      const data = getRulesConfig(deps.memory.db);
      return c.json<APIResponse<StructuredRule[]>>({ success: true, data });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.post("/rules", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        enabled?: boolean;
        blocks?: RuleBlock[];
      }>();

      const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "Untitled Rule";
      if (!Array.isArray(body.blocks)) {
        return c.json<APIResponse>({ success: false, error: "blocks must be an array" }, 400);
      }

      const rules = getRulesConfig(deps.memory.db);
      if (rules.length >= 100) {
        return c.json<APIResponse>({ success: false, error: "Maximum 100 rules" }, 400);
      }

      const rule: StructuredRule = {
        id: randomUUID(),
        name,
        enabled: body.enabled !== false,
        blocks: body.blocks,
        order: rules.length,
      };
      rules.push(rule);
      setRulesConfig(deps.memory.db, rules);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<StructuredRule>>({ success: true, data: rule });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // Note: /rules/reorder must be defined before /rules/:id so Hono doesn't match "reorder" as an id
  app.put("/rules/reorder", async (c) => {
    try {
      const body = await c.req.json<{ ids: string[] }>();
      if (!Array.isArray(body.ids)) {
        return c.json<APIResponse>({ success: false, error: "ids must be an array" }, 400);
      }

      const rules = getRulesConfig(deps.memory.db);
      const reordered = body.ids
        .map((id, i) => {
          const rule = rules.find((r) => r.id === id);
          if (rule) rule.order = i;
          return rule;
        })
        .filter((r): r is StructuredRule => r !== undefined);

      // Append any rules not mentioned in the ids list at the end
      const mentionedIds = new Set(body.ids);
      const remaining = rules.filter((r) => !mentionedIds.has(r.id));
      remaining.forEach((r, i) => {
        r.order = reordered.length + i;
      });

      const final = [...reordered, ...remaining];
      setRulesConfig(deps.memory.db, final);

      return c.json<APIResponse<StructuredRule[]>>({ success: true, data: final });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.put("/rules/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<Partial<StructuredRule>>();

      const rules = getRulesConfig(deps.memory.db);
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) {
        return c.json<APIResponse>({ success: false, error: "Rule not found" }, 404);
      }

      if (typeof body.name === "string") rules[idx].name = body.name.trim().slice(0, 100);
      if (typeof body.enabled === "boolean") rules[idx].enabled = body.enabled;
      if (Array.isArray(body.blocks)) rules[idx].blocks = body.blocks;
      if (typeof body.order === "number") rules[idx].order = body.order;

      setRulesConfig(deps.memory.db, rules);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<StructuredRule>>({ success: true, data: rules[idx] });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  app.delete("/rules/:id", (c) => {
    try {
      const id = c.req.param("id");
      const rules = getRulesConfig(deps.memory.db);
      const filtered = rules.filter((r) => r.id !== id);
      setRulesConfig(deps.memory.db, filtered);
      deps.userHookEvaluator?.reload();
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  // ── Hook Test Endpoint ────────────────────────────────────────────

  app.post("/test", async (c) => {
    try {
      const body = await c.req.json<{ message?: string }>();
      const message = typeof body.message === "string" ? body.message : "";

      if (message.length > 4000) {
        return c.json<APIResponse>({ success: false, error: "message must be 4000 characters or fewer" }, 400);
      }

      // Use the live evaluator if available, otherwise create a temporary one from DB state
      const evaluator: UserHookEvaluator =
        deps.userHookEvaluator ?? new UserHookEvaluator(deps.memory.db);

      const result = evaluator.evaluateWithTrace(message);

      return c.json<APIResponse<UserHookTestResult>>({ success: true, data: result });
    } catch (err) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(err) }, 500);
    }
  });

  return app;
}
