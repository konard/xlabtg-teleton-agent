/**
 * Hand-authored OpenAPI metadata for the Teleton Management API.
 *
 * The route *paths* are discovered automatically from the live Hono router
 * (see {@link ./spec.ts}). This file supplies the human-readable layer that a
 * router cannot infer: tags, group descriptions, security requirements and
 * richer request/response schemas for the well-documented core endpoints.
 *
 * Keeping this separate from the generator means new routes are picked up
 * automatically (with a sensible generic operation) while curated endpoints
 * stay richly documented.
 */

/** Current Management API contract version (mirrors `system/version` → apiVersion). */
export const API_VERSION = "1.0.0";

/** OpenAPI document version — bump on breaking contract changes. */
export const OPENAPI_INFO = {
  title: "Teleton Management API",
  version: API_VERSION,
  description:
    "HTTPS management API for remote administration of a Teleton agent — " +
    "lifecycle control, configuration, monitoring and the stable WebUI route " +
    "surface mounted under `/v1`.\n\n" +
    "All `/v1/*` routes require a `tltn_`-prefixed bearer token. Errors follow " +
    "[RFC 9457 Problem Detail](https://www.rfc-editor.org/rfc/rfc9457).",
  contact: { name: "Teleton", url: "https://github.com/xlabtg/teleton-agent" },
  license: { name: "MIT", url: "https://github.com/xlabtg/teleton-agent/blob/main/LICENSE" },
} as const;

/**
 * Tag + description for every first path segment.
 *
 * The key is the segment immediately after `/v1/` (e.g. `status` for
 * `/v1/status/...`), or the literal root path for unauthenticated probes.
 * Descriptions mirror `docs/management-api.md`.
 */
export interface GroupMeta {
  tag: string;
  description: string;
}

export const GROUP_META: Record<string, GroupMeta> = {
  // Unauthenticated root probes
  healthz: { tag: "Health", description: "Liveness and readiness probes (no authentication)." },
  readyz: { tag: "Health", description: "Liveness and readiness probes (no authentication)." },

  // API-native route groups
  agent: { tag: "Agent Lifecycle", description: "Start, stop, restart and observe the agent." },
  system: { tag: "System", description: "Runtime version and host system information." },
  auth: { tag: "Auth", description: "API key validation." },
  "api-logs": { tag: "Logs", description: "Recent log lines and live log streaming." },
  "api-memory": {
    tag: "Sessions",
    description: "Chat session maintenance (deletion and pruning).",
  },
  "openapi.json": { tag: "Meta", description: "Machine-readable API contract." },

  // Reused WebUI route groups (mounted under /v1)
  status: { tag: "Status", description: "Agent status and metrics." },
  tools: { tag: "Tools", description: "Tool inventory and configuration." },
  logs: { tag: "Conversation Logs", description: "Conversation logs." },
  memory: { tag: "Memory", description: "Memory search and management." },
  soul: { tag: "Soul", description: "System prompt (read-only)." },
  plugins: { tag: "Plugins", description: "Plugin management." },
  mcp: { tag: "MCP", description: "MCP server configuration." },
  workspace: { tag: "Workspace", description: "Workspace file management." },
  tasks: { tag: "Tasks", description: "Scheduled tasks." },
  config: { tag: "Configuration", description: "Configuration read/write." },
  marketplace: { tag: "Marketplace", description: "Plugin marketplace." },
  hooks: { tag: "Hooks", description: "Hook management." },
  integrations: { tag: "Integrations", description: "Third-party integrations." },
  "ton-proxy": { tag: "TON Proxy", description: "TON Proxy control." },
  agents: { tag: "Managed Agents", description: "Managed agent fleet administration." },
  feedback: { tag: "Feedback", description: "User feedback collection." },
  prompts: { tag: "Prompts", description: "Prompt library management." },
  events: { tag: "Events", description: "Internal event bus stream." },
  webhooks: { tag: "Webhooks", description: "Outbound webhook management." },
  notifications: { tag: "Notifications", description: "In-app notifications and unread counts." },
  cache: { tag: "Cache", description: "Predictive cache inspection and controls." },
  metrics: { tag: "Metrics", description: "Operational metrics." },
  sessions: { tag: "Chat Sessions", description: "Chat session search and inspection." },
  analytics: { tag: "Analytics", description: "Usage analytics." },
  anomalies: { tag: "Anomalies", description: "Anomaly detection data." },
  security: { tag: "Security", description: "Security status and zero-trust policy data." },
  audit: { tag: "Audit", description: "Audit trail search and stream." },
  "health-check": { tag: "Health Check", description: "Composite application health checks." },
  export: { tag: "Export/Import", description: "Safe configuration and prompt export/import." },
  workflows: { tag: "Workflows", description: "Workflow definitions and scheduling." },
  pipelines: { tag: "Pipelines", description: "Pipeline definitions and execution." },
  "self-improvement": {
    tag: "Self-Improvement",
    description: "Self-improvement run history and controls.",
  },
  autonomous: { tag: "Autonomous", description: "Autonomous task queue and policy routes." },
  predictions: { tag: "Predictions", description: "Prediction service data." },
  context: { tag: "Temporal Context", description: "Temporal context analytics." },
  dashboards: { tag: "Dashboards", description: "Dynamic dashboard layout and widgets." },
  widgets: { tag: "Widgets", description: "Widget generator routes." },
  network: { tag: "Agent Network", description: "Agent network registry and delegation routes." },
  setup: { tag: "Setup", description: "Setup wizard (works without a running agent)." },
};

