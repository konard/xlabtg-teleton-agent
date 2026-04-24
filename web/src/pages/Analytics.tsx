import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  api,
  type MetricsPeriod,
  type TokenDataPoint,
  type ToolUsageEntry,
  type ActivityEntry,
  type AnalyticsPerformanceData,
  type AnalyticsCostData,
  type BudgetStatus,
  type AnomalyEvent,
  type AnomalyBaseline,
  type AnomalyStats,
  type TemporalContextData,
  type TemporalPattern,
  type TemporalTimelineEntry,
} from "../lib/api";

// ── Helpers ──────────────────────────────────────────────────────────

const PIE_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#a855f7",
];

function fmtCost(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtHour(bucket: number): string {
  const d = new Date(bucket * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMetricName(metric: string): string {
  if (metric.startsWith("tool_share:")) return `Tool share: ${metric.slice("tool_share:".length)}`;
  if (metric.startsWith("new_tool:")) return `New tool: ${metric.slice("new_tool:".length)}`;
  return metric.replace(/_/g, " ");
}

function fmtNumber(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ── Period Selector ──────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
  options = ["24h", "7d", "30d"],
}: {
  value: MetricsPeriod;
  onChange: (p: MetricsPeriod) => void;
  options?: MetricsPeriod[];
}) {
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {options.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={value === p ? "" : "btn-ghost"}
          style={{ padding: "4px 10px", fontSize: "12px" }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────

function SectionHeader({
  title,
  period,
  onPeriodChange,
  periodOptions,
}: {
  title: string;
  period?: MetricsPeriod;
  onPeriodChange?: (p: MetricsPeriod) => void;
  periodOptions?: MetricsPeriod[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "16px" }}>{title}</h2>
      {period && onPeriodChange && (
        <PeriodSelector value={period} onChange={onPeriodChange} options={periodOptions} />
      )}
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card" style={{ flex: "1 1 140px", minWidth: "140px", padding: "16px 20px" }}>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "24px",
          fontWeight: 700,
          color: color ?? "var(--text)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Usage Section ────────────────────────────────────────────────────

function UsageSection() {
  const [period, setPeriod] = useState<MetricsPeriod>("7d");
  const [tokenData, setTokenData] = useState<TokenDataPoint[]>([]);
  const [toolData, setToolData] = useState<ToolUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokRes, toolRes] = await Promise.all([
        api.getAnalyticsUsage(period),
        api.getAnalyticsTools(period),
      ]);
      setTokenData(tokRes.data ?? []);
      setToolData(toolRes.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load usage data");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const totalTokens = tokenData.reduce((s, d) => s + d.tokens, 0);
  const totalCost = tokenData.reduce((s, d) => s + d.cost, 0);

  const chartData = tokenData.map((d) => ({
    ...d,
    time: fmtHour(d.timestamp),
  }));

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader title="Usage Statistics" period={period} onPeriodChange={setPeriod} />

      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatCard label="Total Tokens" value={totalTokens.toLocaleString()} />
        <StatCard label="Total Cost" value={fmtCost(totalCost)} />
        <StatCard
          label="Requests (tool calls)"
          value={toolData.reduce((s, d) => s + d.count, 0).toLocaleString()}
        />
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", flexWrap: "wrap" }}
      >
        {/* Token/Cost over time */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Token Consumption Over Time
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="tokens" stroke="#2563eb" dot={false} name="Tokens" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top tools */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Top Used Tools
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : toolData.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={toolData}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  dataKey="tool"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={110}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" name="Calls" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Token distribution pie */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Tool Usage Distribution
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : toolData.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={toolData}
                  dataKey="count"
                  nameKey="tool"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => {
                    if (percent <= 0.05) return "";
                    const shortName = name.length > 12 ? `${name.slice(0, 11)}…` : name;
                    return `${shortName} ${(percent * 100).toFixed(0)}%`;
                  }}
                  labelLine={false}
                >
                  {toolData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [v.toLocaleString(), "Calls"]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cost over time */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Cost Over Time
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                <Tooltip formatter={(v: number) => [fmtCost(v), "Cost"]} />
                <Line type="monotone" dataKey="cost" stroke="#10b981" dot={false} name="Cost ($)" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Anomaly Section ─────────────────────────────────────────────────

function AnomalySection() {
  const [period, setPeriod] = useState<MetricsPeriod>("24h");
  const [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [baselines, setBaselines] = useState<AnomalyBaseline[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventRes, baselineRes, statsRes] = await Promise.all([
        api.getAnomalies({ period }),
        api.getAnomalyBaselines(),
        api.getAnomalyStats(period),
      ]);
      setEvents(eventRes.data ?? []);
      setBaselines(baselineRes.data ?? []);
      setStats(statsRes.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load anomaly data");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async (id: string) => {
    try {
      const res = await api.acknowledgeAnomaly(id);
      if (res.data) {
        setEvents((items) => items.map((item) => (item.id === id ? res.data! : item)));
        setStats((current) =>
          current
            ? {
                ...current,
                unacknowledged: Math.max(0, current.unacknowledged - 1),
              }
            : current
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge anomaly");
    }
  };

  const sensitivity = stats?.config.sensitivity ?? 2.5;
  const baselineChart = baselines
    .filter((row) => !row.metric.startsWith("tool_share:"))
    .slice(0, 6)
    .map((row) => ({
      metric: fmtMetricName(row.metric),
      current: row.currentValue ?? 0,
      expectedMax: row.mean + sensitivity * row.stddev,
    }));

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader title="Anomaly Monitoring" period={period} onPeriodChange={setPeriod} />
      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatCard label="Detected" value={(stats?.total ?? 0).toLocaleString()} />
        <StatCard
          label="Critical"
          value={(stats?.critical ?? 0).toLocaleString()}
          color={(stats?.critical ?? 0) > 0 ? "#ef4444" : undefined}
        />
        <StatCard
          label="Unacknowledged"
          value={(stats?.unacknowledged ?? 0).toLocaleString()}
          color={(stats?.unacknowledged ?? 0) > 0 ? "#f59e0b" : undefined}
        />
        <StatCard
          label="Sensitivity"
          value={`${stats?.config.sensitivity ?? "—"}σ`}
          sub={`cooldown ${stats?.config.cooldown_minutes ?? "—"} min`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
        }}
      >
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Detection Timeline
          </h3>
          {loading ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : events.length === 0 ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No anomalies in this period
            </div>
          ) : (
            <div style={{ maxHeight: "370px", overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
                  <tr style={{ color: "var(--text-secondary)", textAlign: "left" }}>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Time
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Severity
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Metric
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Current
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Review
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "1px solid var(--separator)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtDateTime(event.createdAt)}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                        <span
                          style={{
                            color: event.severity === "critical" ? "#ef4444" : "#f59e0b",
                            fontWeight: 700,
                            textTransform: "capitalize",
                          }}
                        >
                          {event.severity}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "1px solid var(--separator)",
                          minWidth: 150,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{fmtMetricName(event.metric)}</div>
                        <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                          {event.type.replace(/_/g, " ")}
                        </div>
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                        {fmtNumber(event.currentValue)}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                        {event.acknowledged ? (
                          <span style={{ color: "var(--text-secondary)" }}>Done</span>
                        ) : (
                          <button
                            className="btn-ghost"
                            onClick={() => acknowledge(event.id)}
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                          >
                            Acknowledge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Alert Configuration
          </h3>
          <div style={{ display: "grid", gap: "10px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Enabled</span>
              <strong>{stats?.config.enabled ? "Yes" : "No"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Baseline</span>
              <strong>{stats?.config.baseline_days ?? "—"} days</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>In-app</span>
              <strong>{stats?.config.alerting.in_app ? "On" : "Off"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Telegram</span>
              <strong>{stats?.config.alerting.telegram ? "On" : "Off"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Webhook</span>
              <strong>{stats?.config.alerting.webhook_url ? "Set" : "Off"}</strong>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "16px", gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Baseline vs Actual
          </h3>
          {loading ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : baselineChart.length === 0 ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Waiting for baseline samples
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={baselineChart} margin={{ top: 4, right: 8, left: 8, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
                <XAxis
                  dataKey="metric"
                  tick={{ fontSize: 10 }}
                  angle={-20}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmtNumber(v)} />
                <Legend />
                <Bar dataKey="expectedMax" fill="#94a3b8" name="Expected max" />
                <Bar dataKey="current" fill="#2563eb" name="Current" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Heatmap Section ──────────────────────────────────────────────────

function HeatmapSection() {
  const [period, setPeriod] = useState<MetricsPeriod>("30d");
  const [data, setData] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalyticsHeatmap(period);
      setData(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load heatmap");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  // Build 7×24 grid
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let maxVal = 0;
  for (const entry of data) {
    const v = Number(entry.count) || 0;
    grid[entry.dayOfWeek][entry.hour] = v;
    if (v > maxVal) maxVal = v;
  }

  const cellColor = (val: number): string => {
    if (maxVal === 0 || val === 0) return "var(--surface)";
    const intensity = Math.min(val / maxVal, 1);
    const alpha = 0.15 + intensity * 0.85;
    return `rgba(37, 99, 235, ${alpha})`;
  };

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader title="Peak Usage Hours" period={period} onPeriodChange={setPeriod} />
      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}
      <div className="card" style={{ padding: "16px", overflowX: "auto" }}>
        {loading ? (
          <div
            style={{
              height: 160,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            Loading…
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: "11px", width: "100%" }}>
            <thead>
              <tr>
                <th
                  style={{
                    width: 36,
                    textAlign: "right",
                    paddingRight: 8,
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                ></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    style={{
                      width: 24,
                      textAlign: "center",
                      color: "var(--text-secondary)",
                      fontWeight: 400,
                    }}
                  >
                    {h % 3 === 0 ? `${h}h` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((day, d) => (
                <tr key={d}>
                  <td
                    style={{
                      textAlign: "right",
                      paddingRight: 8,
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {day}
                  </td>
                  {Array.from({ length: 24 }, (_, h) => (
                    <td
                      key={h}
                      title={`${day} ${h}:00 — ${grid[d][h]} activity`}
                      style={{
                        width: 24,
                        height: 20,
                        backgroundColor: cellColor(grid[d][h]),
                        border: "1px solid var(--separator)",
                        borderRadius: 2,
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 8, fontSize: "11px", color: "var(--text-secondary)" }}>
          Lighter = less activity. Darker blue = more activity.
        </div>
      </div>
    </section>
  );
}

// ── Temporal Context Section ────────────────────────────────────────

function TemporalContextSection() {
  const [context, setContext] = useState<TemporalContextData | null>(null);
  const [patterns, setPatterns] = useState<TemporalPattern[]>([]);
  const [timeline, setTimeline] = useState<TemporalTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contextRes, patternsRes, timelineRes] = await Promise.all([
        api.getTemporalContext(),
        api.getTemporalPatterns(true),
        api.getTemporalTimeline(8),
      ]);
      setContext(contextRes.data ?? null);
      setPatterns(patternsRes.data ?? []);
      setTimeline(timelineRes.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load temporal context");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePattern = async (pattern: TemporalPattern) => {
    try {
      const res = await api.updateTemporalPattern(pattern.id, { enabled: !pattern.enabled });
      if (res.data) {
        setPatterns((items) => items.map((item) => (item.id === pattern.id ? res.data! : item)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update temporal pattern");
    }
  };

  const activePatterns = context?.activePatterns ?? [];
  const meta = context?.metadata;
  const topPatterns = patterns.slice(0, 6);

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader title="Temporal Context" />
      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatCard label="Local Time" value={meta ? `${meta.localTime.slice(0, 5)}` : "—"} />
        <StatCard label="Day" value={meta ? meta.dayName : "—"} sub={meta?.relativePeriod} />
        <StatCard label="Time Marker" value={meta ? meta.timeOfDay : "—"} />
        <StatCard
          label="Active Patterns"
          value={activePatterns.length.toLocaleString()}
          sub={context?.timezone ?? "timezone unset"}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
          gap: "20px",
        }}
      >
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Active Patterns
          </h3>
          {loading ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : activePatterns.length === 0 ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No active patterns for this time
            </div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {activePatterns.map((pattern) => (
                <div
                  key={pattern.id}
                  style={{
                    borderBottom: "1px solid var(--separator)",
                    paddingBottom: "10px",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>{pattern.description}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: 3 }}>
                    {pattern.patternType} · {fmtPercent(pattern.confidence)} · {pattern.frequency}{" "}
                    observations
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Learned Patterns
          </h3>
          {loading ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : topPatterns.length === 0 ? (
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Waiting for observations
            </div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ color: "var(--text-secondary)", textAlign: "left" }}>
                  <tr>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Pattern
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Confidence
                    </th>
                    <th style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topPatterns.map((pattern) => (
                    <tr key={pattern.id}>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--separator)" }}>
                        <div style={{ fontWeight: 600 }}>{pattern.description}</div>
                        <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                          {pattern.scheduleCron ?? pattern.patternType}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "1px solid var(--separator)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtPercent(pattern.confidence)}
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "1px solid var(--separator)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button
                          className="btn-ghost"
                          onClick={() => togglePattern(pattern)}
                          style={{ fontSize: "12px", padding: "4px 8px" }}
                        >
                          {pattern.enabled ? "Enabled" : "Disabled"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "16px", gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Timeline
          </h3>
          {loading ? (
            <div
              style={{
                height: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : timeline.length === 0 ? (
            <div
              style={{
                height: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No temporal metadata indexed yet
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {timeline.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px, 0.8fr) minmax(70px, 0.45fr) minmax(0, 1fr)",
                    gap: "12px",
                    fontSize: "12px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--separator)",
                    paddingBottom: "8px",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    {fmtDateTime(entry.timestamp)}
                  </span>
                  <strong>{entry.entityType}</strong>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.entityId}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Performance Section ──────────────────────────────────────────────

function PerformanceSection() {
  const [period, setPeriod] = useState<MetricsPeriod>("7d");
  const [data, setData] = useState<AnalyticsPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalyticsPerformance(period);
      setData(res.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load performance data");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary;
  const errFreq = data?.errorFrequency ?? [];

  const successData = summary
    ? [
        { name: "Success", value: summary.totalRequests - summary.errorCount },
        { name: "Failed", value: summary.errorCount },
      ]
    : [];

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader title="Performance Metrics" period={period} onPeriodChange={setPeriod} />
      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatCard
          label="Avg Response Time"
          value={summary?.avgResponseMs != null ? `${Math.round(summary.avgResponseMs)} ms` : "—"}
        />
        <StatCard
          label="Success Rate"
          value={summary?.successRate != null ? `${summary.successRate.toFixed(1)}%` : "—"}
          color={summary?.successRate != null && summary.successRate < 90 ? "#ef4444" : undefined}
        />
        <StatCard label="Total Requests" value={(summary?.totalRequests ?? 0).toLocaleString()} />
        <StatCard
          label="P95 Latency"
          value={summary?.p95Ms != null ? `${Math.round(summary.p95Ms)} ms` : "—"}
        />
        <StatCard
          label="P99 Latency"
          value={summary?.p99Ms != null ? `${Math.round(summary.p99Ms)} ms` : "—"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Success/Failure donut */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Success / Failure Rate
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : successData.every((d) => d.value === 0) ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={successData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Error frequency */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Error Frequency
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : errFreq.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No errors in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={errFreq.map((e) => ({ ...e, date: fmtDate(e.date) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#ef4444" name="Errors" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Cost Analysis Section ────────────────────────────────────────────

function CostSection() {
  const [period, setPeriod] = useState<MetricsPeriod>("30d");
  const [costData, setCostData] = useState<AnalyticsCostData | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [costRes, budgetRes] = await Promise.all([
        api.getAnalyticsCost(period),
        api.getAnalyticsBudget(),
      ]);
      setCostData(costRes.data ?? null);
      setBudget(budgetRes.data ?? null);
      if (budgetRes.data?.monthly_limit_usd != null) {
        setLimitInput(String(budgetRes.data.monthly_limit_usd));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cost data");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveBudget = async () => {
    setSaving(true);
    try {
      const val = limitInput.trim() === "" ? null : parseFloat(limitInput);
      const res = await api.setAnalyticsBudget(isNaN(val as number) ? null : val);
      setBudget(res.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  };

  const daily = costData?.daily ?? [];
  const perTool = costData?.perTool ?? [];

  const chartData = daily.map((d) => ({ ...d, dateLabel: fmtDate(d.date) }));

  return (
    <section style={{ marginBottom: "32px" }}>
      <SectionHeader
        title="Cost Analysis"
        period={period}
        onPeriodChange={setPeriod}
        periodOptions={["7d", "30d"]}
      />
      {error && (
        <div className="alert error" style={{ marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {/* Budget status */}
      {budget && (
        <div className="card" style={{ padding: "16px", marginBottom: "20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Budget Status (Current Month)
          </h3>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
            <StatCard label="Month-to-Date Cost" value={fmtCost(budget.current_month_cost_usd)} />
            {budget.projection_usd != null && (
              <StatCard
                label="Projected Month Cost"
                value={fmtCost(budget.projection_usd)}
                sub="at current rate"
              />
            )}
            {budget.monthly_limit_usd != null && (
              <StatCard
                label="Budget Used"
                value={budget.percent_used != null ? `${budget.percent_used.toFixed(1)}%` : "—"}
                color={
                  budget.percent_used != null && budget.percent_used >= 90
                    ? "#ef4444"
                    : budget.percent_used != null && budget.percent_used >= 80
                      ? "#f59e0b"
                      : undefined
                }
                sub={`of ${fmtCost(budget.monthly_limit_usd)} limit`}
              />
            )}
          </div>

          {/* Budget limit alert bars */}
          {budget.monthly_limit_usd != null && budget.percent_used != null && (
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: "var(--separator)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(budget.percent_used, 100)}%`,
                    backgroundColor:
                      budget.percent_used >= 90
                        ? "#ef4444"
                        : budget.percent_used >= 80
                          ? "#f59e0b"
                          : "#10b981",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              {budget.percent_used >= 80 && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: "12px",
                    color: budget.percent_used >= 90 ? "#ef4444" : "#f59e0b",
                  }}
                >
                  {budget.percent_used >= 100
                    ? "Budget limit reached!"
                    : budget.percent_used >= 90
                      ? "Warning: 90% of budget used"
                      : "Notice: 80% of budget used"}
                </div>
              )}
            </div>
          )}

          {/* Budget limit config */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label
              style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}
            >
              Monthly limit ($):
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="e.g. 10.00 (leave empty to disable)"
              style={{ flex: 1, maxWidth: 240, fontSize: "13px" }}
            />
            <button
              onClick={handleSaveBudget}
              disabled={saving}
              style={{ fontSize: "12px", padding: "4px 12px" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Daily cost bar chart */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Daily Cost
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No cost records yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                <Tooltip formatter={(v: number) => [fmtCost(v), "Cost"]} />
                <Bar dataKey="cost_usd" fill="#2563eb" name="Cost ($)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cost per tool bar chart */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Tool Call Counts
          </h3>
          {loading ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              Loading…
            </div>
          ) : perTool.length === 0 ? (
            <div
              style={{
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={perTool}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  dataKey="tool"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={110}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <Tooltip formatter={(v: number) => [v.toLocaleString(), "Calls"]} />
                <Bar dataKey="count" fill="#2563eb" name="Calls" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Main Analytics Page ───────────────────────────────────────────────

export function Analytics() {
  return (
    <div className="dashboard-root">
      <div className="header">
        <h1>Analytics</h1>
        <p>Usage patterns, performance metrics, and cost analysis</p>
      </div>

      <UsageSection />
      <AnomalySection />
      <HeatmapSection />
      <TemporalContextSection />
      <PerformanceSection />
      <CostSection />
    </div>
  );
}
