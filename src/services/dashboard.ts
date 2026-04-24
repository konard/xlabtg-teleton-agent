import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const WIDGET_CATEGORIES = ["metrics", "status", "content", "action", "custom"] as const;
export const WIDGET_RENDERERS = [
  "chart",
  "table",
  "text",
  "markdown",
  "custom",
  "kpi",
  "list",
] as const;
export const WIDGET_DATA_SOURCE_TYPES = ["api", "websocket", "static"] as const;

export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];
export type WidgetRenderer = (typeof WIDGET_RENDERERS)[number];
export type WidgetDataSourceType = (typeof WIDGET_DATA_SOURCE_TYPES)[number];

export interface WidgetDataSource {
  type: WidgetDataSourceType;
  endpoint?: string;
  refreshInterval?: number;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  dataSource: WidgetDataSource;
  renderer: WidgetRenderer;
  defaultSize: { w: number; h: number };
  configSchema: Record<string, unknown>;
  builtIn?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface DashboardWidget {
  id: string;
  definitionId: string;
  title: string | null;
  config: Record<string, unknown>;
  data: unknown;
  pinned: boolean;
  temporary: boolean;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

export type DashboardLayout = Record<string, DashboardLayoutItem[]>;

export interface DashboardProfile {
  id: string;
  name: string;
  description: string | null;
  widgets: DashboardWidget[];
  layout: DashboardLayout;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  widgets: Array<{
    id?: string;
    definitionId: string;
    title?: string | null;
    config?: Record<string, unknown>;
    data?: unknown;
  }>;
}

export interface DashboardExportBundle {
  version: "1.0";
  exportedAt: string;
  dashboard: DashboardProfile;
  definitions: WidgetDefinition[];
}

export interface CreateDashboardInput {
  name: string;
  description?: string | null;
  widgets?: DashboardWidget[];
  layout?: DashboardLayout;
  isDefault?: boolean;
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string | null;
  widgets?: DashboardWidget[];
  layout?: DashboardLayout;
  isDefault?: boolean;
}

export interface AddWidgetInput {
  definitionId?: string;
  definition?: WidgetDefinition;
  id?: string;
  title?: string | null;
  config?: Record<string, unknown>;
  data?: unknown;
  pinned?: boolean;
  temporary?: boolean;
  sessionId?: string | null;
}

export interface UpdateWidgetInput {
  definitionId?: string;
  definition?: WidgetDefinition;
  title?: string | null;
  config?: Record<string, unknown>;
  data?: unknown;
  pinned?: boolean;
  temporary?: boolean;
  sessionId?: string | null;
}

interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  widgets: string;
  layout: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface WidgetDefinitionRow {
  id: string;
  name: string;
  description: string;
  category: string;
  data_source: string;
  renderer: string;
  default_size: string;
  config_schema: string;
  built_in: number;
  created_at: number;
  updated_at: number;
}

const MAX_DASHBOARDS = 50;
const MAX_WIDGETS_PER_DASHBOARD = 20;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_WIDGET_DATA_BYTES = 128 * 1024;
const DEFAULT_TEMPLATE_ID = "operations";

const LEGACY_WIDGET_LAYOUTS: Record<string, { lg: DashboardLayoutItem; md: DashboardLayoutItem }> =
  {
    stats: {
      lg: { i: "stats", x: 0, y: 0, w: 12, h: 2, minH: 2, maxH: 3 },
      md: { i: "stats", x: 0, y: 0, w: 10, h: 2, minH: 2, maxH: 3 },
    },
    agent: {
      lg: { i: "agent", x: 0, y: 2, w: 6, h: 6, minH: 4 },
      md: { i: "agent", x: 0, y: 2, w: 5, h: 6, minH: 4 },
    },
    telegram: {
      lg: { i: "telegram", x: 6, y: 2, w: 6, h: 6, minH: 4 },
      md: { i: "telegram", x: 5, y: 2, w: 5, h: 6, minH: 4 },
    },
    exec: {
      lg: { i: "exec", x: 0, y: 8, w: 12, h: 5, minH: 3 },
      md: { i: "exec", x: 0, y: 8, w: 10, h: 5, minH: 3 },
    },
    "quick-actions": {
      lg: { i: "quick-actions", x: 0, y: 13, w: 12, h: 3, minH: 2 },
      md: { i: "quick-actions", x: 0, y: 13, w: 10, h: 3, minH: 2 },
    },
    predictions: {
      lg: { i: "predictions", x: 0, y: 16, w: 12, h: 5, minH: 3 },
      md: { i: "predictions", x: 0, y: 16, w: 10, h: 5, minH: 3 },
    },
    cache: {
      lg: { i: "cache", x: 0, y: 21, w: 12, h: 5, minH: 3 },
      md: { i: "cache", x: 0, y: 21, w: 10, h: 5, minH: 3 },
    },
    "token-chart": {
      lg: { i: "token-chart", x: 0, y: 26, w: 6, h: 6, minH: 4 },
      md: { i: "token-chart", x: 0, y: 26, w: 5, h: 6, minH: 4 },
    },
    "tool-chart": {
      lg: { i: "tool-chart", x: 6, y: 26, w: 6, h: 6, minH: 4 },
      md: { i: "tool-chart", x: 5, y: 26, w: 5, h: 6, minH: 4 },
    },
    "activity-heatmap": {
      lg: { i: "activity-heatmap", x: 0, y: 32, w: 12, h: 6, minH: 4 },
      md: { i: "activity-heatmap", x: 0, y: 32, w: 10, h: 6, minH: 4 },
    },
    "health-check": {
      lg: { i: "health-check", x: 0, y: 38, w: 12, h: 5, minH: 3 },
      md: { i: "health-check", x: 0, y: 38, w: 10, h: 5, minH: 3 },
    },
    logs: {
      lg: { i: "logs", x: 0, y: 43, w: 12, h: 8, minH: 4 },
      md: { i: "logs", x: 0, y: 43, w: 10, h: 8, minH: 4 },
    },
  };

const BUILT_IN_WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    id: "stats",
    name: "System Stats",
    description: "Uptime, sessions, tools, knowledge, messages, chats, tokens, and cost.",
    category: "metrics",
    dataSource: { type: "api", endpoint: "/api/status", refreshInterval: 10 },
    renderer: "custom",
    defaultSize: { w: 12, h: 2 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "agent",
    name: "Agent Settings",
    description: "Runtime provider, model, and API key settings.",
    category: "status",
    dataSource: { type: "api", endpoint: "/api/config" },
    renderer: "custom",
    defaultSize: { w: 6, h: 6 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "telegram",
    name: "Telegram Settings",
    description: "Telegram API and bot token configuration.",
    category: "status",
    dataSource: { type: "api", endpoint: "/api/config" },
    renderer: "custom",
    defaultSize: { w: 6, h: 6 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "exec",
    name: "Exec Settings",
    description: "Local command execution controls for supported platforms.",
    category: "status",
    dataSource: { type: "api", endpoint: "/api/config" },
    renderer: "custom",
    defaultSize: { w: 12, h: 5 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "quick-actions",
    name: "Quick Actions",
    description: "Common agent control actions.",
    category: "action",
    dataSource: { type: "static" },
    renderer: "custom",
    defaultSize: { w: 12, h: 3 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "predictions",
    name: "Suggested Next Actions",
    description: "Predicted next actions based on recent agent activity.",
    category: "content",
    dataSource: { type: "api", endpoint: "/api/predictions" },
    renderer: "custom",
    defaultSize: { w: 12, h: 5 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "cache",
    name: "Predictive Cache",
    description: "Cache health and preloaded prediction entries.",
    category: "metrics",
    dataSource: { type: "api", endpoint: "/api/cache" },
    renderer: "custom",
    defaultSize: { w: 12, h: 5 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "token-chart",
    name: "Token Usage",
    description: "Token usage trend from metrics data.",
    category: "metrics",
    dataSource: { type: "api", endpoint: "/api/metrics/tokens", refreshInterval: 60 },
    renderer: "custom",
    defaultSize: { w: 6, h: 6 },
    configSchema: { type: "object", properties: { period: { type: "string" } } },
    builtIn: true,
  },
  {
    id: "tool-chart",
    name: "Tool Calls",
    description: "Tool usage trend from metrics data.",
    category: "metrics",
    dataSource: { type: "api", endpoint: "/api/metrics/tools", refreshInterval: 60 },
    renderer: "custom",
    defaultSize: { w: 6, h: 6 },
    configSchema: { type: "object", properties: { period: { type: "string" } } },
    builtIn: true,
  },
  {
    id: "activity-heatmap",
    name: "Activity Heatmap",
    description: "Activity density across the day.",
    category: "metrics",
    dataSource: { type: "api", endpoint: "/api/metrics/activity", refreshInterval: 60 },
    renderer: "custom",
    defaultSize: { w: 12, h: 6 },
    configSchema: { type: "object", properties: { period: { type: "string" } } },
    builtIn: true,
  },
  {
    id: "health-check",
    name: "System Health",
    description: "Health checks for runtime dependencies.",
    category: "status",
    dataSource: { type: "api", endpoint: "/api/health-check", refreshInterval: 30 },
    renderer: "custom",
    defaultSize: { w: 12, h: 5 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "logs",
    name: "Live Logs",
    description: "Streaming Web UI runtime logs.",
    category: "status",
    dataSource: { type: "websocket", endpoint: "/api/logs/stream" },
    renderer: "custom",
    defaultSize: { w: 12, h: 8 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "dynamic-kpi",
    name: "KPI Card",
    description: "Data-driven KPI value with optional label and trend.",
    category: "metrics",
    dataSource: { type: "static" },
    renderer: "kpi",
    defaultSize: { w: 3, h: 2 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "dynamic-text",
    name: "Text",
    description: "Plain text generated by the agent or loaded from an API.",
    category: "content",
    dataSource: { type: "static" },
    renderer: "text",
    defaultSize: { w: 6, h: 3 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "dynamic-markdown",
    name: "Markdown",
    description: "Markdown content generated by the agent or loaded from an API.",
    category: "content",
    dataSource: { type: "static" },
    renderer: "markdown",
    defaultSize: { w: 6, h: 4 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "dynamic-table",
    name: "Table",
    description: "Tabular data from static agent output or API responses.",
    category: "content",
    dataSource: { type: "static" },
    renderer: "table",
    defaultSize: { w: 6, h: 5 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
  {
    id: "dynamic-chart",
    name: "Chart",
    description: "Simple line or bar chart from data points.",
    category: "metrics",
    dataSource: { type: "static" },
    renderer: "chart",
    defaultSize: { w: 6, h: 5 },
    configSchema: {
      type: "object",
      properties: { chartType: { type: "string", enum: ["line", "bar"] } },
    },
    builtIn: true,
  },
  {
    id: "dynamic-list",
    name: "List",
    description: "List of agent-generated items or API records.",
    category: "content",
    dataSource: { type: "static" },
    renderer: "list",
    defaultSize: { w: 6, h: 4 },
    configSchema: { type: "object", properties: {} },
    builtIn: true,
  },
];

const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "operations",
    name: "Operations",
    description: "Live runtime state, health, quick actions, predictions, cache, and logs.",
    widgets: [
      { definitionId: "stats" },
      { definitionId: "agent" },
      { definitionId: "telegram" },
      { definitionId: "exec" },
      { definitionId: "quick-actions" },
      { definitionId: "predictions" },
      { definitionId: "cache" },
      { definitionId: "token-chart" },
      { definitionId: "tool-chart" },
      { definitionId: "activity-heatmap" },
      { definitionId: "health-check" },
      { definitionId: "logs" },
    ],
  },
  {
    id: "development",
    name: "Development",
    description: "Provider configuration, command execution, metrics, and live diagnostics.",
    widgets: [
      { definitionId: "stats" },
      { definitionId: "agent" },
      { definitionId: "exec" },
      { definitionId: "token-chart" },
      { definitionId: "tool-chart" },
      { definitionId: "logs" },
    ],
  },
  {
    id: "security",
    name: "Security",
    description: "Health, logs, quick response actions, and a pinned security note.",
    widgets: [
      { definitionId: "health-check" },
      { definitionId: "logs" },
      { definitionId: "quick-actions" },
      {
        definitionId: "dynamic-markdown",
        title: "Security Notes",
        data: "## Watchlist\nNo active security notes.",
      },
    ],
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Token, tool, and activity trends for repeated review.",
    widgets: [
      { definitionId: "stats" },
      { definitionId: "token-chart" },
      { definitionId: "tool-chart" },
      { definitionId: "activity-heatmap" },
      {
        definitionId: "dynamic-table",
        title: "Tracked Metrics",
        data: [
          { metric: "Token usage", source: "/api/metrics/tokens" },
          { metric: "Tool usage", source: "/api/metrics/tools" },
        ],
      },
    ],
  },
];

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function trimNullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim().slice(0, maxLength) : undefined;
}

function isWidgetCategory(value: unknown): value is WidgetCategory {
  return WIDGET_CATEGORIES.includes(value as WidgetCategory);
}

function isWidgetRenderer(value: unknown): value is WidgetRenderer {
  return WIDGET_RENDERERS.includes(value as WidgetRenderer);
}

function isDataSourceType(value: unknown): value is WidgetDataSourceType {
  return WIDGET_DATA_SOURCE_TYPES.includes(value as WidgetDataSourceType);
}

function assertWidgetId(id: string): void {
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) {
    throw new Error(
      "widget definition id must be 1-80 characters of letters, numbers, _, ., :, or -"
    );
  }
}

function normalizeDataSource(value: unknown): WidgetDataSource {
  if (!isObject(value)) throw new Error("dataSource must be an object");
  if (!isDataSourceType(value.type)) {
    throw new Error(`dataSource.type must be one of: ${WIDGET_DATA_SOURCE_TYPES.join(", ")}`);
  }

  const dataSource: WidgetDataSource = { type: value.type };
  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== "string" || value.endpoint.trim().length === 0) {
      throw new Error("dataSource.endpoint must be a non-empty string");
    }
    const endpoint = value.endpoint.trim();
    if (!endpoint.startsWith("/api/")) {
      throw new Error("widget dataSource.endpoint must be a same-origin /api/ path");
    }
    dataSource.endpoint = endpoint.slice(0, 300);
  }

  if (value.refreshInterval !== undefined) {
    const refreshInterval = Number(value.refreshInterval);
    if (!Number.isInteger(refreshInterval) || refreshInterval < 1 || refreshInterval > 86_400) {
      throw new Error("dataSource.refreshInterval must be an integer between 1 and 86400");
    }
    dataSource.refreshInterval = refreshInterval;
  }

  return dataSource;
}

function normalizeDefaultSize(value: unknown): { w: number; h: number } {
  if (!isObject(value)) throw new Error("defaultSize must be an object");
  const w = Number(value.w);
  const h = Number(value.h);
  if (!Number.isInteger(w) || w < 1 || w > 12) {
    throw new Error("defaultSize.w must be an integer between 1 and 12");
  }
  if (!Number.isInteger(h) || h < 1 || h > 20) {
    throw new Error("defaultSize.h must be an integer between 1 and 20");
  }
  return { w, h };
}

function normalizeDefinition(input: WidgetDefinition): WidgetDefinition {
  const id = trimString(input.id, 80);
  assertWidgetId(id);
  const name = trimString(input.name, MAX_NAME_LENGTH);
  if (!name) throw new Error("widget definition name is required");
  const description = trimString(input.description, MAX_DESCRIPTION_LENGTH);
  if (!isWidgetCategory(input.category)) {
    throw new Error(`category must be one of: ${WIDGET_CATEGORIES.join(", ")}`);
  }
  if (!isWidgetRenderer(input.renderer)) {
    throw new Error(`renderer must be one of: ${WIDGET_RENDERERS.join(", ")}`);
  }
  if (!isObject(input.configSchema)) {
    throw new Error("configSchema must be an object");
  }

  return {
    id,
    name,
    description,
    category: input.category,
    dataSource: normalizeDataSource(input.dataSource),
    renderer: input.renderer,
    defaultSize: normalizeDefaultSize(input.defaultSize),
    configSchema: cloneJson(input.configSchema),
    builtIn: input.builtIn === true,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function normalizeLayoutItem(value: unknown): DashboardLayoutItem {
  if (!isObject(value)) throw new Error("layout items must be objects");
  if (typeof value.i !== "string" || !value.i.trim()) {
    throw new Error("layout item i is required");
  }

  const item: DashboardLayoutItem = {
    i: value.i.trim().slice(0, 120),
    x: parseLayoutInt(value.x, "x", 0, 12),
    y: parseLayoutInt(value.y, "y", 0, 500),
    w: parseLayoutInt(value.w, "w", 1, 12),
    h: parseLayoutInt(value.h, "h", 1, 40),
  };
  for (const key of ["minW", "maxW", "minH", "maxH"] as const) {
    if (value[key] !== undefined) {
      item[key] = parseLayoutInt(value[key], key, 1, key.endsWith("W") ? 12 : 40);
    }
  }
  return item;
}

function parseLayoutInt(value: unknown, field: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`layout item ${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function normalizeLayout(value: unknown): DashboardLayout {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error("layout must be an object");
  const layout: DashboardLayout = {};
  for (const [breakpoint, items] of Object.entries(value)) {
    if (!Array.isArray(items)) throw new Error(`layout.${breakpoint} must be an array`);
    layout[breakpoint.slice(0, 20)] = items.map(normalizeLayoutItem);
  }
  return layout;
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error("widget config must be an object");
  return cloneJson(value);
}

function normalizeWidget(
  input: DashboardWidget,
  definitionExists: (id: string) => boolean
): DashboardWidget {
  const id = trimString(input.id, 120) || randomUUID();
  const definitionId = trimString(input.definitionId, 80);
  if (!definitionId) throw new Error("widget definitionId is required");
  if (!definitionExists(definitionId)) {
    throw new Error(`Unknown widget definition: ${definitionId}`);
  }

  assertWidgetDataSize(input.data);
  const pinned = input.pinned === true;
  return {
    id,
    definitionId,
    title: trimNullableString(input.title, MAX_NAME_LENGTH) ?? null,
    config: normalizeConfig(input.config),
    data: cloneJson(input.data ?? null),
    pinned,
    temporary: pinned ? false : input.temporary === true,
    sessionId: trimNullableString(input.sessionId, MAX_NAME_LENGTH) ?? null,
    createdAt: Number.isInteger(input.createdAt) ? input.createdAt : nowSeconds(),
    updatedAt: Number.isInteger(input.updatedAt) ? input.updatedAt : nowSeconds(),
  };
}

function assertWidgetDataSize(data: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(data ?? null), "utf-8");
  if (size > MAX_WIDGET_DATA_BYTES) {
    throw new Error(`widget data exceeds ${MAX_WIDGET_DATA_BYTES} bytes`);
  }
}

function makeWidgetFromInput(input: AddWidgetInput, definitionId: string): DashboardWidget {
  const now = nowSeconds();
  return normalizeWidget(
    {
      id: input.id ?? randomUUID(),
      definitionId,
      title: input.title ?? null,
      config: input.config ?? {},
      data: input.data ?? null,
      pinned: input.pinned === true,
      temporary: input.temporary === true,
      sessionId: input.sessionId ?? null,
      createdAt: now,
      updatedAt: now,
    },
    () => true
  );
}

function rowToDashboard(row: DashboardRow): DashboardProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    widgets: parseJson<DashboardWidget[]>(row.widgets, []),
    layout: parseJson<DashboardLayout>(row.layout, {}),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDefinition(row: WidgetDefinitionRow): WidgetDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as WidgetCategory,
    dataSource: parseJson<WidgetDataSource>(row.data_source, { type: "static" }),
    renderer: row.renderer as WidgetRenderer,
    defaultSize: parseJson<{ w: number; h: number }>(row.default_size, { w: 6, h: 4 }),
    configSchema: parseJson<Record<string, unknown>>(row.config_schema, {}),
    builtIn: row.built_in === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeLayoutForWidgets(
  widgets: DashboardWidget[],
  lookup: (id: string) => WidgetDefinition
): DashboardLayout {
  const layout: DashboardLayout = { lg: [], md: [] };
  let y = 0;
  for (const widget of widgets) {
    const legacy = LEGACY_WIDGET_LAYOUTS[widget.definitionId];
    if (legacy && widget.id === widget.definitionId) {
      layout.lg.push(cloneJson(legacy.lg));
      layout.md.push(cloneJson(legacy.md));
      y = Math.max(y, legacy.lg.y + legacy.lg.h);
      continue;
    }

    const definition = lookup(widget.definitionId);
    layout.lg.push({
      i: widget.id,
      x: 0,
      y,
      w: definition.defaultSize.w,
      h: definition.defaultSize.h,
    });
    layout.md.push({
      i: widget.id,
      x: 0,
      y,
      w: Math.min(10, definition.defaultSize.w),
      h: definition.defaultSize.h,
    });
    y += definition.defaultSize.h;
  }
  return layout;
}

function appendLayoutItem(
  layout: DashboardLayout,
  widget: DashboardWidget,
  definition: WidgetDefinition
): DashboardLayout {
  const next = cloneJson(layout);
  const breakpoints = new Set([...Object.keys(next), "lg", "md"]);
  for (const breakpoint of breakpoints) {
    const items = next[breakpoint] ?? [];
    if (items.some((item) => item.i === widget.id)) {
      next[breakpoint] = items;
      continue;
    }
    const cols = breakpoint === "lg" ? 12 : breakpoint === "md" ? 10 : 4;
    const y = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    next[breakpoint] = [
      ...items,
      {
        i: widget.id,
        x: 0,
        y,
        w: Math.min(cols, definition.defaultSize.w),
        h: definition.defaultSize.h,
      },
    ];
  }
  return next;
}

function removeLayoutItem(layout: DashboardLayout, widgetId: string): DashboardLayout {
  const next: DashboardLayout = {};
  for (const [breakpoint, items] of Object.entries(layout)) {
    next[breakpoint] = items.filter((item) => item.i !== widgetId);
  }
  return next;
}

function makeTemplateWidgets(template: DashboardTemplate): DashboardWidget[] {
  const now = nowSeconds();
  const used = new Set<string>();
  return template.widgets.map((entry) => {
    let id = entry.id ?? entry.definitionId;
    if (used.has(id)) id = randomUUID();
    used.add(id);
    return {
      id,
      definitionId: entry.definitionId,
      title: entry.title ?? null,
      config: entry.config ?? {},
      data: entry.data ?? null,
      pinned: true,
      temporary: false,
      sessionId: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function ensureDashboardTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS widget_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL CHECK(category IN ('metrics', 'status', 'content', 'action', 'custom')),
      data_source TEXT NOT NULL DEFAULT '{"type":"static"}',
      renderer TEXT NOT NULL CHECK(renderer IN ('chart', 'table', 'text', 'markdown', 'custom', 'kpi', 'list')),
      default_size TEXT NOT NULL DEFAULT '{"w":6,"h":4}',
      config_schema TEXT NOT NULL DEFAULT '{}',
      built_in INTEGER NOT NULL DEFAULT 0 CHECK(built_in IN (0, 1)),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_widget_definitions_category ON widget_definitions(category);
    CREATE INDEX IF NOT EXISTS idx_widget_definitions_renderer ON widget_definitions(renderer);

    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      widgets TEXT NOT NULL DEFAULT '[]',
      layout TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_dashboards_default ON dashboards(is_default) WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS idx_dashboards_created ON dashboards(created_at DESC);
  `);
}

export function getBuiltInWidgetDefinitions(): WidgetDefinition[] {
  return cloneJson(BUILT_IN_WIDGET_DEFINITIONS);
}

export function getDashboardTemplates(): DashboardTemplate[] {
  return cloneJson(DASHBOARD_TEMPLATES);
}

export class DashboardStore {
  constructor(private db: Database.Database) {
    ensureDashboardTables(db);
  }

  list(): DashboardProfile[] {
    this.seedDefaultIfNeeded();
    const rows = this.db
      .prepare("SELECT * FROM dashboards ORDER BY is_default DESC, created_at DESC")
      .all() as DashboardRow[];
    return rows.map(rowToDashboard);
  }

  get(id: string): DashboardProfile | null {
    const row = this.db.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as
      | DashboardRow
      | undefined;
    return row ? rowToDashboard(row) : null;
  }

  create(input: CreateDashboardInput): DashboardProfile {
    if (this.countDashboards() >= MAX_DASHBOARDS) {
      throw new Error(`Maximum ${MAX_DASHBOARDS} dashboards allowed`);
    }

    const name = trimString(input.name, MAX_NAME_LENGTH);
    if (!name) throw new Error("name is required");

    const widgets = this.normalizeWidgets(input.widgets ?? []);
    const layout =
      input.layout !== undefined
        ? normalizeLayout(input.layout)
        : makeLayoutForWidgets(widgets, (id) => this.requireWidgetDefinition(id));
    const isDefault = input.isDefault === true || this.countDashboards() === 0;
    if (isDefault) this.clearDefault();

    const now = nowSeconds();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO dashboards (id, name, description, widgets, layout, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        trimNullableString(input.description, MAX_DESCRIPTION_LENGTH) ?? null,
        JSON.stringify(widgets),
        JSON.stringify(layout),
        isDefault ? 1 : 0,
        now,
        now
      );

    return this.requireDashboard(id);
  }

  createFromTemplate(
    templateId: string,
    overrides: Partial<CreateDashboardInput> = {}
  ): DashboardProfile {
    const template = DASHBOARD_TEMPLATES.find((item) => item.id === templateId);
    if (!template) throw new Error("Dashboard template not found");
    const widgets = makeTemplateWidgets(template);
    const layout = makeLayoutForWidgets(widgets, (id) => this.requireWidgetDefinition(id));
    return this.create({
      name: template.name,
      description: template.description,
      widgets,
      layout,
      ...overrides,
    });
  }

  update(id: string, input: UpdateDashboardInput): DashboardProfile | null {
    const existing = this.get(id);
    if (!existing) return null;

    const nextWidgets =
      input.widgets !== undefined ? this.normalizeWidgets(input.widgets) : existing.widgets;
    const nextLayout = input.layout !== undefined ? normalizeLayout(input.layout) : existing.layout;
    const nextName =
      input.name !== undefined ? trimString(input.name, MAX_NAME_LENGTH) : existing.name;
    if (!nextName) throw new Error("name cannot be empty");

    let isDefault = existing.isDefault;
    if (input.isDefault === true) {
      this.clearDefault();
      isDefault = true;
    } else if (input.isDefault === false && !this.wouldClearOnlyDefault(existing)) {
      isDefault = false;
    }

    const now = nowSeconds();
    this.db
      .prepare(
        `UPDATE dashboards SET
           name = ?,
           description = ?,
           widgets = ?,
           layout = ?,
           is_default = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        nextName,
        input.description !== undefined
          ? (trimNullableString(input.description, MAX_DESCRIPTION_LENGTH) ?? null)
          : existing.description,
        JSON.stringify(nextWidgets),
        JSON.stringify(nextLayout),
        isDefault ? 1 : 0,
        now,
        id
      );

    return this.get(id);
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const result = this.db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
    if (result.changes === 0) return false;

    if (existing.isDefault) this.promoteFirstDashboard();
    this.seedDefaultIfNeeded();
    return true;
  }

  listTemplates(): DashboardTemplate[] {
    return getDashboardTemplates();
  }

  listWidgetDefinitions(): WidgetDefinition[] {
    const customRows = this.db
      .prepare("SELECT * FROM widget_definitions ORDER BY name ASC")
      .all() as WidgetDefinitionRow[];
    return [...getBuiltInWidgetDefinitions(), ...customRows.map(rowToDefinition)];
  }

  getWidgetDefinition(id: string): WidgetDefinition | null {
    const builtIn = BUILT_IN_WIDGET_DEFINITIONS.find((definition) => definition.id === id);
    if (builtIn) return cloneJson(builtIn);
    const row = this.db.prepare("SELECT * FROM widget_definitions WHERE id = ?").get(id) as
      | WidgetDefinitionRow
      | undefined;
    return row ? rowToDefinition(row) : null;
  }

  registerWidgetDefinition(input: WidgetDefinition): WidgetDefinition {
    const definition = normalizeDefinition({ ...input, builtIn: false });
    if (BUILT_IN_WIDGET_DEFINITIONS.some((item) => item.id === definition.id)) {
      throw new Error("Built-in widget definitions cannot be overwritten");
    }

    const now = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO widget_definitions (
           id, name, description, category, data_source, renderer, default_size,
           config_schema, built_in, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           category = excluded.category,
           data_source = excluded.data_source,
           renderer = excluded.renderer,
           default_size = excluded.default_size,
           config_schema = excluded.config_schema,
           built_in = 0,
           updated_at = excluded.updated_at`
      )
      .run(
        definition.id,
        definition.name,
        definition.description,
        definition.category,
        JSON.stringify(definition.dataSource),
        definition.renderer,
        JSON.stringify(definition.defaultSize),
        JSON.stringify(definition.configSchema),
        now,
        now
      );

    return this.requireWidgetDefinition(definition.id);
  }

  listWidgets(dashboardId: string): DashboardWidget[] {
    return this.requireDashboard(dashboardId).widgets;
  }

  addWidget(dashboardId: string, input: AddWidgetInput): DashboardWidget {
    const dashboard = this.requireDashboard(dashboardId);
    if (dashboard.widgets.length >= MAX_WIDGETS_PER_DASHBOARD) {
      throw new Error(`Maximum ${MAX_WIDGETS_PER_DASHBOARD} widgets per dashboard allowed`);
    }

    const definitionId = this.resolveInputDefinition(input);
    const definition = this.requireWidgetDefinition(definitionId);
    const widget = makeWidgetFromInput(input, definitionId);
    if (dashboard.widgets.some((item) => item.id === widget.id)) {
      throw new Error("widget id already exists in this dashboard");
    }

    const nextWidgets = [...dashboard.widgets, widget];
    const nextLayout = appendLayoutItem(dashboard.layout, widget, definition);
    this.persistDashboardWidgets(dashboard.id, nextWidgets, nextLayout);
    return widget;
  }

  updateWidget(
    dashboardId: string,
    widgetId: string,
    input: UpdateWidgetInput
  ): DashboardWidget | null {
    const dashboard = this.requireDashboard(dashboardId);
    const index = dashboard.widgets.findIndex((widget) => widget.id === widgetId);
    if (index < 0) return null;

    const existing = dashboard.widgets[index];
    const definitionId =
      input.definition !== undefined || input.definitionId !== undefined
        ? this.resolveInputDefinition(input)
        : existing.definitionId;
    this.requireWidgetDefinition(definitionId);

    const pinned = input.pinned !== undefined ? input.pinned === true : existing.pinned;
    const updated: DashboardWidget = normalizeWidget(
      {
        ...existing,
        definitionId,
        title: input.title !== undefined ? input.title : existing.title,
        config: input.config !== undefined ? input.config : existing.config,
        data: input.data !== undefined ? input.data : existing.data,
        pinned,
        temporary: pinned
          ? false
          : input.temporary !== undefined
            ? input.temporary === true
            : existing.temporary,
        sessionId: input.sessionId !== undefined ? input.sessionId : existing.sessionId,
        updatedAt: nowSeconds(),
      },
      (idToCheck) => this.getWidgetDefinition(idToCheck) !== null
    );

    const nextWidgets = [...dashboard.widgets];
    nextWidgets[index] = updated;
    this.persistDashboardWidgets(dashboard.id, nextWidgets, dashboard.layout);
    return updated;
  }

  deleteWidget(dashboardId: string, widgetId: string): boolean {
    const dashboard = this.requireDashboard(dashboardId);
    const nextWidgets = dashboard.widgets.filter((widget) => widget.id !== widgetId);
    if (nextWidgets.length === dashboard.widgets.length) return false;
    this.persistDashboardWidgets(
      dashboard.id,
      nextWidgets,
      removeLayoutItem(dashboard.layout, widgetId)
    );
    return true;
  }

  exportDashboard(id: string): DashboardExportBundle {
    const dashboard = this.requireDashboard(id);
    const definitionIds = new Set(dashboard.widgets.map((widget) => widget.definitionId));
    const definitions = [...definitionIds]
      .map((definitionId) => this.requireWidgetDefinition(definitionId))
      .filter((definition) => definition.builtIn !== true);

    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      dashboard: cloneJson(dashboard),
      definitions,
    };
  }

  importDashboard(
    bundle: DashboardExportBundle,
    options: Partial<Pick<CreateDashboardInput, "name" | "description" | "isDefault">> = {}
  ): DashboardProfile {
    if (!bundle || bundle.version !== "1.0") {
      throw new Error("Invalid dashboard export bundle. Expected version 1.0");
    }
    if (!bundle.dashboard || typeof bundle.dashboard.name !== "string") {
      throw new Error("Invalid dashboard export bundle: dashboard is required");
    }

    for (const definition of bundle.definitions ?? []) {
      this.registerWidgetDefinition(definition);
    }

    return this.create({
      name: options.name ?? `${bundle.dashboard.name} Copy`,
      description:
        options.description !== undefined ? options.description : bundle.dashboard.description,
      widgets: bundle.dashboard.widgets,
      layout: bundle.dashboard.layout,
      isDefault: options.isDefault,
    });
  }

  private resolveInputDefinition(input: AddWidgetInput | UpdateWidgetInput): string {
    if (input.definition) {
      return this.registerWidgetDefinition(input.definition).id;
    }
    const definitionId = trimString(input.definitionId, 80);
    if (!definitionId) throw new Error("definitionId is required");
    if (!this.getWidgetDefinition(definitionId)) {
      throw new Error(`Unknown widget definition: ${definitionId}`);
    }
    return definitionId;
  }

  private normalizeWidgets(widgets: DashboardWidget[]): DashboardWidget[] {
    if (!Array.isArray(widgets)) throw new Error("widgets must be an array");
    if (widgets.length > MAX_WIDGETS_PER_DASHBOARD) {
      throw new Error(`Maximum ${MAX_WIDGETS_PER_DASHBOARD} widgets per dashboard allowed`);
    }
    const seen = new Set<string>();
    return widgets.map((widget) => {
      const normalized = normalizeWidget(widget, (id) => this.getWidgetDefinition(id) !== null);
      if (seen.has(normalized.id)) throw new Error("dashboard widget ids must be unique");
      seen.add(normalized.id);
      return normalized;
    });
  }

  private persistDashboardWidgets(
    dashboardId: string,
    widgets: DashboardWidget[],
    layout: DashboardLayout
  ): void {
    this.db
      .prepare("UPDATE dashboards SET widgets = ?, layout = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(widgets), JSON.stringify(layout), nowSeconds(), dashboardId);
  }

  private requireDashboard(id: string): DashboardProfile {
    const dashboard = this.get(id);
    if (!dashboard) throw new Error("Dashboard not found");
    return dashboard;
  }

  private requireWidgetDefinition(id: string): WidgetDefinition {
    const definition = this.getWidgetDefinition(id);
    if (!definition) throw new Error(`Unknown widget definition: ${id}`);
    return definition;
  }

  private countDashboards(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM dashboards").get() as {
      count: number;
    };
    return row.count;
  }

  private countDefaultDashboards(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM dashboards WHERE is_default = 1")
      .get() as { count: number };
    return row.count;
  }

  private clearDefault(): void {
    this.db.prepare("UPDATE dashboards SET is_default = 0").run();
  }

  private wouldClearOnlyDefault(existing: DashboardProfile): boolean {
    return existing.isDefault && this.countDefaultDashboards() <= 1;
  }

  private promoteFirstDashboard(): void {
    const row = this.db
      .prepare("SELECT id FROM dashboards ORDER BY created_at DESC LIMIT 1")
      .get() as { id: string } | undefined;
    if (row) {
      this.db.prepare("UPDATE dashboards SET is_default = 1 WHERE id = ?").run(row.id);
    }
  }

  private seedDefaultIfNeeded(): void {
    if (this.countDashboards() > 0) return;
    this.createFromTemplate(DEFAULT_TEMPLATE_ID, { isDefault: true });
  }
}

export function getDashboardStore(db: Database.Database): DashboardStore {
  return new DashboardStore(db);
}
