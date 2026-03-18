import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api, type TokenDataPoint, type MetricsPeriod } from '../../lib/api';

interface ChartPoint {
  label: string;
  tokens: number;
  cost: number;
}

function formatBucket(ts: number, period: MetricsPeriod): string {
  const d = new Date(ts * 1000);
  if (period === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function aggregate(points: TokenDataPoint[], period: MetricsPeriod): ChartPoint[] {
  if (period === '24h') {
    return points.map((p) => ({
      label: formatBucket(p.timestamp, period),
      tokens: p.tokens,
      cost: p.cost,
    }));
  }
  // For 7d / 30d: aggregate by day
  const byDay = new Map<string, ChartPoint>();
  for (const p of points) {
    const label = formatBucket(p.timestamp, period);
    const existing = byDay.get(label);
    if (existing) {
      existing.tokens += p.tokens;
      existing.cost += p.cost;
    } else {
      byDay.set(label, { label, tokens: p.tokens, cost: p.cost });
    }
  }
  return Array.from(byDay.values());
}

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

export function TokenUsageChart() {
  const [period, setPeriod] = useState<MetricsPeriod>('24h');
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getTokenMetrics(period).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        setData(aggregate(res.data, period));
      } else {
        setData([]);
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

  const hasData = data.length > 0;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">Token Usage</span>
        <div className="chart-period-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`chart-period-tab${period === p.value ? ' active' : ''}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-body">
        {loading ? (
          <div className="chart-empty">Loading…</div>
        ) : !hasData ? (
          <div className="chart-empty">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--glass)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(value, name) =>
                  name === 'tokens'
                    ? [`${Number(value).toLocaleString()} tokens`, 'Tokens']
                    : [`$${Number(value).toFixed(4)}`, 'Cost']
                }
              />
              <Line
                type="monotone"
                dataKey="tokens"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
