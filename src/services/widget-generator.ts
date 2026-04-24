import type {
  DataSourceCatalog,
  WidgetDataSourceDefinition,
  WidgetDataSourceField,
} from "./data-source-catalog.js";

export type GeneratedWidgetRenderer = "chart" | "table" | "kpi" | "list" | "markdown";
export type GeneratedWidgetChartType = "line" | "bar" | "pie";
export type GeneratedWidgetPalette = "default" | "blue" | "green" | "purple" | "orange" | "red";

export interface GeneratedWidgetDataSourceRef {
  id: string;
  endpoint: string;
  method: "GET";
  params?: Record<string, string>;
  refreshInterval: number;
}

export interface GeneratedWidgetConfig {
  chartType?: GeneratedWidgetChartType;
  xKey?: string;
  yKey?: string;
  categoryKey?: string;
  valueKey?: string;
  labelKey?: string;
  columns?: string[];
  markdown?: string;
  aggregate?: "first" | "sum" | "average";
}

export interface GeneratedWidgetDefinition {
  id: string;
  title: string;
  description: string;
  renderer: GeneratedWidgetRenderer;
  dataSource: GeneratedWidgetDataSourceRef;
  config: GeneratedWidgetConfig;
  style: {
    palette: GeneratedWidgetPalette;
  };
  defaultSize: {
    w: number;
    h: number;
  };
  generatedFrom: string;
  refinementHistory: Array<{
    prompt: string;
    appliedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetGenerationTemplate {
  id: string;
  label: string;
  prompt: string;
  renderer: GeneratedWidgetRenderer;
  chartType?: GeneratedWidgetChartType;
}

export interface WidgetValidationResult {
  valid: boolean;
  issues: string[];
}

export interface WidgetGenerationResult {
  definition: GeneratedWidgetDefinition;
  validation: WidgetValidationResult;
  suggestions: string[];
}

export interface GenerateWidgetInput {
  prompt: string;
  dataSample?: unknown;
}

export interface RefineWidgetInput {
  prompt: string;
  widget: GeneratedWidgetDefinition;
}

export const WIDGET_GENERATION_TEMPLATES: WidgetGenerationTemplate[] = [
  {
    id: "over-time",
    label: "Show X over time",
    prompt: "Show token usage over time for the last 7 days",
    renderer: "chart",
    chartType: "line",
  },
  {
    id: "compare",
    label: "Compare X across categories",
    prompt: "Compare tool usage across categories for the last 7 days",
    renderer: "chart",
    chartType: "bar",
  },
  {
    id: "percentage",
    label: "Show percentage breakdown",
    prompt: "What percentage of tool calls are from each tool this month?",
    renderer: "chart",
    chartType: "pie",
  },
  {
    id: "recent-list",
    label: "List recent X",
    prompt: "List recent tasks with their status",
    renderer: "table",
  },
  {
    id: "current-value",
    label: "Current value of X",
    prompt: "Show the current number of configured tools",
    renderer: "kpi",
  },
];

const DEFAULT_REFRESH_INTERVAL = 30_000;

export class WidgetGeneratorService {
  constructor(private readonly catalog: DataSourceCatalog) {}

  templates(): WidgetGenerationTemplate[] {
    return WIDGET_GENERATION_TEMPLATES.map((template) => ({ ...template }));
  }

  generate(input: GenerateWidgetInput): WidgetGenerationResult {
    const prompt = normalizePrompt(input.prompt);
    const source = this.pickDataSource(prompt);
    const renderer = inferRenderer(prompt, source);
    const chartType = inferChartType(prompt, source);
    const period = inferPeriod(prompt, source);
    const now = new Date().toISOString();

    const definition: GeneratedWidgetDefinition = {
      id: createWidgetId(prompt),
      title: inferTitle(prompt, source),
      description: prompt,
      renderer,
      dataSource: {
        id: source.id,
        endpoint: source.endpoint,
        method: source.method,
        params: period ? { period } : undefined,
        refreshInterval: inferRefreshInterval(prompt),
      },
      config: buildWidgetConfig(source, renderer, chartType, prompt),
      style: {
        palette: inferPalette(prompt),
      },
      defaultSize: inferDefaultSize(renderer, chartType),
      generatedFrom: prompt,
      refinementHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    return {
      definition,
      validation: this.validateDefinition(definition),
      suggestions: buildSuggestions(definition),
    };
  }

  refine(input: RefineWidgetInput): WidgetGenerationResult {
    const prompt = normalizePrompt(input.prompt);
    const source = this.catalog.get(input.widget.dataSource.id);
    if (!source) {
      throw new Error(`Unknown widget data source: ${input.widget.dataSource.id}`);
    }

    const chartType = inferChartType(prompt, source, input.widget.config.chartType);
    const renderer = inferRenderer(prompt, source, input.widget.renderer, chartType);
    const period = inferPeriod(prompt, source, input.widget.dataSource.params?.period);
    const palette = inferPalette(prompt, input.widget.style.palette);
    const updatedAt = new Date().toISOString();
    const config = buildWidgetConfig(source, renderer, chartType, input.widget.generatedFrom);

    const definition: GeneratedWidgetDefinition = {
      ...input.widget,
      renderer,
      dataSource: {
        ...input.widget.dataSource,
        params: period
          ? { ...(input.widget.dataSource.params ?? {}), period }
          : input.widget.dataSource.params,
      },
      config,
      style: {
        palette,
      },
      defaultSize: inferDefaultSize(renderer, chartType),
      refinementHistory: [
        ...input.widget.refinementHistory,
        {
          prompt,
          appliedAt: updatedAt,
        },
      ],
      updatedAt,
    };

    return {
      definition,
      validation: this.validateDefinition(definition),
      suggestions: buildSuggestions(definition),
    };
  }

  validateDefinition(definition: GeneratedWidgetDefinition): WidgetValidationResult {
    const issues: string[] = [];
    const source = this.catalog.get(definition.dataSource.id);

    if (!source) {
      issues.push(`Unknown data source: ${definition.dataSource.id}`);
    } else if (definition.dataSource.endpoint !== source.endpoint) {
      issues.push(`Endpoint mismatch for data source ${source.id}`);
    }

    if (!definition.title.trim()) issues.push("title is required");
    if (!definition.description.trim()) issues.push("description is required");
    if (!definition.dataSource.refreshInterval || definition.dataSource.refreshInterval < 5_000) {
      issues.push("refreshInterval must be at least 5000ms");
    }

    if (definition.renderer === "chart" && !definition.config.chartType) {
      issues.push("chart widgets require chartType");
    }
    if (definition.renderer === "chart" && !definition.config.valueKey && !definition.config.yKey) {
      issues.push("chart widgets require valueKey or yKey");
    }
    if (definition.renderer === "kpi" && !definition.config.valueKey) {
      issues.push("KPI widgets require valueKey");
    }
    if (
      definition.renderer === "table" &&
      (!definition.config.columns || definition.config.columns.length === 0)
    ) {
      issues.push("table widgets require columns");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  getDataSource(id: string): WidgetDataSourceDefinition | undefined {
    return this.catalog.get(id);
  }

  listDataSources(): WidgetDataSourceDefinition[] {
    return this.catalog.list();
  }

  fieldsForDefinition(definition: GeneratedWidgetDefinition): WidgetDataSourceField[] {
    return this.catalog.get(definition.dataSource.id)?.fields ?? [];
  }

  private pickDataSource(prompt: string): WidgetDataSourceDefinition {
    const normalized = prompt.toLowerCase();
    if (
      normalized.includes("by hour") ||
      normalized.includes("hourly") ||
      normalized.includes("heatmap")
    ) {
      return this.catalog.get("metrics.activity") ?? this.catalog.findBest(prompt);
    }
    if (
      normalized.includes("token") ||
      normalized.includes("cost") ||
      normalized.includes("spend")
    ) {
      return this.catalog.get("metrics.tokens") ?? this.catalog.findBest(prompt);
    }
    if (normalized.includes("task") || normalized.includes("queue")) {
      return this.catalog.get("tasks.list") ?? this.catalog.findBest(prompt);
    }
    if (normalized.includes("memory") || normalized.includes("knowledge")) {
      return this.catalog.get("memory.stats") ?? this.catalog.findBest(prompt);
    }
    if (
      normalized.includes("performance") ||
      normalized.includes("latency") ||
      normalized.includes("error") ||
      normalized.includes("success")
    ) {
      return this.catalog.get("analytics.performance") ?? this.catalog.findBest(prompt);
    }
    if (
      normalized.includes("status") ||
      normalized.includes("uptime") ||
      normalized.includes("model")
    ) {
      return this.catalog.get("status.overview") ?? this.catalog.findBest(prompt);
    }
    if (normalized.includes("prediction") || normalized.includes("suggestion")) {
      return this.catalog.get("predictions.next") ?? this.catalog.findBest(prompt);
    }
    return this.catalog.findBest(prompt);
  }
}

function normalizePrompt(prompt: string | undefined): string {
  const normalized = prompt?.trim() ?? "";
  if (!normalized) throw new Error("prompt is required");
  if (normalized.length > 1_000) throw new Error("prompt is too long");
  return normalized;
}

function createWidgetId(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash * 31 + prompt.charCodeAt(i)) >>> 0;
  }
  return `generated:${slug || "widget"}:${hash.toString(36)}`;
}

function inferRenderer(
  prompt: string,
  source: WidgetDataSourceDefinition,
  fallback?: GeneratedWidgetRenderer,
  chartType?: GeneratedWidgetChartType
): GeneratedWidgetRenderer {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("markdown") || normalized.includes("text summary")) return "markdown";
  if (normalized.includes("table") || normalized.includes("list recent")) return "table";
  if (normalized.includes("list") && source.rendererHints.includes("list")) return "list";
  if (
    normalized.includes("current") ||
    normalized.includes("number of") ||
    normalized.includes("total") ||
    normalized.includes("kpi")
  ) {
    return "kpi";
  }
  if (chartType || source.rendererHints.some((hint) => ["line", "bar", "pie"].includes(hint))) {
    return "chart";
  }
  return fallback ?? "table";
}

function inferChartType(
  prompt: string,
  source: WidgetDataSourceDefinition,
  fallback?: GeneratedWidgetChartType
): GeneratedWidgetChartType {
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes("pie") ||
    normalized.includes("percentage") ||
    normalized.includes("percent") ||
    normalized.includes("share") ||
    normalized.includes("breakdown")
  ) {
    return "pie";
  }
  if (
    normalized.includes("line") ||
    normalized.includes("trend") ||
    normalized.includes("over time") ||
    source.rendererHints.includes("line")
  ) {
    return "line";
  }
  if (
    normalized.includes("bar") ||
    normalized.includes("compare") ||
    source.rendererHints.includes("bar")
  ) {
    return "bar";
  }
  return fallback ?? "bar";
}

function inferPeriod(
  prompt: string,
  source: WidgetDataSourceDefinition,
  fallback?: string
): string | undefined {
  if (!source.params?.some((param) => param.key === "period")) return undefined;
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes("30 day") ||
    normalized.includes("30-day") ||
    normalized.includes("month")
  ) {
    return "30d";
  }
  if (normalized.includes("7 day") || normalized.includes("7-day") || normalized.includes("week")) {
    return "7d";
  }
  if (normalized.includes("24h") || normalized.includes("today") || normalized.includes("day")) {
    return "24h";
  }
  return fallback ?? source.params.find((param) => param.key === "period")?.defaultValue;
}

