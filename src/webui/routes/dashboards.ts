import { Hono } from "hono";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import {
  getDashboardStore,
  type AddWidgetInput,
  type DashboardExportBundle,
  type DashboardProfile,
  type DashboardTemplate,
  type UpdateDashboardInput,
  type UpdateWidgetInput,
  type WidgetDefinition,
} from "../../services/dashboard.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createDashboardsRoutes(deps: WebUIServerDeps): Hono {
  const app = new Hono();

  function store() {
    return getDashboardStore(deps.memory.db);
  }

  app.get("/", (c) => {
    try {
      return c.json<APIResponse<DashboardProfile[]>>({ success: true, data: store().list() });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/templates", (c) => {
    try {
      return c.json<APIResponse<DashboardTemplate[]>>({
        success: true,
        data: store().listTemplates(),
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/templates/:templateId", async (c) => {
    try {
      type TemplateBody = Partial<Pick<DashboardProfile, "name" | "description" | "isDefault">>;
      const body = await c.req.json<TemplateBody>().catch((): TemplateBody => ({}));
      const dashboard = store().createFromTemplate(c.req.param("templateId"), {
        name: body.name,
        description: body.description,
        isDefault: body.isDefault,
      });
      return c.json<APIResponse<DashboardProfile>>({ success: true, data: dashboard }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.get("/widgets/catalog", (c) => {
    try {
      return c.json<APIResponse<WidgetDefinition[]>>({
        success: true,
        data: store().listWidgetDefinitions(),
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/widgets/catalog", async (c) => {
    try {
      const body = await c.req.json<WidgetDefinition>();
      const definition = store().registerWidgetDefinition(body);
      return c.json<APIResponse<WidgetDefinition>>({ success: true, data: definition }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.post("/import", async (c) => {
    try {
      const body = await c.req.json<{
        bundle?: DashboardExportBundle;
        options?: Partial<Pick<DashboardProfile, "name" | "description" | "isDefault">>;
      }>();
      if (!body.bundle) {
        return c.json<APIResponse>({ success: false, error: "bundle is required" }, 400);
      }
      const dashboard = store().importDashboard(body.bundle, body.options);
      return c.json<APIResponse<DashboardProfile>>({ success: true, data: dashboard }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.get("/:id", (c) => {
    try {
      const dashboard = store().get(c.req.param("id"));
      if (!dashboard) {
        return c.json<APIResponse>({ success: false, error: "Dashboard not found" }, 404);
      }
      return c.json<APIResponse<DashboardProfile>>({ success: true, data: dashboard });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        description?: string | null;
        widgets?: DashboardProfile["widgets"];
        layout?: DashboardProfile["layout"];
        isDefault?: boolean;
        templateId?: string;
      }>();

      const dashboard = body.templateId
        ? store().createFromTemplate(body.templateId, {
            name: body.name,
            description: body.description,
            isDefault: body.isDefault,
          })
        : store().create({
            name: body.name ?? "",
            description: body.description,
            widgets: body.widgets,
            layout: body.layout,
            isDefault: body.isDefault,
          });

      return c.json<APIResponse<DashboardProfile>>({ success: true, data: dashboard }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.put("/:id", async (c) => {
    try {
      const body = await c.req.json<UpdateDashboardInput>();
      const dashboard = store().update(c.req.param("id"), body);
      if (!dashboard) {
        return c.json<APIResponse>({ success: false, error: "Dashboard not found" }, 404);
      }
      return c.json<APIResponse<DashboardProfile>>({ success: true, data: dashboard });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.delete("/:id", (c) => {
    try {
      const deleted = store().delete(c.req.param("id"));
      if (!deleted) {
        return c.json<APIResponse>({ success: false, error: "Dashboard not found" }, 404);
      }
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/:id/widgets", (c) => {
    try {
      return c.json<APIResponse<DashboardProfile["widgets"]>>({
        success: true,
        data: store().listWidgets(c.req.param("id")),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.post("/:id/widgets", async (c) => {
    try {
      const body = await c.req.json<AddWidgetInput>();
      const widget = store().addWidget(c.req.param("id"), body);
      return c.json<APIResponse<DashboardProfile["widgets"][number]>>(
        { success: true, data: widget },
        201
      );
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("not found") ? 404 : 400;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.put("/:id/widgets/:widgetId", async (c) => {
    try {
      const body = await c.req.json<UpdateWidgetInput>();
      const widget = store().updateWidget(c.req.param("id"), c.req.param("widgetId"), body);
      if (!widget) {
        return c.json<APIResponse>({ success: false, error: "Widget not found" }, 404);
      }
      return c.json<APIResponse<DashboardProfile["widgets"][number]>>({
        success: true,
        data: widget,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("not found") ? 404 : 400;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.delete("/:id/widgets/:widgetId", (c) => {
    try {
      const deleted = store().deleteWidget(c.req.param("id"), c.req.param("widgetId"));
      if (!deleted) {
        return c.json<APIResponse>({ success: false, error: "Widget not found" }, 404);
      }
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  app.post("/:id/export", (c) => {
    try {
      return c.json<APIResponse<DashboardExportBundle>>({
        success: true,
        data: store().exportDashboard(c.req.param("id")),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = message.includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: message }, status);
    }
  });

  return app;
}
