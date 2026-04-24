import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type FeedbackAnalyticsData,
  type FeedbackListData,
  type FeedbackPreferenceProfile,
  type FeedbackTheme,
} from "../lib/api";

function fmtPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function fmtRating(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

function fmtDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: "16px", minWidth: "150px", flex: "1 1 150px" }}>
      <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700 }}>{value}</div>
      {sub && (
        <div style={{ color: "var(--text-secondary)", fontSize: "11px", marginTop: "4px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function PreferenceSelect({
  label,
  value,
  source,
  options,
  onChange,
}: {
  label: string;
  value: string;
  source: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: "6px", fontSize: "12px" }}>
      <span style={{ color: "var(--text-secondary)" }}>
        {label} · {source}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Feedback() {
  const [periodDays, setPeriodDays] = useState(30);
  const [analytics, setAnalytics] = useState<FeedbackAnalyticsData | null>(null);
  const [themes, setThemes] = useState<FeedbackTheme[]>([]);
  const [preferences, setPreferences] = useState<FeedbackPreferenceProfile | null>(null);
  const [history, setHistory] = useState<FeedbackListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsRes, themesRes, prefsRes, historyRes] = await Promise.all([
        api.getFeedbackAnalytics(periodDays),
        api.getFeedbackThemes(periodDays, 12),
        api.getFeedbackPreferences(),
        api.getFeedback({ limit: 12 }),
      ]);
      setAnalytics(analyticsRes.data ?? null);
      setThemes(themesRes.data ?? []);
      setPreferences(prefsRes.data ?? null);
      setHistory(historyRes.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    load();
  }, [load]);

  const updatePreference = async (key: keyof FeedbackPreferenceProfile, value: string) => {
    try {
      const res = await api.updateFeedbackPreferences({ [key]: value });
      setPreferences(res.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const trendData =
    analytics?.trend.map((point) => ({
      ...point,
      label: new Date(point.date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    })) ?? [];

  return (
    <div>
      <div className="header">
        <h1>Feedback</h1>
        <p>Response quality, themes, and learned preferences</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "14px" }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            className={periodDays === days ? "" : "btn-ghost"}
            onClick={() => setPeriodDays(days)}
            style={{ padding: "5px 12px", fontSize: "12px" }}
          >
            {days}d
          </button>
        ))}
        <button
          className="btn-ghost"
          onClick={load}
          style={{ padding: "5px 12px", fontSize: "12px" }}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "18px" }}>
        <StatCard label="Satisfaction" value={fmtPercent(analytics?.satisfactionScore)} />
        <StatCard label="Average Rating" value={fmtRating(analytics?.averageRating)} />
        <StatCard
          label="Feedback"
          value={analytics?.totalFeedback.toLocaleString() ?? "—"}
          sub={`${analytics?.explicitFeedback ?? 0} explicit · ${analytics?.implicitFeedback ?? 0} implicit`}
        />
        <StatCard label="Coverage" value={fmtPercent(analytics?.feedbackCoverage)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.8fr)",
          gap: "16px",
          marginBottom: "18px",
        }}
      >
        <section className="card" style={{ padding: "16px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>Satisfaction Trend</h2>
          <div style={{ height: 240 }}>
            {loading ? (
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Loading...</div>
            ) : trendData.length === 0 ? (
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid stroke="var(--separator)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="var(--text-secondary)" fontSize={11} />
                  <YAxis stroke="var(--text-secondary)" fontSize={11} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg)",
                      border: "1px solid var(--separator)",
                      borderRadius: "6px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="satisfactionScore"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Satisfaction"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="card" style={{ padding: "16px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>Preferences</h2>
          {preferences ? (
            <div style={{ display: "grid", gap: "12px" }}>
              <PreferenceSelect
                label="Response length"
                value={preferences.responseLength.value}
                source={preferences.responseLength.source}
                options={["concise", "balanced", "detailed"]}
                onChange={(value) => updatePreference("responseLength", value)}
              />
              <PreferenceSelect
                label="Code style"
                value={preferences.codeStyle.value}
                source={preferences.codeStyle.source}
                options={["clean", "commented", "verified_examples"]}
                onChange={(value) => updatePreference("codeStyle", value)}
              />
              <PreferenceSelect
                label="Interaction style"
                value={preferences.interactionStyle.value}
                source={preferences.interactionStyle.source}
                options={["direct", "neutral", "supportive"]}
                onChange={(value) => updatePreference("interactionStyle", value)}
              />
              <PreferenceSelect
                label="Tool selection"
                value={preferences.toolSelection.value}
                source={preferences.toolSelection.source}
                options={["conservative", "normal", "exploratory"]}
                onChange={(value) => updatePreference("toolSelection", value)}
              />
            </div>
          ) : (
            <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>No preferences</div>
          )}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 0.9fr) minmax(0, 1.1fr)",
          gap: "16px",
        }}
      >
        <section className="card" style={{ padding: "16px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>Themes</h2>
          <div style={{ display: "grid", gap: "8px" }}>
            {themes.length === 0 ? (
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>No themes</div>
            ) : (
              themes.map((theme) => (
                <div
                  key={theme.theme}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "8px",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--separator)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>{theme.label}</div>
                    <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                      {theme.positive} positive · {theme.negative} negative
                    </div>
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>{theme.count}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card" style={{ padding: "16px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>Recent Feedback</h2>
          <div style={{ display: "grid", gap: "10px" }}>
            {history?.feedback.length ? (
              history.feedback.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    borderBottom: "1px solid var(--separator)",
                    paddingBottom: "10px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <strong>{entry.type}</strong>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {entry.rating ? `${entry.rating}/5` : "no rating"}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {fmtDate(entry.createdAt)}
                    </span>
                  </div>
                  {entry.text && <div style={{ marginTop: "4px" }}>{entry.text}</div>}
                  {entry.tags.length > 0 && (
                    <div
                      style={{ marginTop: "5px", color: "var(--text-secondary)", fontSize: "11px" }}
                    >
                      {entry.tags.join(" · ")}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>No feedback</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
