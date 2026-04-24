import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, GeneratedWidgetDefinition, WidgetPreviewResult } from '../../lib/api';

interface GeneratedWidgetRendererProps {
  definition: GeneratedWidgetDefinition;
}

const PALETTE_COLORS: Record<GeneratedWidgetDefinition['style']['palette'], string[]> = {
  default: ['var(--accent)', 'var(--green)', 'var(--purple)', 'var(--red)'],
  blue: ['#0A84FF', '#64D2FF', '#5E5CE6', '#30B0C7'],
  green: ['#30D158', '#63E6BE', '#32D74B', '#A4F4A4'],
  purple: ['#BF5AF2', '#5E5CE6', '#DA8FFF', '#7D7AFF'],
  orange: ['#FF9F0A', '#FFD60A', '#FFB340', '#FF7A45'],
  red: ['#FF453A', '#FF6961', '#D70015', '#FF8A80'],
};

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) return Intl.NumberFormat().format(Math.round(value));
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return asString(value);
}

function displayLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

function normalizeChartData(
  data: Array<Record<string, unknown>>,
  categoryKey: string,
  valueKey: string
) {
  return data.map((row) => ({
    ...row,
    [categoryKey]: asString(row[categoryKey]),
    [valueKey]: asNumber(row[valueKey]),
  }));
}

export function GeneratedWidgetRenderer({ definition }: GeneratedWidgetRendererProps) {
  const [preview, setPreview] = useState<WidgetPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .previewWidget(definition)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          setPreview(res.data);
        } else {
          setError(res.error ?? 'Preview failed');
          setPreview(null);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Preview failed');
        setPreview(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [definition]);

  const data = preview?.data ?? [];
  const fields = preview?.fields ?? [];
  const colors = PALETTE_COLORS[definition.style.palette] ?? PALETTE_COLORS.default;

  const tableColumns = useMemo(() => {
    if (definition.config.columns?.length) return definition.config.columns;
    if (fields.length) return fields.map((field) => field.key);
    return Object.keys(data[0] ?? {});
  }, [data, definition.config.columns, fields]);

  if (loading) return <div className="generated-widget-empty">Loading...</div>;
  if (error) return <div className="generated-widget-empty error">{error}</div>;

  if (definition.renderer === 'markdown') {
    return (
      <div className="generated-widget-markdown">
        <ReactMarkdown>{definition.config.markdown ?? definition.description}</ReactMarkdown>
      </div>
    );
  }

  if (data.length === 0) return <div className="generated-widget-empty">No data yet</div>;

  if (definition.renderer === 'kpi') {
    const valueKey = definition.config.valueKey ?? tableColumns[0] ?? 'value';
    const labelKey = definition.config.labelKey;
    const aggregate = definition.config.aggregate ?? 'first';
    const value =
      aggregate === 'sum'
        ? data.reduce((total, row) => total + asNumber(row[valueKey]), 0)
        : aggregate === 'average'
          ? data.reduce((total, row) => total + asNumber(row[valueKey]), 0) /
            Math.max(data.length, 1)
          : data[0]?.[valueKey];
    const label = labelKey ? asString(data[0]?.[labelKey]) : displayLabel(valueKey);

    return (
      <div className="generated-widget-kpi">
        <div className="generated-widget-kpi-value">{formatValue(value)}</div>
        <div className="generated-widget-kpi-label">{label}</div>
      </div>
    );
  }

  if (definition.renderer === 'list') {
    const labelKey = definition.config.labelKey ?? tableColumns[0] ?? 'label';
    const valueKey = definition.config.valueKey;
    return (
      <div className="generated-widget-list">
        {data.slice(0, 8).map((row, index) => (
          <div className="generated-widget-list-row" key={`${asString(row[labelKey])}-${index}`}>
            <span>{asString(row[labelKey])}</span>
            {valueKey && <strong>{formatValue(row[valueKey])}</strong>}
          </div>
        ))}
      </div>
    );
  }

  if (definition.renderer === 'table') {
    return (
      <div className="generated-widget-table-wrap">
        <table className="generated-widget-table">
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th key={column}>{displayLabel(column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 10).map((row, index) => (
              <tr key={index}>
                {tableColumns.map((column) => (
                  <td key={column}>{formatValue(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const chartType = definition.config.chartType ?? 'bar';
  const valueKey =
    definition.config.valueKey ??
    definition.config.yKey ??
    tableColumns[1] ??
    tableColumns[0] ??
    'value';
  const categoryKey =
    definition.config.categoryKey ?? definition.config.xKey ?? tableColumns[0] ?? 'label';
  const chartData = normalizeChartData(data, categoryKey, valueKey);

  if (chartType === 'pie') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--text)',
            }}
          />
          <Pie
            data={chartData}
            dataKey={valueKey}
            nameKey={categoryKey}
            innerRadius="48%"
            outerRadius="78%"
            paddingAngle={2}
          >
            {chartData.map((row, index) => (
              <Cell key={asString(row[categoryKey])} fill={colors[index % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" vertical={false} />
          <XAxis
            dataKey={categoryKey}
            tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--text)',
            }}
          />
          <Line type="monotone" dataKey={valueKey} stroke={colors[0]} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" vertical={false} />
        <XAxis
          dataKey={categoryKey}
          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--glass)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            color: 'var(--text)',
          }}
        />
        <Bar dataKey={valueKey} fill={colors[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
