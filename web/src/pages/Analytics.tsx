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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    <div
      className="card"
      style={{ flex: 1, minWidth: 0, padding: "16px 20px" }}
    >
      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: color ?? "var(--text)" }}>
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
      <SectionHeader
        title="Usage Statistics"
        period={period}
        onPeriodChange={setPeriod}
      />

      {error && <div className="alert error" style={{ marginBottom: "12px" }}>{error}</div>}

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatCard label="Total Tokens" value={totalTokens.toLocaleString()} />
        <StatCard label="Total Cost" value={fmtCost(totalCost)} />
        <StatCard label="Requests (tool calls)" value={toolData.reduce((s, d) => s + d.count, 0).toLocaleString()} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", flexWrap: "wrap" }}>
        {/* Token/Cost over time */}
        <div className="card" style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Token Consumption Over Time
          </h3>
          {loading ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : toolData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={toolData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  dataKey="tool"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={110}
                  tickFormatter={(v: string) => v.length > 16 ? `${v.slice(0, 15)}…` : v}
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : toolData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
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
      <SectionHeader
        title="Peak Usage Hours"
        period={period}
        onPeriodChange={setPeriod}
      />
      {error && <div className="alert error" style={{ marginBottom: "12px" }}>{error}</div>}
      <div className="card" style={{ padding: "16px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: "11px", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "right", paddingRight: 8, color: "var(--text-secondary)", fontWeight: 500 }}></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} style={{ width: 24, textAlign: "center", color: "var(--text-secondary)", fontWeight: 400 }}>
                    {h % 3 === 0 ? `${h}h` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((day, d) => (
                <tr key={d}>
                  <td style={{ textAlign: "right", paddingRight: 8, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
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
      <SectionHeader
        title="Performance Metrics"
        period={period}
        onPeriodChange={setPeriod}
      />
      {error && <div className="alert error" style={{ marginBottom: "12px" }}>{error}</div>}

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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : successData.every((d) => d.value === 0) ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : errFreq.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No errors in this period</div>
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
      {error && <div className="alert error" style={{ marginBottom: "12px" }}>{error}</div>}

      {/* Budget status */}
      {budget && (
        <div className="card" style={{ padding: "16px", marginBottom: "20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)" }}>
            Budget Status (Current Month)
          </h3>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
            <StatCard
              label="Month-to-Date Cost"
              value={fmtCost(budget.current_month_cost_usd)}
            />
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
            <label style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No cost records yet</div>
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
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : perTool.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={perTool} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  dataKey="tool"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={110}
                  tickFormatter={(v: string) => v.length > 16 ? `${v.slice(0, 15)}…` : v}
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
      <HeatmapSection />
      <PerformanceSection />
      <CostSection />
    </div>
  );
}
