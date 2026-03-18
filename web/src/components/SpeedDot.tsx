import { ToolUsageStats } from '../lib/api';

/**
 * Colored dot indicating tool execution speed based on avgDurationMs.
 *
 *  green  – fast   (<1 000 ms)
 *  yellow – medium (1 000–5 000 ms)
 *  red    – slow   (>5 000 ms)
 *  grey   – no data
 */

interface SpeedDotProps {
  stats?: ToolUsageStats;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SpeedDot({ stats }: SpeedDotProps) {
  const avg = stats?.avgDurationMs ?? null;

  let color: string;
  let title: string;

  if (avg === null) {
    color = 'var(--text-secondary, #888)';
    title = 'No execution data yet';
  } else if (avg < 1000) {
    color = 'var(--green)';
    title = `Fast — average: ${formatMs(avg)}`;
  } else if (avg <= 5000) {
    color = '#f0a500';
    title = `Medium — average: ${formatMs(avg)}`;
  } else {
    color = 'var(--red, #e05252)';
    title = `Slow — average: ${formatMs(avg)}`;
  }

  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        cursor: 'default',
      }}
    />
  );
}
