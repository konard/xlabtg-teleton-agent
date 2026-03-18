import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api, type ToolUsageEntry, type MetricsPeriod } from '../../lib/api';

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

export function ToolUsageChart() {
  const [period, setPeriod] = useState<MetricsPeriod>('7d');
  const [data, setData] = useState<ToolUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getToolMetrics(period).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        setData(res.data);
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
        <span className="chart-title">Tool Calls</span>
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
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--separator)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="tool"
                width={90}
                tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.length > 14 ? `${v.slice(0, 13)}…` : v}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--glass)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(value) => [`${Number(value)} calls`, 'Invocations']}
              />
              <Bar dataKey="count" fill="var(--purple)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
