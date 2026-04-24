import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ResponsiveGridLayout,
  Layout,
  ResponsiveLayouts,
  useContainerWidth,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { WidgetWrapper } from "./WidgetWrapper";
import { StatsWidget } from "./StatsWidget";
import { LogsWidget } from "./LogsWidget";
import { AgentSettingsWidget } from "./AgentSettingsWidget";
import { TelegramSettingsWidget } from "./TelegramSettingsWidget";
import { ExecSettingsWidget } from "./ExecSettingsWidget";
import { PredictionsWidget } from "./PredictionsWidget";
import { CacheWidget } from "./CacheWidget";
import { DynamicWidgetRenderer } from "./DynamicWidgetRenderer";
import { GeneratedWidgetRenderer } from "./GeneratedWidgetRenderer";
import { WidgetGeneratorPanel } from "./WidgetGeneratorPanel";
import { QuickActions } from "../QuickActions";
import { HealthCheck } from "../HealthCheck";
import {
  api,
  type DashboardExportBundle,
  type DashboardLayout,
  type DashboardLayoutItem,
  type DashboardProfileData,
  type DashboardTemplateData,
  type DashboardWidgetData,
  type GeneratedWidgetDefinition,
  type StatusData,
  type WidgetCategory,
  type WidgetDefinition,
} from "../../lib/api";
import { ProviderMeta } from "../../hooks/useConfigState";

const TokenUsageChart = lazy(() =>
  import("../charts/TokenUsageChart").then((m) => ({ default: m.TokenUsageChart }))
);
const ToolUsageChart = lazy(() =>
  import("../charts/ToolUsageChart").then((m) => ({ default: m.ToolUsageChart }))
);
const ActivityHeatmap = lazy(() =>
  import("../charts/ActivityHeatmap").then((m) => ({ default: m.ActivityHeatmap }))
);

const CUSTOM_RENDERER_IDS = new Set([
  "stats",
  "logs",
  "agent",
  "telegram",
  "exec",
  "predictions",
  "cache",
  "quick-actions",
  "token-chart",
  "tool-chart",
  "activity-heatmap",
  "health-check",
]);

const LEGACY_LAYOUTS: Record<string, { lg: DashboardLayoutItem; md: DashboardLayoutItem }> = {
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

const OPEN_WIDGET_GENERATOR_EVENT = "teleton:open-widget-generator";
const OPEN_WIDGET_GENERATOR_STORAGE_KEY = "teleton:open-widget-generator";
const GENERATED_WIDGET_CONFIG_KEY = "generatedDefinition";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeneratedWidgetDefinition(value: unknown): value is GeneratedWidgetDefinition {
  if (!isRecord(value)) return false;
  const dataSource = value.dataSource;
  const style = value.style;
  const config = value.config;
  const defaultSize = value.defaultSize;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.renderer === "string" &&
    isRecord(dataSource) &&
    typeof dataSource.id === "string" &&
    typeof dataSource.endpoint === "string" &&
    isRecord(style) &&
    typeof style.palette === "string" &&
    isRecord(config) &&
    isRecord(defaultSize) &&
    typeof defaultSize.w === "number" &&
    typeof defaultSize.h === "number"
  );
}

function generatedWidgetFromConfig(widget: DashboardWidgetData): GeneratedWidgetDefinition | null {
  const value = widget.config[GENERATED_WIDGET_CONFIG_KEY];
  return isGeneratedWidgetDefinition(value) ? value : null;
}

function mapGeneratedCategory(definition: GeneratedWidgetDefinition): WidgetCategory {
  const sourceId = definition.dataSource.id;
  if (sourceId.startsWith("status.")) return "status";
  if (sourceId.startsWith("tasks.") || sourceId.startsWith("predictions.")) return "action";
  if (sourceId.startsWith("memory.")) return "content";
  return "metrics";
}

function toDashboardDefinition(definition: GeneratedWidgetDefinition): WidgetDefinition {
  return {
    id: definition.id,
    name: definition.title,
    description: definition.description,
    category: mapGeneratedCategory(definition),
    dataSource: { type: "static" },
    renderer: "custom",
    defaultSize: definition.defaultSize,
    configSchema: {
      type: "object",
      properties: {
        [GENERATED_WIDGET_CONFIG_KEY]: { type: "object" },
      },
    },
  };
}

