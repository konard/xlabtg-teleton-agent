import type { Page, Route } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────
// Mock backend for the WebUI E2E smoke suite.
//
// The WebUI talks to the agent over HTTP (/api/*, /auth/*, /health) plus a
// handful of Server-Sent-Event streams. There is no real backend in CI, so we
// intercept every request at the browser level with page.route() and answer
// with deterministic fixtures. This keeps the suite fast, credential-free and
// safe to run on forks (no secrets required).
//
// A single catch-all route dispatches by pathname. Anything that is not an API
// call (HTML, JS, CSS, assets) is forwarded to the static server via
// route.continue().
// ─────────────────────────────────────────────────────────────────────────

export interface TaskFixture {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed" | "cancelled";
  priority: number;
  createdAt: string;
  dependencies: string[];
  dependents: string[];
}

export interface MemorySourceFixture {
  source: string;
  entryCount: number;
  lastUpdated: number;
}

export interface SecuritySettingsFixture {
  session_timeout_minutes: number | null;
  ip_allowlist: string[];
  rate_limit_rpm: number | null;
}

export interface MockBackendOptions {
  /** Whether /auth/check reports the user as authenticated. Default: true. */
  authenticated?: boolean;
  /** Seed tasks returned by GET /api/tasks. */
  tasks?: TaskFixture[];
  /** Seed memory sources returned by GET /api/memory/sources. */
  sources?: MemorySourceFixture[];
  /** Initial security settings returned by GET /api/security/settings. */
  securitySettings?: SecuritySettingsFixture;
}

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // fixed clock for determinism

function ok<T>(data: T) {
  return JSON.stringify({ success: true, data });
}

function json(route: Route, body: string, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body,
  });
}

