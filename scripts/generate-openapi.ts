#!/usr/bin/env tsx
/**
 * Generate the static OpenAPI artifacts for the Teleton Management API.
 *
 * The spec is built from the *live* Hono router (via {@link ApiServer.getOpenApiSpec})
 * so it can never drift from the implementation. Three files are written to
 * `docs/api-reference/`:
 *
 *   - `openapi.json`  — machine-readable spec (also served at `/v1/openapi.json`)
 *   - `openapi.yaml`  — same spec, linted in CI with `redocly lint`
 *   - `index.html`    — self-contained Swagger UI rendering the static spec
 *
 * Run with `npm run generate:openapi`. The companion test
 * `src/api/__tests__/openapi-static.test.ts` fails if these files are stale.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";

import { buildManagementSpec } from "../src/api/openapi/generate.js";
import { swaggerUiHtml } from "../src/api/openapi/swagger-ui.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "docs", "api-reference");

function main(): void {
  const spec = buildManagementSpec();
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(join(OUT_DIR, "openapi.json"), `${JSON.stringify(spec, null, 2)}\n`);
  // Disable YAML anchors/aliases: the spec reuses shared error-response objects
  // by reference, and aliased output trips strict OpenAPI parsers (and YAML's
  // own alias-count guard). Expand them so the file is plain, portable YAML.
  writeFileSync(
    join(OUT_DIR, "openapi.yaml"),
    yamlStringify(spec, { aliasDuplicateObjects: false })
  );
  writeFileSync(join(OUT_DIR, "index.html"), swaggerUiHtml("./openapi.json"));

  const pathCount = Object.keys((spec.paths as Record<string, unknown>) ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(`Generated OpenAPI spec with ${pathCount} paths → ${OUT_DIR}`);
}

main();