interface DashboardGridProps {
  status: StatusData;
  stats: { knowledge: number; messages: number; chats: number };
  showExec: boolean;
  getLocal: (key: string) => string;
  getServer: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal: (key: string) => void;
  modelOptions: Array<{ value: string; name: string }>;
  pendingProvider: string | null;
  pendingMeta: ProviderMeta | null;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  handleProviderChange: (provider: string) => Promise<void>;
  handleProviderConfirm: () => Promise<void>;
  handleProviderCancel: () => void;
}

function pickSelectedDashboard(
  dashboards: DashboardProfileData[],
  preferredId?: string
): DashboardProfileData | null {
  return (
    dashboards.find((dashboard) => dashboard.id === preferredId) ??
    dashboards.find((dashboard) => dashboard.isDefault) ??
    dashboards[0] ??
    null
  );
}

function definitionTitle(widget: DashboardWidgetData, definition?: WidgetDefinition): string {
  return widget.title || definition?.name || widget.definitionId;
}

function defaultWidgetData(definition: WidgetDefinition): unknown {
  switch (definition.renderer) {
    case "kpi":
      return { label: definition.name, value: 0 };
    case "markdown":
      return `## ${definition.name}`;
    case "table":
      return [];
    case "chart":
      return [];
    case "list":
      return [];
    case "text":
    case "custom":
      return "";
  }
}

function buildLayout(
  widgets: DashboardWidgetData[],
  catalog: WidgetDefinition[],
  showExec: boolean
): DashboardLayout {
  const layout: DashboardLayout = { lg: [], md: [] };
  let y = 0;
  for (const widget of widgets) {
    if (widget.definitionId === "exec" && !showExec) continue;
    const legacy = LEGACY_LAYOUTS[widget.definitionId];
    if (legacy && widget.id === widget.definitionId) {
      layout.lg.push({ ...legacy.lg });
      layout.md.push({ ...legacy.md });
      y = Math.max(y, legacy.lg.y + legacy.lg.h);
      continue;
    }
    const definition = catalog.find((item) => item.id === widget.definitionId);
    const size = definition?.defaultSize ?? { w: 6, h: 4 };
    layout.lg.push({ i: widget.id, x: 0, y, w: size.w, h: size.h });
    layout.md.push({ i: widget.id, x: 0, y, w: Math.min(10, size.w), h: size.h });
    y += size.h;
  }
  return layout;
}

