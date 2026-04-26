import { TelegramClient } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import type { MtprotoProxyEntry } from "../config/schema.js";
import { MTPROTO_PROXY_STATUS_TIMEOUT_MS } from "../constants/timeouts.js";
import { getErrorMessage } from "../utils/errors.js";
import { isTelegramAuthError } from "./auth-errors.js";
import { buildMtprotoProxyClientOptions } from "./mtproto-proxy.js";

export type MtprotoProxyHealthState = "available" | "unavailable" | "unchecked";

export interface MtprotoProxyHealth {
  index: number;
  server: string;
  port: number;
  active: boolean;
  status: MtprotoProxyHealthState;
  available: boolean | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string | null;
}

interface CheckOptions {
  activeProxyIndex?: number;
  timeoutMs?: number;
  sessionString?: string;
}

interface CheckAllOptions extends CheckOptions {
  apiId: number;
  apiHash: string;
  proxies: MtprotoProxyEntry[];
}

function createStatusBase(
  entry: MtprotoProxyEntry,
  index: number,
  activeProxyIndex?: number
): Pick<MtprotoProxyHealth, "index" | "server" | "port" | "active"> {
  return {
    index,
    server: entry.server,
    port: entry.port,
    active: activeProxyIndex === index,
  };
}

export function uncheckedMtprotoProxyStatuses(
  proxies: MtprotoProxyEntry[],
  reason: string,
  activeProxyIndex?: number
): MtprotoProxyHealth[] {
  return proxies.map((entry, index) => ({
    ...createStatusBase(entry, index, activeProxyIndex),
    status: "unchecked",
    available: null,
    latencyMs: null,
    error: reason,
    checkedAt: null,
  }));
}

export async function checkMtprotoProxy(
  apiId: number,
  apiHash: string,
  entry: MtprotoProxyEntry,
  index: number,
  options: CheckOptions = {}
): Promise<MtprotoProxyHealth> {
  const timeoutMs = options.timeoutMs ?? MTPROTO_PROXY_STATUS_TIMEOUT_MS;
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const logger = new Logger(LogLevel.NONE);
  const client = new TelegramClient(
    new StringSession(options.sessionString ?? ""),
    apiId,
    apiHash,
    {
      connectionRetries: 1,
      retryDelay: 250,
      autoReconnect: false,
      floodSleepThreshold: 0,
      baseLogger: logger,
      ...buildMtprotoProxyClientOptions(entry),
    }
  );

  const withStatusTimeout = async <T>(operation: Promise<T>, action: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(`MTProto proxy ${action} timed out after ${Math.round(timeoutMs / 1000)}s`)
          ),
        timeoutMs
      );
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    await withStatusTimeout(client.connect(), "connection check");
    if (options.sessionString) {
      try {
        await withStatusTimeout(client.getMe(), "authenticated check");
      } catch (error) {
        if (!isTelegramAuthError(error)) {
          throw error;
        }
        return {
          ...createStatusBase(entry, index, options.activeProxyIndex),
          status: "available",
          available: true,
          latencyMs: Date.now() - startedAt,
          error: `Telegram session requires re-authentication: ${getErrorMessage(error)}`,
          checkedAt,
        };
      }
    }
    return {
      ...createStatusBase(entry, index, options.activeProxyIndex),
      status: "available",
      available: true,
      latencyMs: Date.now() - startedAt,
      error: null,
      checkedAt,
    };
  } catch (error) {
    return {
      ...createStatusBase(entry, index, options.activeProxyIndex),
      status: "unavailable",
      available: false,
      latencyMs: null,
      error: getErrorMessage(error),
      checkedAt,
    };
  } finally {
    await Promise.resolve(client.disconnect()).catch(() => {});
  }
}

export async function checkMtprotoProxies(options: CheckAllOptions): Promise<MtprotoProxyHealth[]> {
  const { apiId, apiHash, proxies, activeProxyIndex, timeoutMs, sessionString } = options;
  return Promise.all(
    proxies.map((entry, index) =>
      checkMtprotoProxy(apiId, apiHash, entry, index, {
        activeProxyIndex,
        timeoutMs,
        sessionString,
      })
    )
  );
}