function sse(route: Route, event: string, data: unknown) {
  // A large `retry` keeps EventSource from reconnecting in a tight loop once
  // this single response closes — the initial event is all the UI needs.
  const body = `retry: 600000\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return route.fulfill({
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
    body,
  });
}

const DEFAULT_TASKS: TaskFixture[] = [
  {
    id: "task-1",
    description: "Summarise the latest market activity for TON",
    status: "in_progress",
    priority: 1,
    createdAt: new Date(NOW).toISOString(),
    dependencies: [],
    dependents: [],
  },
  {
    id: "task-2",
    description: "Index new memory documents from the workspace",
    status: "pending",
    priority: 2,
    createdAt: new Date(NOW).toISOString(),
    dependencies: [],
    dependents: [],
  },
  {
    id: "task-3",
    description: "Generate the daily activity report",
    status: "done",
    priority: 3,
    createdAt: new Date(NOW).toISOString(),
    dependencies: [],
    dependents: [],
  },
];

const DEFAULT_SOURCES: MemorySourceFixture[] = [
  { source: "workspace/notes.md", entryCount: 12, lastUpdated: NOW },
  { source: "workspace/research/ton-defi.md", entryCount: 5, lastUpdated: NOW },
  { source: "conversations/telegram-archive.md", entryCount: 31, lastUpdated: NOW },
];

const DEFAULT_SECURITY: SecuritySettingsFixture = {
  session_timeout_minutes: 60,
  ip_allowlist: [],
  rate_limit_rpm: 120,
};

/**
 * Install the mock backend on a page. Call this BEFORE page.goto().
 */
export async function setupMockBackend(
  page: Page,
  options: MockBackendOptions = {}
): Promise<void> {
  const authenticated = options.authenticated ?? true;

  // Mutable state so mutations (cancel a task, save settings, create a
  // pipeline) persist across reloads within a single test.
  const tasks: TaskFixture[] = (options.tasks ?? DEFAULT_TASKS).map((t) => ({ ...t }));
  const sources = options.sources ?? DEFAULT_SOURCES;
  let security: SecuritySettingsFixture = { ...(options.securitySettings ?? DEFAULT_SECURITY) };
  const pipelines: unknown[] = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // Not an API/auth/health call → let the static server serve the asset.
    if (!path.startsWith("/api") && !path.startsWith("/auth") && !path.startsWith("/health")) {
      return route.continue();
    }

    // ── Auth (not under /api) ──────────────────────────────────────────
    if (path === "/auth/check") {
      return json(route, ok({ authenticated }));
    }
    if (path === "/auth/login") {
      return json(route, ok({ authenticated: true }));
    }
    if (path === "/auth/logout") {
      return json(route, ok({ authenticated: false }));
    }
    if (path === "/health") {
      return json(route, ok({ status: "ok" }));
    }

    // ── SSE streams ────────────────────────────────────────────────────
    if (path === "/api/agent/events") {
      return sse(route, "status", { state: "running", error: null, timestamp: NOW });
    }
    if (path === "/api/notifications/stream") {
      return sse(route, "unread-count", { count: 0 });
    }
    if (path === "/api/logs/stream") {
      return sse(route, "log", { level: "log", message: "agent ready", timestamp: NOW });
    }
    if (path === "/api/events/stream") {
      return sse(route, "message", {});
    }

    // ── Setup wizard ───────────────────────────────────────────────────
    if (path === "/api/setup/status") {
      return json(route, ok({ configExists: false, workspaceExists: false }));
    }
    if (path === "/api/setup/providers") {
      return json(
        route,
        ok([
          {
            id: "anthropic",
            displayName: "Anthropic",
            defaultModel: "claude-opus-4-8",
            toolLimit: null,
            requiresApiKey: true,
            autoDetectsKey: false,
            keyPrefix: "sk-ant",
            consoleUrl: "https://console.anthropic.com/",
          },
        ])
      );
    }
    if (path.startsWith("/api/setup/models/")) {
      return json(
        route,
        ok([
          {
            value: "claude-opus-4-8",
            name: "Claude Opus 4.8",
            description: "Most capable",
            isCustom: false,
          },
        ])
      );
    }
    if (path === "/api/setup/workspace/init") {
      return json(route, ok({ created: true, path: "/tmp/teleton-workspace" }));
    }
    if (path === "/api/setup/validate/api-key") {
      return json(route, ok({ valid: true }));
    }
    if (path === "/api/setup/detect-claude-code-key") {
      return json(route, ok({ found: false, maskedKey: null, valid: false }));
    }
    if (path === "/api/setup/wallet/status") {
      return json(
        route,
        ok({ exists: true, address: "EQAtestWalletAddress0000000000000000000000000000000" })
      );
    }
    if (path === "/api/setup/telegram/qr-start") {
      return json(
        route,
        ok({ authSessionId: "sess-1", token: "qr-token-abc", expires: 60, expiresAt: NOW + 60_000 })
      );
    }
    if (path === "/api/setup/telegram/qr-refresh") {
      return json(
        route,
        ok({ status: "authenticated", user: { id: 42, firstName: "Test", username: "testuser" } })
      );
    }
    if (path === "/api/setup/config/save") {
      return json(route, ok({ path: "/tmp/teleton-workspace/config.yaml" }));
    }

    // ── Agent status / control ─────────────────────────────────────────
    if (path === "/api/agent/status") {
      // getAgentStatus reads the raw JSON (json.data ?? json).
      return json(route, JSON.stringify({ state: "running", uptime: 3600, error: null }));
    }
    if (path === "/api/agents") {
      return json(route, ok({ agents: [] }));
    }

    // ── Dashboard data ─────────────────────────────────────────────────
    if (path === "/api/status") {
      return json(
        route,
        ok({
          uptime: 3600,
          model: "claude-opus-4-8",
          provider: "anthropic",
          sessionCount: 2,
          toolCount: 116,
          tokenUsage: { totalTokens: 12345, totalCost: 0.42 },
          platform: "linux",
        })
      );
    }
    if (path === "/api/memory/stats") {
      return json(route, ok({ knowledge: 48, sessions: 3, messages: 210, chats: 5 }));
    }
    if (path === "/api/config") {
      // useConfigState iterates this array; keep it empty so the
      // getModelsForProvider effect short-circuits (no agent.provider set).
      return json(route, ok([]));
    }
    if (path === "/api/tools/rag") {
      return json(
        route,
        ok({ enabled: false, indexed: false, topK: 8, totalTools: 116, alwaysInclude: [] })
      );
    }
    if (path === "/api/dashboards/templates") {
      return json(route, ok([]));
    }
    if (path === "/api/dashboards/widgets/catalog") {
      return json(route, ok([]));
    }
    if (path === "/api/dashboards") {
      return json(route, ok([]));
    }

    // ── Notifications ──────────────────────────────────────────────────
    if (path === "/api/notifications/unread-count") {
      return json(route, ok({ count: 0 }));
    }
    if (path === "/api/notifications") {
      return json(route, ok([]));
    }

    // ── Tasks ──────────────────────────────────────────────────────────
    if (path === "/api/tasks" && method === "GET") {
      return json(route, ok(tasks));
    }
    const cancelMatch = path.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (cancelMatch && method === "POST") {
      const id = cancelMatch[1];
      const task = tasks.find((t) => t.id === id);
      if (task) task.status = "cancelled";
      return json(route, ok(task ?? null));
    }

    // ── Memory ─────────────────────────────────────────────────────────
    if (path === "/api/memory/sources") {
      return json(route, ok(sources));
    }

    // ── Pipelines ──────────────────────────────────────────────────────
    if (path === "/api/pipelines" && method === "GET") {
      return json(route, ok(pipelines));
    }
    if (path === "/api/pipelines" && method === "POST") {
      const payload = JSON.parse(request.postData() || "{}");
      const created = {
        id: `pipeline-${pipelines.length + 1}`,
        name: payload.name ?? "Untitled",
        description: payload.description ?? null,
        enabled: payload.enabled ?? true,
        steps: payload.steps ?? [],
        errorStrategy: payload.errorStrategy ?? "halt",
        maxRetries: payload.maxRetries ?? 0,
        timeoutSeconds: payload.timeoutSeconds ?? null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      pipelines.unshift(created);
      return json(route, ok(created), 201);
    }

    // ── Security ───────────────────────────────────────────────────────
    if (path === "/api/security/settings" && method === "GET") {
      return json(route, ok(security));
    }
    if (path === "/api/security/settings" && method === "PUT") {
      const patch = JSON.parse(request.postData() || "{}");
      security = { ...security, ...patch };
      return json(route, ok(security));
    }
    if (path.startsWith("/api/audit/events")) {
      return json(route, ok({ entries: [], total: 0, page: 1, limit: 50 }));
    }
    if (path.startsWith("/api/audit/reports/")) {
      return json(
        route,
        ok({
          type: "daily_activity",
          generatedAt: new Date(NOW).toISOString(),
          periodHours: 24,
          rows: [],
          summary: {},
        })
      );
    }

    // ── Generic fallbacks for anything else under /api ─────────────────
    // GETs return an empty list, mutations a bare success. This prevents
    // unrouted requests from hitting the static server (which would return
    // HTML and break JSON parsing).
    if (method === "GET") {
      return json(route, ok([]));
    }
    return json(route, ok({}));
  });
}