function inferPalette(
  prompt: string,
  fallback: GeneratedWidgetPalette = "default"
): GeneratedWidgetPalette {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("blue")) return "blue";
  if (normalized.includes("green")) return "green";
  if (normalized.includes("purple")) return "purple";
  if (normalized.includes("orange")) return "orange";
  if (normalized.includes("red")) return "red";
  return fallback;
}

function inferRefreshInterval(prompt: string): number {
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes("live") ||
    normalized.includes("real time") ||
    normalized.includes("realtime")
  ) {
    return 10_000;
  }
  if (normalized.includes("hourly")) return 60_000;
  return DEFAULT_REFRESH_INTERVAL;
}

function inferDefaultSize(
  renderer: GeneratedWidgetRenderer,
  chartType?: GeneratedWidgetChartType
): { w: number; h: number } {
  if (renderer === "kpi") return { w: 3, h: 3 };
  if (renderer === "table") return { w: 6, h: 5 };
  if (renderer === "list") return { w: 5, h: 5 };
  if (renderer === "markdown") return { w: 6, h: 4 };
  if (chartType === "pie") return { w: 5, h: 5 };
  return { w: 6, h: 5 };
}

function inferTitle(prompt: string, source: WidgetDataSourceDefinition): string {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("error")) return "Errors";
  if (normalized.includes("cost") || normalized.includes("spend")) return "Cost";
  if (normalized.includes("hour"))
    return source.id === "metrics.tools" ? "Tool Usage by Hour" : source.name;
  return source.name;
}