/** Fallback group used when a path segment is not in {@link GROUP_META}. */
export const DEFAULT_GROUP: GroupMeta = {
  tag: "Other",
  description: "Additional management endpoints.",
};

/**
 * Per-operation enrichment, keyed by `"METHOD path"` (OpenAPI-style `{param}`).
 *
 * Only the well-documented core endpoints are enriched here; everything else
 * gets a generic-but-valid operation from the generator.
 */
export interface OperationMeta {
  summary: string;
  description?: string;
  /** Override the auto-assigned tag. */
  tag?: string;
  /** Extra query parameters (path parameters are derived automatically). */
  query?: Array<{
    name: string;
    description: string;
    required?: boolean;
    schema: Record<string, unknown>;
  }>;
  /** JSON request body schema. */
  requestBody?: { description?: string; schema: Record<string, unknown> };
  /** Successful response: schema + optional content type (defaults to JSON). */
  success?: {
    status?: number;
    description: string;
    schema?: Record<string, unknown>;
    contentType?: string;
  };
}

export const OPERATION_META: Record<string, OperationMeta> = {
  "GET /healthz": {
    summary: "Liveness probe",
    description: 'Always returns `{ "status": "ok" }`. No authentication required.',
    success: {
      description: "Service is alive",
      schema: { type: "object", properties: { status: { type: "string", example: "ok" } } },
    },
  },
  "GET /readyz": {
    summary: "Readiness probe",
    description:
      "Returns `200` when the agent is running, otherwise `503` with setup completeness. " +
      "No authentication required.",
    success: {
      description: "Agent is running and ready",
      schema: {
        type: "object",
        properties: {
          status: { type: "string", example: "ready" },
          state: { type: "string", example: "running" },
        },
      },
    },
  },
  "GET /v1/openapi.json": {
    summary: "OpenAPI specification",
    description: "Returns this OpenAPI 3.1 document describing the Management API.",
    tag: "Meta",
    success: {
      description: "OpenAPI 3.1 document",
      schema: { type: "object", additionalProperties: true },
    },
  },
  "POST /v1/agent/start": {
    summary: "Start the agent",
    description: "Fire-and-forget. Returns `409` if the agent is already running or stopping.",
    success: {
      description: "Agent transitioning to running",
      schema: { type: "object", properties: { state: { type: "string", example: "starting" } } },
    },
  },
  "POST /v1/agent/stop": {
    summary: "Stop the agent",
    description: "Fire-and-forget. Returns `409` if the agent is already stopped or starting.",
    success: {
      description: "Agent transitioning to stopped",
      schema: { type: "object", properties: { state: { type: "string", example: "stopping" } } },
    },
  },
  "POST /v1/agent/restart": {
    summary: "Restart the agent",
    description: "Stop then start (fire-and-forget). Returns `409` during transitions.",
    success: {
      description: "Agent restarting",
      schema: { type: "object", properties: { state: { type: "string", example: "restarting" } } },
    },
  },
  "GET /v1/agent/status": {
    summary: "Agent status",
    success: {
      description: "Current lifecycle state",
      schema: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["stopped", "starting", "running", "stopping"],
          },
          uptime: { type: ["number", "null"], description: "Seconds since start, or null" },
          error: { type: ["string", "null"] },
        },
      },
    },
  },
  "GET /v1/agent/events": {
    summary: "Stream lifecycle events (SSE)",
    description:
      "Server-Sent Events stream of agent state changes. A `ping` event is sent every 30s.",
    success: {
      description: "SSE stream of `status` and `ping` events",
      contentType: "text/event-stream",
      schema: { type: "string" },
    },
  },
  "GET /v1/system/version": {
    summary: "Version information",
    success: {
      description: "Teleton, Node.js, OS and API versions",
      schema: {
        type: "object",
        properties: {
          teleton: { type: "string", example: "0.8.19" },
          node: { type: "string", example: "v22.0.0" },
          os: { type: "string", example: "linux" },
          arch: { type: "string", example: "x64" },
          apiVersion: { type: "string", example: API_VERSION },
        },
      },
    },
  },
  "GET /v1/system/info": {
    summary: "Host system information",
    success: {
      description: "CPU, memory and uptime",
      schema: {
        type: "object",
        properties: {
          cpu: { type: "object" },
          memory: { type: "object" },
          uptime: { type: "object" },
        },
      },
    },
  },
  "POST /v1/auth/validate": {
    summary: "Validate API key",
    description: "Confirms the bearer token is valid without side effects.",
    success: {
      description: "Key is valid",
      schema: {
        type: "object",
        properties: {
          valid: { type: "boolean", example: true },
          keyPrefix: { type: "string", example: "tltn_aBcD" },
        },
      },
    },
  },
  "GET /v1/api-logs/recent": {
    summary: "Recent log lines",
    query: [
      {
        name: "lines",
        description: "Number of lines to return (1–1000)",
        schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
      },
    ],
    success: {
      description: "Recent log entries",
      schema: {
        type: "object",
        properties: {
          lines: { type: "array", items: { type: "object" } },
          count: { type: "integer" },
        },
      },
    },
  },
  "GET /v1/api-logs/stream": {
    summary: "Stream live logs (SSE)",
    success: {
      description: "SSE stream of log entries",
      contentType: "text/event-stream",
      schema: { type: "string" },
    },
  },
  "DELETE /v1/api-memory/sessions/{chatId}": {
    summary: "Delete a chat session",
    description: "Deletes a specific chat session. Returns `404` if not found.",
    success: {
      description: "Session deleted",
      schema: {
        type: "object",
        properties: {
          deleted: { type: "integer", example: 1 },
          chatId: { type: "string" },
        },
      },
    },
  },
  "POST /v1/api-memory/sessions/prune": {
    summary: "Prune old chat sessions",
    requestBody: {
      description: "Maximum session age in days (default 30)",
      schema: {
        type: "object",
        properties: { maxAgeDays: { type: "integer", minimum: 1, default: 30 } },
      },
    },
    success: {
      description: "Sessions pruned",
      schema: {
        type: "object",
        properties: {
          pruned: { type: "integer" },
          maxAgeDays: { type: "integer" },
        },
      },
    },
  },
};
