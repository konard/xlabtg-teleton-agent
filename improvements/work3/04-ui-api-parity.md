# 04 - UI/API Parity

## Scope

This report compares browser-facing V2 APIs, the HTTPS Management API, and UI
features that rely on generated or discovered backend capabilities.

## Confirmed Defects

### WORK3-H3: Management API does not expose most V2 WebUI routes

- component: Management API / UI/API parity
  (`src/api/server.ts`, `src/webui/server.ts`, `src/api/deps.ts`)
- seriousness: High - UI/API parity and operational readiness
- symptoms: The authenticated WebUI exposes many V2 feature routes under
  `/api/*`, but the HTTPS Management API exposes only a subset under `/v1/*`.
  Remote operators and API clients cannot access major V2 capabilities through
  the production management surface.
- how to reproduce:
  1. Compare route mounts in `src/webui/server.ts` and `src/api/server.ts`.
  2. During audit, the WebUI had 42 mounted `/api` route groups while the
     Management API had 24 mounted `/v1` route groups.
  3. Missing from `/v1`: `agent-actions`, `agent-network`, `analytics`,
     `anomalies`, `audit`, `autonomous`, `cache`, `context`, `dashboards`,
     `export`, `groq`, `health-check`, `metrics`, `mtproto`, `network`,
     `notifications`, `pipelines`, `predictions`, `security`,
     `self-improvement`, `sessions`, `widgets`, and `workflows`.
- expected behavior: For user-facing V2 features that have stable WebUI APIs,
  the Management API should either expose equivalent `/v1` routes or document
  that the feature is WebUI-only.
- actual behavior: `ApiServer.setupRoutes()` mounts only older/shared route
  factories plus a few newer ones. `ApiServerDeps` also lacks `networkConfig`,
  so even a direct mount of the network routes would not carry the same runtime
  configuration as WebUI.
- hypothesis of the cause: V2 features were added primarily through WebUI
  route factories, while the Management API mount list and dependency adapter
  were not updated consistently after each feature PR.
- recommended fix: Define the API parity policy for V2 features, mount the
  missing route factories under `/v1` where supported, extend `ApiServerDeps`
  for required config such as `networkConfig`, and add a route parity
  regression test that fails when a WebUI API group is unintentionally omitted.
- link to issue/PR: [#403](https://github.com/xlabtg/teleton-agent/issues/403),
  PR [#399](https://github.com/xlabtg/teleton-agent/pull/399)

### WORK3-M2: Widget generator previews return empty data for advertised sources

- component: AI widget generator / data-source preview parity
  (`src/services/data-source-catalog.ts`, `src/webui/routes/widget-generator.ts`)
- seriousness: Medium - UI/API parity and regression risk
- symptoms: The widget data-source catalog advertises sources such as
  `analytics.performance` and `predictions.next`, and prompt generation can
  select them. The preview route validates those generated definitions and
  returns HTTP 200, but `readPreviewData()` has no cases for those source ids,
  so the UI shows an empty preview (`No data yet`) even when the source is a
  supported catalog option.
- how to reproduce:
  1. POST `/api/widgets/generate` with a performance prompt such as
     `Show error rate and latency performance`.
  2. The generated definition uses `dataSource.id = analytics.performance`.
  3. POST that definition to `/api/widgets/preview`.
  4. The audit exercise observed HTTP 200 with zero preview rows.
- expected behavior: Every catalog data source selected by the generator should
  have preview data wired, or the generator should avoid advertising/selecting
  sources that cannot preview.
- actual behavior: `createDataSourceCatalog()` includes
  `analytics.performance` and `predictions.next`, but `readPreviewData()` only
  handles metrics, memory stats, status, and tasks, then falls through to `[]`
  for other valid data sources.
- hypothesis of the cause: The catalog grew faster than the preview switch
  statement. Validation checks source identity and endpoint consistency but not
  preview support.
- recommended fix: Add preview adapters for all catalog sources, or add a
  `previewSupported` contract and make generation/validation surface
  unsupported previews clearly. Add route tests for each catalog source id.
- link to issue/PR: [#404](https://github.com/xlabtg/teleton-agent/issues/404),
  PR [#399](https://github.com/xlabtg/teleton-agent/pull/399)

## Parity Check Command

The route comparison used this shape:

```bash
node - <<'NODE'
const fs = require("fs");
const web = fs.readFileSync("src/webui/server.ts", "utf8");
const api = fs.readFileSync("src/api/server.ts", "utf8");
const webRoutes = [...web.matchAll(/this\.app\.route\("\/api\/([^"]+)"/g)]
  .map((m) => m[1])
  .sort();
const apiRoutes = [...api.matchAll(/this\.app\.route\("\/v1\/([^"]+)"/g)]
  .map((m) => m[1])
  .sort();
console.log(webRoutes.filter((route) => !apiRoutes.includes(route)));
NODE
```
