import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";

import { buildManagementSpec } from "../openapi/generate.js";
import { buildOpenApiSpec, extractRoutes, type RouterLike } from "../openapi/spec.js";
import { swaggerUiHtml } from "../openapi/swagger-ui.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(HERE, "..", "..", "..", "docs", "api-reference");

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  security: unknown;
  paths: Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
};

describe("extractRoutes", () => {
  it("keeps HTTP operations, drops middleware/meta plumbing, dedupes and sorts", () => {
    const app: RouterLike = {
      routes: [
        { method: "ALL", path: "/v1/*" }, // middleware mount
        { method: "GET", path: "/v1/status" },
        { method: "GET", path: "/v1/status" }, // duplicate
        { method: "POST", path: "/v1/agent/:action" }, // :param -> {param}
        { method: "GET", path: "/api/docs" }, // docs UI, excluded
        { method: "GET", path: "/api/openapi.json" }, // spec copy, excluded
        { method: "GET", path: "/" }, // root, excluded
        { method: "GET", path: "/healthz" },
      ],
    };

    // Sorted by path (localeCompare), then method.
    expect(extractRoutes(app)).toEqual([
      { method: "GET", path: "/healthz" },
      { method: "POST", path: "/v1/agent/{action}" },
      { method: "GET", path: "/v1/status" },
    ]);
  });
});

describe("buildOpenApiSpec", () => {
  it("merges paths that differ only by parameter name into one", () => {
    // OpenAPI treats `/v1/tools/{module}` and `/v1/tools/{name}` as identical.
    const spec = buildOpenApiSpec(
      [
        { method: "GET", path: "/v1/tools/{module}" },
        { method: "POST", path: "/v1/tools/{name}" },
      ],
      { serverUrl: "https://localhost:7778" }
    ) as unknown as OpenApiDoc;

    // Both operations collapse onto the first-seen literal path.
    expect(Object.keys(spec.paths)).toEqual(["/v1/tools/{module}"]);
    expect(spec.paths["/v1/tools/{module}"].get).toBeDefined();
    expect(spec.paths["/v1/tools/{module}"].post).toBeDefined();
  });

  it("secures /v1 operations with BearerAuth and standard error responses", () => {
    const spec = buildOpenApiSpec([{ method: "GET", path: "/v1/status" }], {
      serverUrl: "https://localhost:7778",
    }) as unknown as OpenApiDoc;

    const op = spec.paths["/v1/status"].get;
    expect(op.security).toEqual([{ BearerAuth: [] }]);
    for (const code of ["401", "403", "429", "503", "500"]) {
      expect(op.responses[code]).toBeDefined();
    }
  });

  it("leaves non-/v1 operations unauthenticated", () => {
    const spec = buildOpenApiSpec([{ method: "GET", path: "/healthz" }], {
      serverUrl: "https://localhost:7778",
    }) as unknown as OpenApiDoc;

    const op = spec.paths["/healthz"].get;
    expect(op.security).toEqual([]);
    expect(op.responses["401"]).toBeUndefined();
  });
});

describe("buildManagementSpec (live router)", () => {
  const spec = buildManagementSpec() as unknown as OpenApiDoc;

  it("is a valid OpenAPI 3.1 document with the expected metadata", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Teleton Management API");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.servers[0].url).toMatch(/^https:\/\/localhost:\d+$/);
    expect(spec.security).toEqual([{ BearerAuth: [] }]);
    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
    expect(spec.components.schemas.ProblemDetail).toBeDefined();
  });

  it("covers the full management surface (~200 endpoints)", () => {
    const paths = Object.keys(spec.paths);
    expect(paths.length).toBeGreaterThan(200);
    // The documented management surface lives under /v1.
    expect(paths.filter((p) => p.startsWith("/v1/")).length).toBeGreaterThan(150);
  });

  it("documents every /v1 route discovered on the live router", () => {
    // Every /v1 operation must carry bearer auth — guards against the generator
    // dropping security metadata for a freshly-mounted route group.
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith("/v1/")) continue;
      for (const op of Object.values(methods)) {
        expect(op.security).toEqual([{ BearerAuth: [] }]);
      }
    }
  });

  it("excludes the docs UI and unauthenticated spec copy from the paths", () => {
    expect(spec.paths["/api/docs"]).toBeUndefined();
    expect(spec.paths["/api/openapi.json"]).toBeUndefined();
  });
});

describe("committed docs/api-reference artifacts", () => {
  const spec = buildManagementSpec();

  it("openapi.json matches a fresh generation (run `npm run generate:openapi`)", () => {
    const committed = readFileSync(join(DOCS_DIR, "openapi.json"), "utf8");
    expect(committed).toBe(`${JSON.stringify(spec, null, 2)}\n`);
  });

  it("openapi.yaml deserialises to the same spec", () => {
    const committed = yamlParse(readFileSync(join(DOCS_DIR, "openapi.yaml"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it("index.html is the Swagger UI page for the static spec", () => {
    const committed = readFileSync(join(DOCS_DIR, "index.html"), "utf8");
    expect(committed).toBe(swaggerUiHtml("./openapi.json"));
  });
});
