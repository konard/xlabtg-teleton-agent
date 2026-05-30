# Teleton Management API — Reference

Machine-readable OpenAPI 3.1 reference for the Teleton **Management API** (`/v1/*`).
These files are **generated** from the live Hono router — do not edit them by hand.

| File | Description |
|------|-------------|
| [`openapi.json`](openapi.json) | OpenAPI 3.1 spec (JSON) — also served at `/v1/openapi.json` |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 spec (YAML) — linted in CI with `redocly lint` |
| [`index.html`](index.html) | Self-contained Swagger UI rendering `openapi.json` |

## Viewing the docs

- **Locally, statically:** open `index.html` in a browser (it loads Swagger UI from a CDN and reads `./openapi.json`).
- **At runtime:** start the agent with `api.docs_enabled: true` (or in development) and open `https://localhost:7778/api/docs`.

## Regenerating

```bash
npm run generate:openapi   # rewrite all three files from the live router
npm run lint:openapi       # validate with redocly
```

CI (`.github/workflows/ci.yml`, job `CI / OpenAPI`) regenerates the spec and fails if the
committed files are stale or if `redocly lint` reports errors.

See [`../management-api.md`](../management-api.md) for the full prose guide.