function parseWidgetData(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

function formatWidgetData(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

interface WidgetConfigPanelProps {
  widget: DashboardWidgetData;
  definition: WidgetDefinition;
  saving: boolean;
  onClose: () => void;
  onSave: (
    widget: DashboardWidgetData,
    data: {
      title: string | null;
      data: unknown;
      config: Record<string, unknown>;
      pinned: boolean;
      temporary: boolean;
    }
  ) => Promise<void>;
}

function WidgetConfigPanel({
  widget,
  definition,
  saving,
  onClose,
  onSave,
}: WidgetConfigPanelProps) {
  const [title, setTitle] = useState(widget.title ?? definition.name);
  const [dataText, setDataText] = useState(formatWidgetData(widget.data));
  const [chartType, setChartType] = useState(widget.config.chartType === "bar" ? "bar" : "line");
  const [pinned, setPinned] = useState(widget.pinned);
  const [temporary, setTemporary] = useState(widget.temporary);

  useEffect(() => {
    setTitle(widget.title ?? definition.name);
    setDataText(formatWidgetData(widget.data));
    setChartType(widget.config.chartType === "bar" ? "bar" : "line");
    setPinned(widget.pinned);
    setTemporary(widget.temporary);
  }, [definition.name, widget]);

  return (
    <div className="dashboard-builder-panel">
      <div className="dashboard-builder-header">
        <div>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {definition.name}
          </div>
          <div className="text-muted">{definition.category}</div>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="dashboard-builder-fields">
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        {definition.renderer === "chart" && (
          <label>
            <span>Chart</span>
            <select value={chartType} onChange={(event) => setChartType(event.target.value)}>
              <option value="line">Line</option>
              <option value="bar">Bar</option>
            </select>
          </label>
        )}

        <label className="dashboard-builder-wide">
          <span>Data</span>
          <textarea
            value={dataText}
            onChange={(event) => setDataText(event.target.value)}
            rows={7}
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => {
              setPinned(event.target.checked);
              if (event.target.checked) setTemporary(false);
            }}
          />
          <span>Pinned</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={temporary}
            disabled={pinned}
            onChange={(event) => setTemporary(event.target.checked)}
          />
          <span>Temporary</span>
        </label>
      </div>

      <div className="dashboard-builder-actions">
        <button
          className="btn-primary btn-sm"
          disabled={saving}
          onClick={() =>
            onSave(widget, {
              title: title.trim() || null,
              data: parseWidgetData(dataText),
              config:
                definition.renderer === "chart"
                  ? { ...widget.config, chartType }
                  : { ...widget.config },
              pinned,
              temporary,
            })
          }
        >
          Save Widget
        </button>
      </div>
    </div>
  );
}

function InnerGrid(props: DashboardGridProps & { width: number }) {
  const { showExec, width } = props;
  const [dashboards, setDashboards] = useState<DashboardProfileData[]>([]);
  const [templates, setTemplates] = useState<DashboardTemplateData[]>([]);
  const [catalog, setCatalog] = useState<WidgetDefinition[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configWidgetId, setConfigWidgetId] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedDashboard = useMemo(
    () => pickSelectedDashboard(dashboards, selectedDashboardId),
    [dashboards, selectedDashboardId]
  );

  const loadDashboards = useCallback(async (preferredId?: string) => {
    const res = await api.getDashboards();
    if (res.success && res.data) {
      setDashboards(res.data);
      const selected = pickSelectedDashboard(res.data, preferredId);
      setSelectedDashboardId(selected?.id ?? "");
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.getDashboards(), api.getDashboardTemplates(), api.getWidgetCatalog()])
      .then(([dashboardsRes, templatesRes, catalogRes]) => {
        if (!active) return;
        const nextDashboards = dashboardsRes.data ?? [];
        setDashboards(nextDashboards);
        setTemplates(templatesRes.data ?? []);
        setCatalog(catalogRes.data ?? []);
        setSelectedDashboardId(pickSelectedDashboard(nextDashboards)?.id ?? "");
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Dashboard request failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const openGenerator = () => setGeneratorOpen(true);
    try {
      if (sessionStorage.getItem(OPEN_WIDGET_GENERATOR_STORAGE_KEY) === "1") {
        sessionStorage.removeItem(OPEN_WIDGET_GENERATOR_STORAGE_KEY);
        setGeneratorOpen(true);
      }
    } catch {
      // Ignore storage failures; the direct event still opens the panel.
    }

    window.addEventListener(OPEN_WIDGET_GENERATOR_EVENT, openGenerator);
    return () => window.removeEventListener(OPEN_WIDGET_GENERATOR_EVENT, openGenerator);
  }, []);

  const visibleWidgets = useMemo(() => {
    return (selectedDashboard?.widgets ?? []).filter(
      (widget) => widget.definitionId !== "exec" || showExec
    );
  }, [selectedDashboard?.widgets, showExec]);

  const catalogById = useMemo(() => {
    return new Map(catalog.map((definition) => [definition.id, definition]));
  }, [catalog]);

  const addableDefinitions = useMemo(() => {
    const existing = new Set(visibleWidgets.map((widget) => widget.definitionId));
    return catalog.filter((definition) => {
      if (definition.id === "exec" && !showExec) return false;
      if (definition.renderer !== "custom") return true;
      return !existing.has(definition.id);
    });
  }, [catalog, showExec, visibleWidgets]);

  const selectedConfigWidget = useMemo(() => {
    if (!configWidgetId) return null;
    const widget = selectedDashboard?.widgets.find((item) => item.id === configWidgetId) ?? null;
    const definition = widget ? (catalogById.get(widget.definitionId) ?? null) : null;
    return widget && definition ? { widget, definition } : null;
  }, [catalogById, configWidgetId, selectedDashboard?.widgets]);

  const updateDashboardLocal = useCallback((dashboard: DashboardProfileData) => {
    setDashboards((current) =>
      current.map((item) => (item.id === dashboard.id ? dashboard : item))
    );
  }, []);

  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: ResponsiveLayouts) => {
      if (!editMode || !selectedDashboard) return;
      const nextLayout = allLayouts as DashboardLayout;
      updateDashboardLocal({ ...selectedDashboard, layout: nextLayout });
      api.updateDashboard(selectedDashboard.id, { layout: nextLayout }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Dashboard layout save failed");
      });
    },
    [editMode, selectedDashboard, updateDashboardLocal]
  );

  const addWidget = useCallback(
    async (definition: WidgetDefinition) => {
      if (!selectedDashboard) return;
      setSaving(true);
      try {
        await api.addDashboardWidget(selectedDashboard.id, {
          definitionId: definition.id,
          title: definition.renderer === "custom" ? null : definition.name,
          data: defaultWidgetData(definition),
          pinned: definition.renderer === "custom",
        });
        await loadDashboards(selectedDashboard.id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Widget add failed");
      } finally {
        setSaving(false);
      }
    },
    [loadDashboards, selectedDashboard]
  );

  const handleGeneratedWidgetSave = useCallback(
    async (definition: GeneratedWidgetDefinition) => {
      if (!selectedDashboard) throw new Error("No dashboard selected");
      setSaving(true);
      try {
        await api.addDashboardWidget(selectedDashboard.id, {
          definition: toDashboardDefinition(definition),
          title: definition.title,
          config: { [GENERATED_WIDGET_CONFIG_KEY]: definition },
          data: null,
          pinned: false,
        });
        await loadDashboards(selectedDashboard.id);
        const catalogRes = await api.getWidgetCatalog();
        if (catalogRes.success && catalogRes.data) setCatalog(catalogRes.data);
        setEditMode(true);
        setGeneratorOpen(false);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generated widget save failed";
        setError(message);
        throw new Error(message);
      } finally {
        setSaving(false);
      }
    },
    [loadDashboards, selectedDashboard]
  );

  const removeWidget = useCallback(
    async (widgetId: string) => {
      if (!selectedDashboard) return;
      setSaving(true);
      try {
        await api.deleteDashboardWidget(selectedDashboard.id, widgetId);
        if (configWidgetId === widgetId) setConfigWidgetId(null);
        await loadDashboards(selectedDashboard.id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Widget remove failed");
      } finally {
        setSaving(false);
      }
    },
    [configWidgetId, loadDashboards, selectedDashboard]
  );

  const saveWidgetConfig = useCallback(
    async (
      widget: DashboardWidgetData,
      data: {
        title: string | null;
        data: unknown;
        config: Record<string, unknown>;
        pinned: boolean;
        temporary: boolean;
      }
    ) => {
      if (!selectedDashboard) return;
      setSaving(true);
      try {
        await api.updateDashboardWidget(selectedDashboard.id, widget.id, data);
        await loadDashboards(selectedDashboard.id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Widget save failed");
      } finally {
        setSaving(false);
      }
    },
    [loadDashboards, selectedDashboard]
  );

  const resetLayout = useCallback(async () => {
    if (!selectedDashboard) return;
    const nextLayout = buildLayout(selectedDashboard.widgets, catalog, showExec);
    updateDashboardLocal({ ...selectedDashboard, layout: nextLayout });
    try {
      await api.updateDashboard(selectedDashboard.id, { layout: nextLayout });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard reset failed");
    }
  }, [catalog, selectedDashboard, showExec, updateDashboardLocal]);

  const createBlankDashboard = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.createDashboard({
        name: `Custom Dashboard ${dashboards.length + 1}`,
        widgets: [],
        layout: { lg: [], md: [] },
      });
      await loadDashboards(res.data?.id);
      setEditMode(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard create failed");
    } finally {
      setSaving(false);
    }
  }, [dashboards.length, loadDashboards]);

  const createFromTemplate = useCallback(
    async (templateId: string) => {
      if (!templateId) return;
      setSaving(true);
      try {
        const res = await api.createDashboard({ templateId });
        await loadDashboards(res.data?.id);
        setEditMode(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Template create failed");
      } finally {
        setSaving(false);
      }
    },
    [loadDashboards]
  );

  const deleteDashboard = useCallback(async () => {
    if (!selectedDashboard || dashboards.length <= 1) return;
    if (!window.confirm(`Delete ${selectedDashboard.name}?`)) return;
    setSaving(true);
    try {
      await api.deleteDashboard(selectedDashboard.id);
      await loadDashboards();
      setConfigWidgetId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard delete failed");
    } finally {
      setSaving(false);
    }
  }, [dashboards.length, loadDashboards, selectedDashboard]);

  const setDefaultDashboard = useCallback(async () => {
    if (!selectedDashboard) return;
    setSaving(true);
    try {
      const res = await api.updateDashboard(selectedDashboard.id, { isDefault: true });
      if (res.data) updateDashboardLocal(res.data);
      await loadDashboards(selectedDashboard.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Default dashboard save failed");
    } finally {
      setSaving(false);
    }
  }, [loadDashboards, selectedDashboard, updateDashboardLocal]);

  const exportDashboard = useCallback(async () => {
    if (!selectedDashboard) return;
    try {
      const res = await api.exportDashboard(selectedDashboard.id);
      const bundle = res.data;
      if (!bundle) return;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedDashboard.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.dashboard.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard export failed");
    }
  }, [selectedDashboard]);

  const importDashboard = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setSaving(true);
      try {
        const text = await file.text();
        const bundle = JSON.parse(text) as DashboardExportBundle;
        const res = await api.importDashboard(bundle);
        await loadDashboards(res.data?.id);
        setEditMode(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Dashboard import failed");
      } finally {
        setSaving(false);
      }
    },
    [loadDashboards]
  );

  function renderCustomWidget(widget: DashboardWidgetData) {
    const generatedDefinition = generatedWidgetFromConfig(widget);
    if (generatedDefinition) {
      return <GeneratedWidgetRenderer definition={generatedDefinition} />;
    }

    const id = widget.definitionId;
    if (id === "stats") return <StatsWidget status={props.status} stats={props.stats} />;
    if (id === "logs") return <LogsWidget />;
    if (id === "agent") {
      return (
        <AgentSettingsWidget
          getLocal={props.getLocal}
          getServer={props.getServer}
          setLocal={props.setLocal}
          saveConfig={props.saveConfig}
          cancelLocal={props.cancelLocal}
          modelOptions={props.modelOptions}
          pendingProvider={props.pendingProvider}
          pendingMeta={props.pendingMeta}
          pendingApiKey={props.pendingApiKey}
          setPendingApiKey={props.setPendingApiKey}
          pendingValidating={props.pendingValidating}
          pendingError={props.pendingError}
          setPendingError={props.setPendingError}
          handleProviderChange={props.handleProviderChange}
          handleProviderConfirm={props.handleProviderConfirm}
          handleProviderCancel={props.handleProviderCancel}
        />
      );
    }
    if (id === "telegram") {
      return (
        <TelegramSettingsWidget
          getLocal={props.getLocal}
          getServer={props.getServer}
          setLocal={props.setLocal}
          saveConfig={props.saveConfig}
          cancelLocal={props.cancelLocal}
        />
      );
    }
    if (id === "exec" && showExec) {
      return <ExecSettingsWidget getLocal={props.getLocal} saveConfig={props.saveConfig} />;
    }
    if (id === "quick-actions") return <QuickActions />;
    if (id === "predictions") return <PredictionsWidget />;
    if (id === "cache") return <CacheWidget />;
    if (id === "token-chart") {
      return (
        <Suspense fallback={<div className="chart-loading">Loading...</div>}>
          <TokenUsageChart />
        </Suspense>
      );
    }
    if (id === "tool-chart") {
      return (
        <Suspense fallback={<div className="chart-loading">Loading...</div>}>
          <ToolUsageChart />
        </Suspense>
      );
    }
    if (id === "activity-heatmap") {
      return (
        <Suspense fallback={<div className="chart-loading">Loading...</div>}>
          <ActivityHeatmap />
        </Suspense>
      );
    }
    if (id === "health-check") return <HealthCheck />;
    return <div className="empty">Renderer unavailable</div>;
  }

  function renderWidget(widget: DashboardWidgetData) {
    const definition = catalogById.get(widget.definitionId);
    const generatedDefinition = generatedWidgetFromConfig(widget);
    const isCustom =
      definition?.renderer === "custom" || CUSTOM_RENDERER_IDS.has(widget.definitionId);
    const title = definitionTitle(widget, definition);
    return (
      <div key={widget.id} style={{ overflow: "hidden" }}>
        <WidgetWrapper
          title={title}
          editMode={editMode}
          onRemove={() => removeWidget(widget.id)}
          actions={
            editMode && definition && !isCustom ? (
              <button
                className="widget-remove-btn btn-ghost btn-sm"
                onClick={() => setConfigWidgetId(widget.id)}
              >
                Config
              </button>
            ) : null
          }
          className={
            generatedDefinition
              ? "widget-generated"
              : widget.definitionId === "logs"
              ? "widget-logs"
              : widget.definitionId === "stats"
                ? "widget-stats"
                : ""
          }
        >
          {definition && !isCustom ? (
            <DynamicWidgetRenderer widget={widget} definition={definition} />
          ) : (
            renderCustomWidget(widget)
          )}
        </WidgetWrapper>
      </div>
    );
  }

  if (loading) return <div className="loading">Loading dashboard...</div>;

  return (
    <div className="dashboard-grid-root">
      {error && (
        <div className="alert error" style={{ marginBottom: 12 }}>
          {error}
          <button
            className="btn-ghost btn-sm"
            onClick={() => setError(null)}
            style={{ marginLeft: 8 }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="dashboard-toolbar">
        <select
          className="dashboard-profile-select"
          value={selectedDashboard?.id ?? ""}
          onChange={(event) => {
            setSelectedDashboardId(event.target.value);
            setConfigWidgetId(null);
          }}
        >
          {dashboards.map((dashboard) => (
            <option key={dashboard.id} value={dashboard.id}>
              {dashboard.name}
              {dashboard.isDefault ? " *" : ""}
            </option>
          ))}
        </select>

        <button
          className="btn-ghost btn-sm"
          disabled={saving || !selectedDashboard}
          onClick={() => setGeneratorOpen(true)}
          type="button"
        >
          Generate Widget
        </button>

        <button
          className={`btn-ghost btn-sm${editMode ? " active" : ""}`}
          onClick={() => setEditMode((value) => !value)}
        >
          {editMode ? "Done" : "Edit"}
        </button>

        {editMode && (
          <>
            <button className="btn-ghost btn-sm" disabled={saving} onClick={createBlankDashboard}>
              New
            </button>
            <select
              className="dashboard-template-select"
              value=""
              disabled={saving}
              onChange={(event) => createFromTemplate(event.target.value)}
            >
              <option value="">Template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <select
              className="dashboard-template-select"
              value=""
              disabled={saving || !selectedDashboard}
              onChange={(event) => {
                const definition = catalogById.get(event.target.value);
                if (definition) void addWidget(definition);
              }}
            >
              <option value="">Add Widget</option>
              {addableDefinitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost btn-sm"
              disabled={saving || !selectedDashboard}
              onClick={resetLayout}
            >
              Reset
            </button>
            <button
              className="btn-ghost btn-sm"
              disabled={saving || selectedDashboard?.isDefault}
              onClick={setDefaultDashboard}
            >
              Default
            </button>
            <button
              className="btn-ghost btn-sm"
              disabled={saving || !selectedDashboard}
              onClick={exportDashboard}
            >
              Export
            </button>
            <button
              className="btn-ghost btn-sm"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              Import
            </button>
            <button
              className="btn-danger btn-sm"
              disabled={saving || dashboards.length <= 1}
              onClick={deleteDashboard}
            >
              Delete
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={importDashboard}
            />
          </>
        )}
      </div>

      {editMode && selectedConfigWidget && (
        <WidgetConfigPanel
          widget={selectedConfigWidget.widget}
          definition={selectedConfigWidget.definition}
          saving={saving}
          onClose={() => setConfigWidgetId(null)}
          onSave={saveWidgetConfig}
        />
      )}

      {!selectedDashboard ? (
        <div className="empty">No dashboards</div>
      ) : visibleWidgets.length === 0 ? (
        <div className="dashboard-empty-state">
          <button
            className="btn-primary btn-sm"
            disabled={saving}
            onClick={() => setEditMode(true)}
          >
            Edit
          </button>
        </div>
      ) : (
        <ResponsiveGridLayout
          width={width}
          layouts={selectedDashboard.layout as ResponsiveLayouts}
          breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 4, xs: 2, xxs: 2 }}
          rowHeight={60}
          dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
          resizeConfig={{ enabled: editMode }}
          onLayoutChange={handleLayoutChange}
          margin={[12, 12]}
          containerPadding={[0, 0]}
        >
          {visibleWidgets.map(renderWidget)}
        </ResponsiveGridLayout>
      )}

      <WidgetGeneratorPanel
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onSave={handleGeneratedWidgetSave}
      />
    </div>
  );
}

export function DashboardGrid(props: DashboardGridProps) {
  const { width, containerRef } = useContainerWidth();

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div ref={containerRef as any} style={{ width: "100%" }}>
      {width > 0 && <InnerGrid {...props} width={width} />}
    </div>
  );
}
