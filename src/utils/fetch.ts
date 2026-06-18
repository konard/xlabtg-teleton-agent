/**
 * Fetch with timeout support using AbortSignal.
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants/timeouts.js";
import { getCache } from "../services/cache.js";

const DEFAULT_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

interface CachedResponsePayload {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
}

function requestUrl(url: string | URL | Request): string {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.toString();
  return url.url;
}

function assertHttpFetchTarget(url: string | URL | Request): void {
  const parsed = new URL(requestUrl(url));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported fetch URL scheme: ${parsed.protocol}`);
  }
}

function responseFromPayload(payload: CachedResponsePayload): Response {
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers,
  });
}

async function payloadFromResponse(response: Response): Promise<CachedResponsePayload> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body: await response.clone().arrayBuffer(),
  };
}

export function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number; cacheTtlMs?: number | false }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, cacheTtlMs, ...fetchInit } = init ?? {};
  const method = (fetchInit.method ?? (url instanceof Request ? url.method : "GET")).toUpperCase();
  const ttlMs = typeof cacheTtlMs === "number" ? cacheTtlMs : undefined;
  const cache = ttlMs !== undefined && method === "GET" ? getCache() : null;

  if (cache) {
    const resourceId = requestUrl(url);
    const relevantConfig = { method, headers: fetchInit.headers ?? null };
    const key = cache.makeKey("api_responses", resourceId, relevantConfig);
    const cached = cache.getCachedByKey<CachedResponsePayload>(key);
    if (cached) return Promise.resolve(responseFromPayload(cached));

    return fetchWithSignal(url, fetchInit, timeoutMs).then(async (response) => {
      if (response.ok) {
        cache.set(
          "api_responses",
          resourceId,
          relevantConfig,
          await payloadFromResponse(response),
          {
            ttlMs,
          }
        );
      }
      return response;
    });
  }

  return fetchWithSignal(url, fetchInit, timeoutMs);
}

function fetchWithSignal(
  url: string | URL | Request,
  fetchInit: RequestInit,
  timeoutMs: number
): Promise<Response> {
  assertHttpFetchTarget(url);
  if (fetchInit.signal) {
    // codeql[js/file-access-to-http] fetchWithTimeout only accepts HTTP(S) URLs; callers must validate any file-derived request options before passing them here.
    return fetch(url, fetchInit);
  }

  // codeql[js/file-access-to-http] fetchWithTimeout only accepts HTTP(S) URLs; callers must validate any file-derived request options before passing them here.
  return fetch(url, {
    ...fetchInit,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
