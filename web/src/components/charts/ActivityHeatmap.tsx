import { useEffect, useState } from 'react';
import { api, type ActivityEntry, type MetricsPeriod } from '../../lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Build a 7×24 matrix from the flat activity array
function buildMatrix(entries: ActivityEntry[]): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of entries) {
    if (e.dayOfWeek >= 0 && e.dayOfWeek < 7 && e.hour >= 0 && e.hour < 24) {
      matrix[e.dayOfWeek][e.hour] = e.count;
    }
  }
  return matrix;
}

function colorForValue(value: number, max: number): string {
  if (max === 0 || value === 0) return 'var(--surface)';
  const intensity = value / max;
  if (intensity < 0.25) return 'var(--accent-dim)';
  if (intensity < 0.5)  return 'rgba(10, 132, 255, 0.35)';
  if (intensity < 0.75) return 'rgba(10, 132, 255, 0.60)';
  return 'var(--accent)';
}

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

export function ActivityHeatmap() {
  const [period, setPeriod] = useState<MetricsPeriod>('30d');
  const [matrix, setMatrix] = useState<number[][]>(() =>
    Array.from({ length: 7 }, () => new Array(24).fill(0))
  );
  const [maxVal, setMaxVal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ day: number; hour: number; count: number } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getActivityMetrics(period).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        const m = buildMatrix(res.data);
        const max = Math.max(...m.flatMap((row) => row));
        setMatrix(m);
        setMaxVal(max);
      } else {
        setMatrix(Array.from({ length: 7 }, () => new Array(24).fill(0)));
        setMaxVal(0);
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

  const hasData = maxVal > 0;

  return (
    <div className="chart-card chart-card-wide">
      <div className="chart-header">
        <span className="chart-title">Activity Heatmap</span>
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
          <div className="heatmap-wrap" style={{ position: 'relative' }}>
            <div className="heatmap-grid">
              {/* Hour labels row */}
              <div className="heatmap-day-label" />
              {HOURS.filter((h) => h % 3 === 0).map((h) => (
                <div
                  key={h}
                  className="heatmap-hour-label"
                  style={{ gridColumn: `span 3` }}
                >
                  {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
                </div>
              ))}

              {/* Day rows */}
              {DAYS.map((day, dayIdx) => (
                <>
                  <div key={`label-${dayIdx}`} className="heatmap-day-label">{day}</div>
                  {HOURS.map((hour) => {
                    const val = matrix[dayIdx][hour];
                    return (
                      <div
                        key={`${dayIdx}-${hour}`}
                        className="heatmap-cell"
                        style={{ background: colorForValue(val, maxVal) }}
                        onMouseEnter={() => setTooltip({ day: dayIdx, hour, count: val })}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })}
                </>
              ))}
            </div>

            {tooltip && (
              <div className="heatmap-tooltip">
                {DAYS[tooltip.day]} {tooltip.hour}:00 — {tooltip.count} events
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
