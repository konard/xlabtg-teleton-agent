import type { Page, Route } from "@playwright/test";

/**
 * Mock backend for the accessibility suite.
 *
 * The WebUI talks to a management API at `/api/*` and an auth endpoint at
 * `/auth/*`. For an a11y audit we don't need a real backend — we only need the
 * pages to render their chrome and primary content. This helper intercepts
 * those requests and returns sensibly-shaped JSON so every page reaches a
 * rendered (non-loading) state.
 *
 * The API envelope is `{ success: true, data: <payload> }`. Most list
 * endpoints expect an array, so the default payload is `[]`. Endpoints that
 * gate page rendering on an object are listed in OBJECT_RESPONSES.
 */

/** Object-shaped payloads, keyed by the `/api`-relative path (no query). */
const OBJECT_RESPONSES: Record<string, unknown> = {
  "/status": {
    uptime: 3600,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    sessionCount: 0,
    toolCount: 0,
    tokenUsage: { totalTokens: 0, totalCost: 0 },
    platform: "linux",
  },
  "/agent/status": { state: "stopped", uptime: 0, error: null },
  "/memory/stats": { knowledge: 0, sessions: 0, messages: 0, chats: 0 },
  "/tools/rag": {
    enabled: false,
    indexed: false,
    topK: 5,
    totalTools: 0,
    alwaysInclude: [],
    skipUnlimitedProviders: false,
  },
  "/health-check": {
    status: "healthy",
    timestamp: Date.now(),
    checks: [],
  },
  "/analytics/budget": {
    monthly_limit_usd: null,
    current_month_cost_usd: 0,
    projected_month_cost_usd: 0,
    percent_used: 0,
  },
  "/soul": { content: "", path: "soul.md", exists: true },
  "/network/status": { connected: false, peers: [] },
};

/** Endpoints whose payload should be an empty object rather than an array. */
const EMPTY_OBJECT_PREFIXES = [
  "/settings",
  "/profile",
  "/config/",
  "/security/overview",
  "/analytics/overview",
  "/autonomous/status",
  "/self-improve/status",
];

function payloadFor(path: string): unknown {
  if (path in OBJECT_RESPONSES) return OBJECT_RESPONSES[path];
  for (const prefix of EMPTY_OBJECT_PREFIXES) {
    if (path === prefix || path.startsWith(prefix)) return {};
  }
  // Default: list endpoints expect arrays.
  return [];
}

async function fulfilJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
}

/**
 * Install request interception so the WebUI renders against mock data.
 * Call before navigating.
 */
export async function mockBackend(page: Page): Promise<void> {
  // Auth: always authenticated.
  await page.route("**/auth/check", (route) =>
    fulfilJson(route, { success: true, data: { authenticated: true } }),
  );
  await page.route("**/auth/login", (route) =>
    fulfilJson(route, { success: true, data: { authenticated: true } }),
  );
  await page.route("**/auth/logout", (route) =>
    fulfilJson(route, { success: true, data: {} }),
  );

  // Log stream (EventSource) — return an empty, immediately-closing stream so
  // the page doesn't hang waiting for events.
  await page.route("**/api/logs/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      body: "",
    }),
  );

  // Everything else under /api.
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (method !== "GET") {
      // Mutations succeed with an empty success envelope.
      return fulfilJson(route, { success: true, data: {} });
    }
    return fulfilJson(route, { success: true, data: payloadFor(path) });
  });

  // Health probe used by some components.
  await page.route("**/health", (route) =>
    fulfilJson(route, { success: true, data: { status: "ok" } }),
  );
}
