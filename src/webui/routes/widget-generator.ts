import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getTokenUsage } from "../../agent/token-usage.js";
import { createDataSourceCatalog } from "../../services/data-source-catalog.js";
import {
  type GeneratedWidgetDefinition,
  type GenerateWidgetInput,
  type RefineWidgetInput,
  WidgetGeneratorService,
} from "../../services/widget-generator.js";
import { initMetrics } from "../../services/metrics.js";
import { getErrorMessage } from "../../utils/errors.js";

type PreviewRow = Record<string, unknown>;

interface PreviewRequest {
  definition?: GeneratedWidgetDefinition;
}

interface WidgetPreviewResult {
  definition: GeneratedWidgetDefinition;
  data: PreviewRow[];
  fields: Array<{ key: string; label: string; type: string }>;
  generatedAt: string;
}

function parsePeriodHours(period: string | undefined): number {
  switch (period) {
    case "30d":
      return 30 * 24;
    case "7d":
      return 7 * 24;
    default:
      return 24;
  }
}

function safeCount(deps: WebUIServerDeps, table: string): number {
  if (!/^[a-z_]+$/i.test(table)) return 0;
  try {
    const row = deps.memory.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

function readPreviewData(
  definition: GeneratedWidgetDefinition,
  deps: WebUIServerDeps
): PreviewRow[] {
  const periodHours = parsePeriodHours(definition.dataSource.params?.period);

  switch (definition.dataSource.id) {
    case "metrics.tools":
      return initMetrics(deps.memory.db).getToolUsage(periodHours) as unknown as PreviewRow[];
    case "metrics.tokens":
      return initMetrics(deps.memory.db).getTokenUsage(periodHours) as unknown as PreviewRow[];
    case "metrics.activity":
      return initMetrics(deps.memory.db).getActivity(periodHours) as unknown as PreviewRow[];
    case "memory.stats":
      return [
        {
          knowledge: safeCount(deps, "knowledge"),
          messages: safeCount(deps, "messages"),
          chats: safeCount(deps, "chats"),
          sessions: safeCount(deps, "sessions"),
        },
      ];
    case "status.overview": {
      const config = deps.agent.getConfig();
      const tokenUsage = getTokenUsage();
      return [
        {
          uptime: process.uptime(),
          model: config.agent.model,
          provider: config.agent.provider,
          sessionCount: safeCount(deps, "sessions"),
          toolCount: deps.toolRegistry.getAll().length,
          totalTokens: tokenUsage.totalTokens,
        },
      ];
    }
    case "tasks.list":
      try {
        return deps.memory.db
          .prepare(
            `SELECT description, status, priority, created_at AS createdAt
             FROM tasks
             ORDER BY created_at DESC
             LIMIT 10`
          )
          .all() as PreviewRow[];
      } catch {
        return [];
      }
    default:
      return [];
  }
}

export function createWidgetGeneratorRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const catalog = createDataSourceCatalog();
  const generator = new WidgetGeneratorService(catalog);

  app.get("/templates", (c) => {
    const response: APIResponse<ReturnType<typeof generator.templates>> = {
      success: true,
      data: generator.templates(),
    };
    return c.json(response);
  });

  app.get("/data-sources", (c) => {
    const response: APIResponse<ReturnType<typeof generator.listDataSources>> = {
      success: true,
      data: generator.listDataSources(),
    };
    return c.json(response);
  });

  app.post("/generate", async (c) => {
    try {
      const body = await c.req.json<GenerateWidgetInput>();
      const result = generator.generate(body);
      const status = result.validation.valid ? 200 : 422;
      return c.json<APIResponse<typeof result>>(
        { success: result.validation.valid, data: result },
        status
      );
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("prompt is required") ? 400 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.post("/refine", async (c) => {
    try {
      const body = await c.req.json<RefineWidgetInput>();
      const result = generator.refine(body);
      const status = result.validation.valid ? 200 : 422;
      return c.json<APIResponse<typeof result>>(
        { success: result.validation.valid, data: result },
        status
      );
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("prompt is required") ? 400 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.post("/preview", async (c) => {
    try {
      const body = await c.req.json<PreviewRequest>();
      if (!body.definition) {
        return c.json<APIResponse>({ success: false, error: "definition is required" }, 400);
      }

      const validation = generator.validateDefinition(body.definition);
      if (!validation.valid) {
        return c.json<APIResponse>({ success: false, error: validation.issues.join("; ") }, 422);
      }

      const result: WidgetPreviewResult = {
        definition: body.definition,
        data: readPreviewData(body.definition, deps),
        fields: generator.fieldsForDefinition(body.definition),
        generatedAt: new Date().toISOString(),
      };

      return c.json<APIResponse<WidgetPreviewResult>>({ success: true, data: result });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
