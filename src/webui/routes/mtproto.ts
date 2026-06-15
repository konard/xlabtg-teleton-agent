import { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { readRawConfig, writeRawConfig, setNestedValue } from "../../config/configurable-keys.js";
import type { MtprotoProxyEntry } from "../../config/schema.js";
import {
  checkMtprotoProxies,
  uncheckedMtprotoProxyStatuses,
} from "../../telegram/mtproto-proxy-health.js";
import { getMtprotoProxySecretValidationError } from "../../telegram/mtproto-proxy.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

type MtprotoConfigLike = Record<string, unknown> & {
  proxies?: unknown;
  bot_api_proxy?: unknown;
};

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function maskSecretValue(secret: string): string {
  if (secret.length <= 4) return "****";
  const visible = secret.slice(-4);
  const maskedLength = Math.max(secret.length - visible.length, 4);
  return `${"*".repeat(maskedLength)}${visible}`;
}

function maskProxyUrlCredentials(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    if (url.username) url.username = "****";
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value;
  }
}

function maskMtprotoProxy(proxy: unknown): unknown {
  if (!isRecord(proxy)) return proxy;

  return {
    ...proxy,
    ...(typeof proxy.secret === "string" && proxy.secret.length > 0
      ? { secret: maskSecretValue(proxy.secret) }
      : {}),
  };
}

function maskMtprotoConfig(mtproto: unknown): MtprotoConfigLike {
  const config = isRecord(mtproto) ? mtproto : { enabled: false, proxies: [] };
  const proxies = Array.isArray(config.proxies) ? config.proxies.map(maskMtprotoProxy) : [];

  return {
    ...config,
    proxies,
    ...(typeof config.bot_api_proxy === "string"
      ? { bot_api_proxy: maskProxyUrlCredentials(config.bot_api_proxy) }
      : {}),
  };
}

function getMtprotoProxies(config: Record<string, unknown>): MtprotoProxyEntry[] {
  const mtproto = config.mtproto;
  if (!isRecord(mtproto) || !Array.isArray(mtproto.proxies)) {
    return [];
  }
  return mtproto.proxies as MtprotoProxyEntry[];
}

function findOriginalProxy(
  proxy: MtprotoProxyEntry,
  index: number,
  existingProxies: MtprotoProxyEntry[]
): MtprotoProxyEntry | undefined {
  const indexed = existingProxies[index];
  if (indexed && proxy.secret === maskSecretValue(indexed.secret)) {
    return indexed;
  }

  return existingProxies.find(
    (existing) =>
      existing.server === proxy.server &&
      existing.port === proxy.port &&
      proxy.secret === maskSecretValue(existing.secret)
  );
}

function restoreMaskedProxySecrets(
  proxies: MtprotoProxyEntry[],
  existingProxies: MtprotoProxyEntry[]
): MtprotoProxyEntry[] {
  return proxies.map((proxy, index) => {
    const original = findOriginalProxy(proxy, index, existingProxies);
    return original ? { ...proxy, secret: original.secret } : proxy;
  });
}

function readSessionCandidate(path: string): string | undefined {
  try {
    if (!existsSync(path) || statSync(path).isDirectory()) {
      return undefined;
    }
    const sessionString = readFileSync(path, "utf-8").trim();
    return sessionString || undefined;
  } catch {
    return undefined;
  }
}

function readTelegramSessionString(config: Record<string, unknown>): string | undefined {
  const telegram = config.telegram as
    | { session_path?: unknown; session_name?: unknown }
    | undefined;
  const configuredSessionPath =
    typeof telegram?.session_path === "string" && telegram.session_path.trim()
      ? telegram.session_path.trim()
      : undefined;
  const sessionName =
    typeof telegram?.session_name === "string" && telegram.session_name.trim()
      ? telegram.session_name.trim()
      : "teleton_session";

  const directCandidates = unique([
    configuredSessionPath,
    join(TELETON_ROOT, "telegram_session.txt"),
  ]);
  for (const candidate of directCandidates) {
    const sessionString = readSessionCandidate(candidate);
    if (sessionString) return sessionString;
  }

  const directoryCandidates = unique([configuredSessionPath, TELETON_ROOT]);
  for (const candidate of directoryCandidates) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
        continue;
      }
      for (const nested of [
        join(candidate, "telegram_session.txt"),
        join(candidate, sessionName),
        join(candidate, `${sessionName}.session`),
      ]) {
        const sessionString = readSessionCandidate(nested);
        if (sessionString) return sessionString;
      }
    } catch {
      // Ignore unreadable legacy session locations and fall back to a transport-only check.
    }
  }

  return undefined;
}

export function createMtprotoRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // GET /api/mtproto — current config
  app.get("/", (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
    const config = deps.agent.getConfig() as Record<string, any>;
    const mtproto = config.mtproto ?? { enabled: false, proxies: [] };
    return c.json({ success: true, data: maskMtprotoConfig(mtproto) } as APIResponse);
  });

  // GET /api/mtproto/status — runtime connection status
  app.get("/status", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
    const config = deps.agent.getConfig() as Record<string, any>;
    const mtproto = config.mtproto ?? { enabled: false, proxies: [] };
    const proxies: MtprotoProxyEntry[] = mtproto.proxies ?? [];
    const connected = deps.bridge.isAvailable();
    const activeProxyIndex = connected ? deps.bridge.getActiveProxyIndex() : undefined;
    const activeProxy =
      activeProxyIndex !== undefined && proxies[activeProxyIndex]
        ? {
            server: proxies[activeProxyIndex].server,
            port: proxies[activeProxyIndex].port,
            index: activeProxyIndex,
          }
        : null;
    const apiId = Number(config.telegram?.api_id);
    const apiHash = typeof config.telegram?.api_hash === "string" ? config.telegram.api_hash : "";
    const sessionString = readTelegramSessionString(config);
    const proxyStatuses =
      proxies.length === 0
        ? []
        : Number.isFinite(apiId) && apiId > 0 && apiHash
          ? await checkMtprotoProxies({
              apiId,
              apiHash,
              proxies,
              activeProxyIndex,
              ...(sessionString ? { sessionString } : {}),
            })
          : uncheckedMtprotoProxyStatuses(
              proxies,
              "Telegram API ID and hash are required before proxy checks can run",
              activeProxyIndex
            );

    return c.json({
      success: true,
      data: {
        connected,
        enabled: mtproto.enabled ?? false,
        /** null means connected directly (no proxy active) */
        activeProxy,
        proxies: proxyStatuses,
      },
    } as APIResponse);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime config is dynamic
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      const proxies = restoreMaskedProxySecrets(
        body.proxies ?? [],
        getMtprotoProxies(runtimeConfig)
      );

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
        const secretError =
          typeof p.secret === "string"
            ? getMtprotoProxySecretValidationError(p.secret)
            : "secret is required";
        if (secretError) {
          return c.json(
            {
              success: false,
              error: `Proxy ${i + 1}: ${secretError}`,
            } as APIResponse,
            400
          );
        }
      }

      const raw = readRawConfig(deps.configPath);
      setNestedValue(raw, "mtproto.proxies", proxies);
      writeRawConfig(raw, deps.configPath);

      setNestedValue(runtimeConfig, "mtproto.proxies", proxies);

      return c.json({ success: true, data: maskMtprotoConfig({ proxies }) } as APIResponse);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  return app;
}
