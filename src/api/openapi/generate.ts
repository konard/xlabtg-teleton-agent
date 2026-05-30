/**
 * Build the Management API OpenAPI document from the live Hono router without
 * starting any subsystem or binding a network server.
 *
 * Several WebUI route factories touch their dependencies at *construction*
 * time (e.g. `IntegrationRegistry` creates its SQLite tables eagerly). To build
 * the full route surface we therefore supply:
 *
 *   - a real in-memory SQLite database, so table-creating factories succeed;
 *   - a self-returning "black-hole" proxy for every other dependency, so any
 *     property access / call / construction at factory-build time resolves to a
 *     harmless stub instead of throwing.
 *
 * Route *handlers* are never invoked here — only registered — so these stubs
 * never need to behave realistically. The result is a spec that always mirrors
 * the routes the server actually mounts.
 *
 * Pure (no file I/O): reused by `scripts/generate-openapi.ts` and by the
 * coverage test in `src/api/__tests__/`.
 */
import Database from "better-sqlite3";

import { ApiServer } from "../server.js";
import type { ApiServerDeps } from "../deps.js";
import { WebUIConfigSchema, type ApiConfig } from "../../config/schema.js";

/** Default port baked into the generated `servers[0].url`. */
export const SPEC_SERVER_PORT = 7778;

/**
 * A proxy that swallows any interaction: every property read returns the same
 * proxy, and it is callable / constructable. Iteration yields nothing and
 * primitive coercion is benign, so construction-time code can poke at it freely.
 */
function blackHole(): unknown {
  const target = function noop() {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return undefined; // never look thenable to `await`
      if (prop === Symbol.iterator) return function* () {}; // empty iterable
      if (prop === Symbol.asyncIterator) return undefined;
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "toString" || prop === "valueOf") return () => "";
      if (prop === Symbol.toStringTag) return "BlackHole";
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy as object,
    has: () => true,
  });
  return proxy;
}

/**
 * Build the OpenAPI 3.1 spec for the full Management API route surface.
 *
 * @param db Optional database to back the in-memory factories. Defaults to a
 *           fresh `:memory:` SQLite instance (the caller may close it).
 */
export function buildManagementSpec(
  db: Database.Database = new Database(":memory:")
): Record<string, unknown> {
  const bh = blackHole();
  // Real values where construction-time code reads them concretely; `null` for
  // the always-available *optional* deps so `?.` chains collapse to `undefined`
  // (e.g. an absent `marketplace.config.integrations.credential_key`); and a
  // black hole for the remaining deps, which factories only store or touch from
  // request handlers we never invoke. This keeps `createDepsAdapter`'s
  // 503-on-null guard quiet while letting table-creating factories build.
  const real: Record<string, unknown> = {
    memory: { db },
    configPath: "",
    config: WebUIConfigSchema.parse({}),
    networkConfig: undefined,
    lifecycle: null,
    marketplace: null,
    userHookEvaluator: null,
    autonomousManager: null,
    workflowScheduler: null,
    agentManager: null,
  };
  const deps = new Proxy(real, {
    get(t, prop) {
      return prop in t ? t[prop as string] : bh;
    },
  }) as unknown as ApiServerDeps;

  const config: ApiConfig = {
    enabled: false,
    port: SPEC_SERVER_PORT,
    host: "127.0.0.1",
    key_hash: "0".repeat(64),
    allowed_ips: [],
    docs_enabled: true,
  };

  return new ApiServer(deps, config).getOpenApiSpec();
}
