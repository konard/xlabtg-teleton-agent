export type WidgetDataType = "string" | "number" | "timestamp" | "boolean" | "object";

export type WidgetDataSourceCategory =
  | "metrics"
  | "status"
  | "memory"
  | "analytics"
  | "tasks"
  | "predictions";

export type WidgetRendererHint = "line" | "bar" | "pie" | "table" | "kpi" | "list";

export interface WidgetDataSourceField {
  key: string;
  label: string;
  type: WidgetDataType;
  description?: string;
}

export interface WidgetDataSourceParam {
  key: string;
  label: string;
  defaultValue: string;
  values: string[];
}

export interface WidgetDataSourceDefinition {
  id: string;
  name: string;
  description: string;
  category: WidgetDataSourceCategory;
  endpoint: string;
  method: "GET";
  fields: WidgetDataSourceField[];
  params?: WidgetDataSourceParam[];
  rendererHints: WidgetRendererHint[];
  keywords: string[];
}

export class DataSourceCatalog {
  private readonly sources: WidgetDataSourceDefinition[];

  constructor(sources: WidgetDataSourceDefinition[]) {
    this.sources = sources;
  }

  list(): WidgetDataSourceDefinition[] {
    return this.sources.map((source) => ({ ...source, fields: [...source.fields] }));
  }

  get(id: string): WidgetDataSourceDefinition | undefined {
    const source = this.sources.find((entry) => entry.id === id);
    return source ? { ...source, fields: [...source.fields] } : undefined;
  }

  findBest(description: string): WidgetDataSourceDefinition {
    const normalized = description.toLowerCase();
    let best = this.sources[0];
    let bestScore = -1;

    for (const source of this.sources) {
      const score = source.keywords.reduce(
        (total, keyword) => total + (normalized.includes(keyword) ? 1 : 0),
        0
      );
      if (score > bestScore) {
        best = source;
        bestScore = score;
      }
    }

    return best;
  }
}

const PERIOD_PARAM: WidgetDataSourceParam = {
  key: "period",
  label: "Period",
  defaultValue: "7d",
  values: ["24h", "7d", "30d"],
};

export function createDataSourceCatalog(): DataSourceCatalog {
  return new DataSourceCatalog([
    {
      id: "metrics.tools",
      name: "Tool Usage",
      description: "Tool invocation counts aggregated over a selected period.",
      category: "metrics",
      endpoint: "/api/metrics/tools",
      method: "GET",
      params: [PERIOD_PARAM],
      fields: [
        { key: "tool", label: "Tool", type: "string" },
        { key: "count", label: "Calls", type: "number" },
      ],
      rendererHints: ["bar", "pie", "table"],
      keywords: ["tool", "tools", "call", "calls", "usage", "invocation", "compare"],
    },
    {
      id: "metrics.tokens",
      name: "Token Usage",
      description: "Token and cost usage bucketed by hour.",
      category: "metrics",
      endpoint: "/api/metrics/tokens",
      method: "GET",
      params: [PERIOD_PARAM],
      fields: [
        { key: "timestamp", label: "Time", type: "timestamp" },
        { key: "tokens", label: "Tokens", type: "number" },
        { key: "cost", label: "Cost", type: "number" },
      ],
      rendererHints: ["line", "table", "kpi"],
      keywords: ["token", "tokens", "cost", "spend", "usage", "trend", "time"],
    },
    {
      id: "metrics.activity",
      name: "Activity by Hour",
      description: "Activity counts by day of week and hour.",
      category: "metrics",
      endpoint: "/api/metrics/activity",
      method: "GET",
      params: [PERIOD_PARAM],
      fields: [
        { key: "dayOfWeek", label: "Day", type: "number" },
        { key: "hour", label: "Hour", type: "number" },
        { key: "count", label: "Activity", type: "number" },
      ],
      rendererHints: ["bar", "table"],
      keywords: ["activity", "hour", "hourly", "heatmap", "time", "by hour"],
    },
    {
      id: "status.overview",
      name: "System Status",
      description: "Current runtime, provider, session, tool, and token totals.",
      category: "status",
      endpoint: "/api/status",
      method: "GET",
      fields: [
        { key: "uptime", label: "Uptime", type: "number" },
        { key: "model", label: "Model", type: "string" },
        { key: "provider", label: "Provider", type: "string" },
        { key: "sessionCount", label: "Sessions", type: "number" },
        { key: "toolCount", label: "Tools", type: "number" },
        { key: "totalTokens", label: "Tokens", type: "number" },
      ],
      rendererHints: ["kpi", "table"],
      keywords: ["status", "current", "runtime", "uptime", "provider", "model", "system"],
    },
    {
      id: "memory.stats",
      name: "Memory Stats",
      description: "Knowledge, message, chat, and session counts.",
      category: "memory",
      endpoint: "/api/memory/stats",
      method: "GET",
      fields: [
        { key: "knowledge", label: "Knowledge", type: "number" },
        { key: "messages", label: "Messages", type: "number" },
        { key: "chats", label: "Chats", type: "number" },
        { key: "sessions", label: "Sessions", type: "number" },
      ],
      rendererHints: ["kpi", "bar", "table"],
      keywords: ["memory", "knowledge", "messages", "chats", "sessions"],
    },
    {
      id: "analytics.performance",
      name: "Performance",
      description: "Request latency, success rate, and error summaries.",
      category: "analytics",
      endpoint: "/api/analytics/performance",
      method: "GET",
      params: [PERIOD_PARAM],
      fields: [
        { key: "totalRequests", label: "Requests", type: "number" },
        { key: "errorCount", label: "Errors", type: "number" },
        { key: "successRate", label: "Success Rate", type: "number" },
        { key: "avgResponseMs", label: "Avg Response", type: "number" },
        { key: "p95Ms", label: "P95", type: "number" },
      ],
      rendererHints: ["kpi", "table", "bar"],
      keywords: ["performance", "latency", "error", "errors", "success", "response"],
    },
    {
      id: "tasks.list",
      name: "Tasks",
      description: "Recent task queue entries and status.",
      category: "tasks",
      endpoint: "/api/tasks",
      method: "GET",
      fields: [
        { key: "description", label: "Task", type: "string" },
        { key: "status", label: "Status", type: "string" },
        { key: "priority", label: "Priority", type: "number" },
        { key: "createdAt", label: "Created", type: "timestamp" },
      ],
      rendererHints: ["table", "list"],
      keywords: ["task", "tasks", "queue", "recent", "list", "status"],
    },
    {
      id: "predictions.next",
      name: "Predictions",
      description: "Predicted next actions with confidence scores.",
      category: "predictions",
      endpoint: "/api/predictions/next",
      method: "GET",
      fields: [
        { key: "action", label: "Action", type: "string" },
        { key: "confidence", label: "Confidence", type: "number" },
        { key: "reason", label: "Reason", type: "string" },
      ],
      rendererHints: ["list", "table"],
      keywords: ["prediction", "predictions", "next", "suggestion", "suggestions", "action"],
    },
  ]);
}
