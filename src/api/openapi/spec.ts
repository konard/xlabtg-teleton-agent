/**
 * Code-first OpenAPI 3.1 generator for the Teleton Management API.
 *
 * Route paths are discovered from the live Hono router so the spec can never
 * silently drift from the implementation. The human-readable layer (tags,
 * descriptions, curated schemas) comes from {@link ./metadata.ts}.
 */
import {
  API_VERSION,
  DEFAULT_GROUP,
  GROUP_META,
  OPENAPI_INFO,
  OPERATION_META,
  type GroupMeta,
} from "./metadata.js";

/** A single HTTP operation discovered on the router. */
export interface RouteInfo {
  method: string;
  /** OpenAPI-style path with `{param}` placeholders. */
  path: string;
}

/**
 * Minimal structural view of a Hono router — just the `routes` registry we
 * read. Declared structurally so any `Hono<Env>` instance is accepted without
 * fighting Hono's generic `Env` parameter.
 */
export interface RouterLike {
  routes: Array<{ method: string; path: string }>;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

/** Paths that are documentation/meta plumbing rather than API surface. */
function isDocumentablePath(path: string): boolean {
  if (path.includes("*")) return false; // middleware mounts
  if (path === "/" || path === "") return false;
  // The /api/* namespace only serves the docs UI + unauthenticated spec copy.
  if (path === "/api/docs" || path === "/api/openapi.json") return false;
  return true;
}

/** Convert a Hono path (`:id`) to an OpenAPI path (`{id}`). */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/**
 * Extract the unique, documentable HTTP operations from a fully-built Hono app.
 * Middleware registrations and duplicates are filtered out.
 */
export function extractRoutes(app: RouterLike): RouteInfo[] {
  const seen = new Set<string>();
  const routes: RouteInfo[] = [];

  for (const r of app.routes) {
    const method = r.method.toUpperCase();
    if (!HTTP_METHODS.has(method)) continue; // skip ALL (middleware) / non-HTTP
    if (!isDocumentablePath(r.path)) continue;

    const path = toOpenApiPath(r.path);
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, path });
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return routes;
}

/** First meaningful path segment used to look up the route group. */
function groupKey(path: string): string {
  // "/healthz" -> "healthz"; "/v1/status/foo" -> "status"; "/v1/openapi.json" -> "openapi.json"
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments[0] === "v1") return segments[1] ?? "";
  return segments[0];
}

function groupMetaFor(path: string): GroupMeta {
  return GROUP_META[groupKey(path)] ?? DEFAULT_GROUP;
}

/** Build a stable, unique operationId from method + path. */
function operationId(method: string, path: string): string {
  const slug = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "_");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

/** Derive path parameters from `{param}` placeholders. */
function pathParameters(path: string): Array<Record<string, unknown>> {
  const params: Array<Record<string, unknown>> = [];
  for (const match of path.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
      description: `\`${match[1]}\` path parameter`,
    });
  }
  return params;
}

/** Humanise an operation summary when no curated one exists. */
function fallbackSummary(method: string, path: string): string {
  const verb =
    { GET: "Get", POST: "Create / invoke", PUT: "Update", DELETE: "Delete", PATCH: "Patch" }[
      method
    ] ?? method;
  return `${verb} ${path}`;
}

/** Reusable error-response references keyed by status code. */
const ERROR_REFS = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
  "429": { $ref: "#/components/responses/TooManyRequests" },
  "500": { $ref: "#/components/responses/InternalError" },
  "503": { $ref: "#/components/responses/ServiceUnavailable" },
} as const;

interface BuildOptions {
  /** Server URL (e.g. `https://localhost:7778`). */
  serverUrl: string;
}

/**
 * Build the complete OpenAPI 3.1 document for the supplied routes.
 *
 * Pure function — no I/O — so it can be reused at runtime (served from
 * `/v1/openapi.json`) and at build time (static docs generation).
 */