function buildWidgetConfig(
  source: WidgetDataSourceDefinition,
  renderer: GeneratedWidgetRenderer,
  chartType: GeneratedWidgetChartType,
  prompt: string
): GeneratedWidgetConfig {
  if (renderer === "markdown") {
    return {
      markdown: `### ${source.name}\n\n${prompt}`,
    };
  }

  if (renderer === "table") {
    return {
      columns: source.fields.map((field) => field.key),
    };
  }

  if (renderer === "list") {
    const labelKey = source.fields[0]?.key ?? "label";
    const valueKey = source.fields.find((field) => field.type === "number")?.key;
    return {
      labelKey,
      valueKey,
    };
  }

  if (renderer === "kpi") {
    const valueKey = pickValueKey(source);
    const labelKey = source.fields.find((field) => field.key !== valueKey)?.key;
    return {
      valueKey,
      labelKey,
      aggregate: source.id.startsWith("metrics.") ? "sum" : "first",
    };
  }

  if (chartType === "line") {
    return {
      chartType,
      xKey: source.fields.find((field) => field.type === "timestamp")?.key ?? source.fields[0]?.key,
      yKey: pickValueKey(source),
    };
  }

  return {
    chartType,
    categoryKey: pickCategoryKey(source),
    valueKey: pickValueKey(source),
  };
}

function pickCategoryKey(source: WidgetDataSourceDefinition): string {
  return (
    source.fields.find((field) => field.type === "string")?.key ??
    source.fields.find((field) => field.key === "hour")?.key ??
    source.fields[0]?.key ??
    "label"
  );
}

function pickValueKey(source: WidgetDataSourceDefinition): string {
  return (
    source.fields.find((field) => field.type === "number")?.key ?? source.fields[0]?.key ?? "value"
  );
}

function buildSuggestions(definition: GeneratedWidgetDefinition): string[] {
  const suggestions = ["Change chart type", "Adjust time period", "Switch to a table"];
  if (definition.renderer === "chart" && definition.config.chartType !== "pie") {
    suggestions.push("Show percentage breakdown");
  }
  if (definition.dataSource.params?.period !== "30d") {
    suggestions.push("Use the last 30 days");
  }
  return suggestions;
}
