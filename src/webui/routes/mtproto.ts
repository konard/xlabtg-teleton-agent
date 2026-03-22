import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { readRawConfig, writeRawConfig, setNestedValue } from "../../config/configurable-keys.js";
import type { MtprotoProxyEntry } from "../../config/schema.js";

export function createMtprotoRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // GET /api/mtproto — current config
  app.get("/", (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
    const config = deps.agent.getConfig() as Record<string, any>;
    const mtproto = config.mtproto ?? { enabled: false, proxies: [] };
    return c.json({ success: true, data: mtproto } as APIResponse);
  });

  // PUT /api/mtproto/enabled — toggle enabled flag
  app.put("/enabled", async (c) => {
    try {
      const body = await c.req.json<{ enabled: boolean }>();
      const raw = readRawConfig(deps.configPath);
      setNestedValue(raw, "mtproto.enabled", !!body.enabled);
      writeRawConfig(raw, deps.configPath);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      setNestedValue(runtimeConfig, "mtproto.enabled", !!body.enabled);

      return c.json({ success: true, data: { enabled: !!body.enabled } } as APIResponse);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  // PUT /api/mtproto/proxies — replace the full proxies list
  app.put("/proxies", async (c) => {
    try {
      const body = await c.req.json<{ proxies: MtprotoProxyEntry[] }>();
      const proxies = body.proxies ?? [];

      // Validate entries
      for (let i = 0; i < proxies.length; i++) {
        const p = proxies[i];
        if (!p.server || typeof p.server !== "string") {
          return c.json(
            { success: false, error: `Proxy ${i + 1}: 'server' is required` } as APIResponse,
            400
          );
        }
        if (!p.port || typeof p.port !== "number" || p.port < 1 || p.port > 65535) {
          return c.json(
            {
              success: false,
              error: `Proxy ${i + 1}: 'port' must be a number between 1 and 65535`,
            } as APIResponse,
            400
          );
        }
        if (!p.secret || typeof p.secret !== "string" || p.secret.length < 32) {
          return c.json(
            {
              success: false,
              error: `Proxy ${i + 1}: 'secret' must be a hex string (32+ characters)`,
            } as APIResponse,
            400
          );
        }
      }

      const raw = readRawConfig(deps.configPath);
      setNestedValue(raw, "mtproto.proxies", proxies);
      writeRawConfig(raw, deps.configPath);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      setNestedValue(runtimeConfig, "mtproto.proxies", proxies);

      return c.json({ success: true, data: { proxies } } as APIResponse);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  return app;
}