export function buildOpenApiSpec(routes: RouteInfo[], opts: BuildOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const usedTags = new Map<string, string>();
  // OpenAPI treats paths that differ only by parameter *name* as identical
  // (e.g. `/v1/tools/{module}` vs `/v1/tools/{name}`). Collapse such routes
  // onto the first-seen literal path so the document stays valid.
  const canonicalPath = new Map<string, string>();

  for (const route of routes) {
    const { method } = route;
    const normKey = route.path.replace(/\{[^}]+\}/g, "{}");
    const path = canonicalPath.get(normKey) ?? route.path;
    canonicalPath.set(normKey, path);
    // Skip a parameter-name-only duplicate of an already-documented operation.
    if ((paths[path] as Record<string, unknown> | undefined)?.[method.toLowerCase()]) continue;

    const group = groupMetaFor(path);
    const opMeta = OPERATION_META[`${method} ${path}`];
    const tag = opMeta?.tag ?? group.tag;
    usedTags.set(tag, group.description);

    const isV1 = path.startsWith("/v1/");
    const params = [...pathParameters(path)];
    for (const q of opMeta?.query ?? []) {
      params.push({
        name: q.name,
        in: "query",
        required: q.required ?? false,
        description: q.description,
        schema: q.schema,
      });
    }

    // Successful response
    const success = opMeta?.success;
    const successStatus = String(success?.status ?? 200);
    const successContentType = success?.contentType ?? "application/json";
    const successResponse: Record<string, unknown> = {
      description: success?.description ?? "Successful response",
    };
    if (success?.schema) {
      successResponse.content = { [successContentType]: { schema: success.schema } };
    } else {
      successResponse.content = {
        "application/json": { schema: { type: "object", additionalProperties: true } },
      };
    }

    const responses: Record<string, unknown> = { [successStatus]: successResponse };
    if (isV1) {
      responses["401"] = ERROR_REFS["401"];
      responses["403"] = ERROR_REFS["403"];
      responses["429"] = ERROR_REFS["429"];
      responses["503"] = ERROR_REFS["503"];
    }
    responses["500"] = ERROR_REFS["500"];

    const operation: Record<string, unknown> = {
      tags: [tag],
      summary: opMeta?.summary ?? fallbackSummary(method, path),
      operationId: operationId(method, path),
      ...(opMeta?.description ? { description: opMeta.description } : {}),
      ...(params.length ? { parameters: params } : {}),
      responses,
    };

    if (opMeta?.requestBody) {
      operation.requestBody = {
        ...(opMeta.requestBody.description ? { description: opMeta.requestBody.description } : {}),
        content: { "application/json": { schema: opMeta.requestBody.schema } },
      };
    }

    operation.security = isV1 ? [{ BearerAuth: [] }] : [];

    const httpMethod = method.toLowerCase();
    paths[path] = { ...(paths[path] ?? {}), [httpMethod]: operation };
  }

  const tags = [...usedTags.entries()].map(([name, description]) => ({ name, description }));

  return {
    openapi: "3.1.0",
    info: OPENAPI_INFO,
    servers: [{ url: opts.serverUrl, description: "Management API server" }],
    tags,
    security: [{ BearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "`tltn_`-prefixed API key issued at first start or via `teleton api-rotate-key`.",
        },
      },
      schemas: {
        ProblemDetail: {
          type: "object",
          description: "RFC 9457 Problem Detail object.",
          properties: {
            type: { type: "string", default: "about:blank" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
          },
          required: ["title", "status"],
        },
      },
      responses: {
        BadRequest: problemResponse("Malformed request"),
        Unauthorized: problemResponse("Missing, malformed or invalid API key"),
        Forbidden: problemResponse("Source IP is not in the whitelist"),
        NotFound: problemResponse("Resource not found"),
        Conflict: problemResponse("State conflict (e.g. agent already running)"),
        TooManyRequests: problemResponse("Rate limit or brute-force block exceeded"),
        InternalError: problemResponse("Unexpected server error"),
        ServiceUnavailable: problemResponse("Agent subsystem not available (agent not running)"),
      },
    },
  };
}

function problemResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetail" } },
    },
  };
}

export { API_VERSION };
