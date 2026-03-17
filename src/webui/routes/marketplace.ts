import { Hono } from "hono";
import type {
  WebUIServerDeps,
  APIResponse,
  MarketplacePlugin,
  MarketplaceSource,
} from "../types.js";
import { MarketplaceService, ConflictError } from "../services/marketplace.js";
import { writePluginSecret, deletePluginSecret, listPluginSecretKeys } from "../../sdk/secrets.js";
import { readRawConfig, writeRawConfig } from "../../config/configurable-keys.js";

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
const VALID_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function createMarketplaceRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  let service: MarketplaceService | null = null;

  const getService = () => {
    if (!deps.marketplace) return null;
    service ??= new MarketplaceService({ ...deps.marketplace, toolRegistry: deps.toolRegistry });
    return service;
  };

  // GET / — list all marketplace plugins
  app.get("/", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const refresh = c.req.query("refresh") === "true";
      const plugins = await svc.listPlugins(refresh);
      return c.json<APIResponse<MarketplacePlugin[]>>({ success: true, data: plugins });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // POST /install — install a plugin
  app.post("/install", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.installPlugin(body.id);
      // Update plugins list for the existing /api/plugins route
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (err) {
      const status = err instanceof ConflictError ? 409 : 500;
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status
      );
    }
  });

  // POST /uninstall — uninstall a plugin
  app.post("/uninstall", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.uninstallPlugin(body.id);
      // Update plugins list
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (err) {
      const status = err instanceof ConflictError ? 409 : 500;
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status
      );
    }
  });

  // POST /update — update a plugin
  app.post("/update", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.updatePlugin(body.id);
      // Update plugins list
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (err) {
      const status = err instanceof ConflictError ? 409 : 500;
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status
      );
    }
  });

  // GET /secrets/:pluginId — list declared + configured secrets
  app.get("/secrets/:pluginId", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    const pluginId = c.req.param("pluginId");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }

    try {
      const plugins = await svc.listPlugins();
      const plugin = plugins.find((p) => p.id === pluginId);
      const declared = plugin?.secrets ?? {};
      const configured = listPluginSecretKeys(pluginId);
      return c.json<
        APIResponse<{
          declared: Record<string, { required: boolean; description: string; env?: string }>;
          configured: string[];
        }>
      >({ success: true, data: { declared, configured } });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // PUT /secrets/:pluginId/:key — set a secret value
  app.put("/secrets/:pluginId/:key", async (c) => {
    const pluginId = c.req.param("pluginId");
    const key = c.req.param("key");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }
    if (!key || !VALID_KEY.test(key)) {
      return c.json<APIResponse>(
        { success: false, error: "Invalid key name — use letters, digits, underscores" },
        400
      );
    }

    try {
      const body = await c.req.json<{ value: string }>();
      if (typeof body.value !== "string" || !body.value) {
        return c.json<APIResponse>({ success: false, error: "Missing or invalid value" }, 400);
      }
      writePluginSecret(pluginId, key, body.value);
      return c.json<APIResponse<{ key: string; set: boolean }>>({
        success: true,
        data: { key, set: true },
      });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // DELETE /secrets/:pluginId/:key — unset a secret
  app.delete("/secrets/:pluginId/:key", async (c) => {
    const pluginId = c.req.param("pluginId");
    const key = c.req.param("key");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }
    if (!key || !VALID_KEY.test(key)) {
      return c.json<APIResponse>(
        { success: false, error: "Invalid key name — use letters, digits, underscores" },
        400
      );
    }

    try {
      deletePluginSecret(pluginId, key);
      return c.json<APIResponse<{ key: string; set: boolean }>>({
        success: true,
        data: { key, set: false },
      });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // ── Source management ────────────────────────────────────────────────

  // GET /sources — list all sources (official + configured custom)
  app.get("/sources", (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }
    return c.json<APIResponse<MarketplaceSource[]>>({ success: true, data: svc.listSources() });
  });

  // POST /sources — add a custom registry source
  app.post("/sources", async (c) => {
    if (!deps.marketplace) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ url: string; label?: string }>();
      if (!body.url) {
        return c.json<APIResponse>({ success: false, error: "Missing url" }, 400);
      }

      // Validate URL
      try {
        new URL(body.url);
      } catch {
        return c.json<APIResponse>({ success: false, error: "Invalid URL" }, 400);
      }

      const raw = readRawConfig(deps.configPath);
      if (!raw.marketplace) raw.marketplace = {};
      if (!Array.isArray(raw.marketplace.extra_sources)) raw.marketplace.extra_sources = [];

      // Prevent duplicates
      const exists = raw.marketplace.extra_sources.some((s: { url: string }) => s.url === body.url);
      if (exists) {
        return c.json<APIResponse>({ success: false, error: "Source already exists" }, 409);
      }

      const newSource = { url: body.url, label: body.label ?? body.url, enabled: true };
      raw.marketplace.extra_sources.push(newSource);
      writeRawConfig(raw, deps.configPath);

      // Patch the live config so the running service picks it up immediately
      deps.marketplace.config.marketplace.extra_sources = raw.marketplace.extra_sources;

      // Invalidate cache on the service
      service?.invalidateCache();

      return c.json<APIResponse<MarketplaceSource>>({
        success: true,
        data: { ...newSource, isOfficial: false },
      });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // DELETE /sources — remove a custom registry source by URL
  app.delete("/sources", async (c) => {
    if (!deps.marketplace) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ url: string }>();
      if (!body.url) {
        return c.json<APIResponse>({ success: false, error: "Missing url" }, 400);
      }

      const raw = readRawConfig(deps.configPath);
      const sources: Array<{ url: string }> = raw.marketplace?.extra_sources ?? [];
      const idx = sources.findIndex((s) => s.url === body.url);
      if (idx === -1) {
        return c.json<APIResponse>({ success: false, error: "Source not found" }, 404);
      }

      raw.marketplace.extra_sources.splice(idx, 1);
      writeRawConfig(raw, deps.configPath);

      // Patch live config
      deps.marketplace.config.marketplace.extra_sources = raw.marketplace.extra_sources;

      service?.invalidateCache();

      return c.json<APIResponse<{ url: string }>>({ success: true, data: { url: body.url } });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // PATCH /sources — toggle a source enabled/disabled
  app.patch("/sources", async (c) => {
    if (!deps.marketplace) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ url: string; enabled: boolean }>();
      if (!body.url || typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "Missing url or enabled" }, 400);
      }

      const raw = readRawConfig(deps.configPath);
      const sources: Array<{ url: string; enabled: boolean }> =
        raw.marketplace?.extra_sources ?? [];
      const src = sources.find((s) => s.url === body.url);
      if (!src) {
        return c.json<APIResponse>({ success: false, error: "Source not found" }, 404);
      }

      src.enabled = body.enabled;
      writeRawConfig(raw, deps.configPath);

      deps.marketplace.config.marketplace.extra_sources = raw.marketplace.extra_sources;
      service?.invalidateCache();

      return c.json<APIResponse<{ url: string; enabled: boolean }>>({
        success: true,
        data: { url: body.url, enabled: body.enabled },
      });
    } catch (err) {
      return c.json<APIResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  return app;
}
