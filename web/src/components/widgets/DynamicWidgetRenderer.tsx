import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardWidgetData, WidgetDefinition } from "../../lib/api";

interface DynamicWidgetRendererProps {
  widget: DashboardWidgetData;
  definition: WidgetDefinition;
}

interface WidgetFetchState {
  data: unknown;
  loading: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapApiResponse(value: unknown): unknown {
  if (isRecord(value) && value.success === true && "data" in value) {
    return value.data;
  }
  return value;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function useWidgetData(
  widget: DashboardWidgetData,
  definition: WidgetDefinition
): WidgetFetchState {
  const [state, setState] = useState<WidgetFetchState>({
    data: widget.data,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (definition.dataSource.type !== "api" || !definition.dataSource.endpoint) {
      setState({ data: widget.data, loading: false, error: null });
      return;
    }

    let active = true;
    const load = () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      fetch(definition.dataSource.endpoint!, { credentials: "include" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<unknown>;
        })
        .then((json) => {
          if (active) setState({ data: unwrapApiResponse(json), loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (active) {
            setState({
              data: widget.data,
              loading: false,
              error: error instanceof Error ? error.message : "Request failed",
            });
          }
        });
    };

    load();
    const interval = definition.dataSource.refreshInterval
      ? window.setInterval(load, definition.dataSource.refreshInterval * 1000)
      : null;
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [
    definition.dataSource.endpoint,
    definition.dataSource.refreshInterval,
    definition.dataSource.type,
    widget.data,
  ]);

  return state;
}

function KpiRenderer({ data }: { data: unknown }) {
  const item = isRecord(data) ? data : { value: data };
  const label = typeof item.label === "string" ? item.label : "Value";
  const value = item.value ?? item.count ?? item.total ?? data;
  const trend = typeof item.trend === "string" ? item.trend : null;

  return (
    <div className="dynamic-kpi">
      <span className="metric-label">{label}</span>
      <span className="dynamic-kpi-value">{stringifyValue(value)}</span>
      {trend && <span className="text-muted">{trend}</span>}
    </div>
  );
}

function TextRenderer({ data }: { data: unknown }) {
  return <pre className="dynamic-text">{stringifyValue(data)}</pre>;
}

function MarkdownRenderer({ data }: { data: unknown }) {
  return (
    <div className="markdown-content dynamic-markdown">
      <ReactMarkdown>{stringifyValue(data)}</ReactMarkdown>
    </div>
  );
}

function TableRenderer({ data }: { data: unknown }) {
  const rows = Array.isArray(data)
    ? data
    : isRecord(data)
      ? Object.entries(data).map(([key, value]) => ({ key, value }))
      : [];
  const columns = useMemo(() => {
    const firstRecord = rows.find(isRecord);
    return firstRecord ? Object.keys(firstRecord).slice(0, 6) : ["value"];
  }, [rows]);

  if (rows.length === 0) return <div className="empty">No rows</div>;

  return (
    <div className="dynamic-table-wrap">
      <table className="dynamic-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{stringifyValue(isRecord(row) ? row[column] : row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListRenderer({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? data : isRecord(data) ? Object.entries(data) : [];
  if (items.length === 0) return <div className="empty">No items</div>;

  return (
    <ul className="dynamic-list">
      {items.slice(0, 50).map((item, index) => (
        <li key={index}>
          {Array.isArray(item) ? `${item[0]}: ${stringifyValue(item[1])}` : stringifyValue(item)}
        </li>
      ))}
    </ul>
  );
}

function ChartRenderer({ data, widget }: { data: unknown; widget: DashboardWidgetData }) {
  const points = Array.isArray(data) ? data.filter(isRecord) : [];
  const chartType = widget.config.chartType === "bar" ? "bar" : "line";
  const labelKey = typeof widget.config.labelKey === "string" ? widget.config.labelKey : "label";
  const valueKey = typeof widget.config.valueKey === "string" ? widget.config.valueKey : "value";

  if (points.length === 0) return <div className="chart-empty">No data yet</div>;

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
      <XAxis
        dataKey={labelKey}
        tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <Tooltip
        contentStyle={{
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
          color: "var(--text)",
        }}
      />
    </>
  );

  return (
    <div className="dynamic-chart">
      <ResponsiveContainer width="100%" height={180}>
        {chartType === "bar" ? (
          <BarChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            {common}
            <Bar dataKey={valueKey} fill="var(--accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            {common}
            <Line
              type="monotone"
              dataKey={valueKey}
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function DynamicWidgetRenderer({ widget, definition }: DynamicWidgetRendererProps) {
  const { data, loading, error } = useWidgetData(widget, definition);

  if (loading) return <div className="chart-loading">Loading...</div>;
  if (error) return <div className="alert error">{error}</div>;

  switch (definition.renderer) {
    case "kpi":
      return <KpiRenderer data={data} />;
    case "text":
      return <TextRenderer data={data} />;
    case "markdown":
      return <MarkdownRenderer data={data} />;
    case "table":
      return <TableRenderer data={data} />;
    case "chart":
      return <ChartRenderer data={data} widget={widget} />;
    case "list":
      return <ListRenderer data={data} />;
    case "custom":
      return <TextRenderer data={data} />;
  }
}
