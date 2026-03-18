import { StatusData } from '../../lib/api';

interface StatsProps {
  status: StatusData;
  stats: { knowledge: number; messages: number; chats: number };
}

function Metric({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export function StatsWidget({ status: s, stats }: StatsProps) {
  const uptime = s.uptime < 3600
    ? `${Math.floor(s.uptime / 60)}m`
    : `${Math.floor(s.uptime / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`;

  return (
    <div className="status-row">
      <Metric label="Uptime" value={uptime} />
      <Metric label="Sessions" value={s.sessionCount} />
      <Metric label="Tools" value={s.toolCount} />
      <Metric label="Knowledge" value={stats.knowledge} />
      <Metric label="Messages" value={stats.messages.toLocaleString()} />
      <Metric label="Chats" value={stats.chats} />
      <Metric label="Tokens" value={s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0'} mono />
      <Metric label="Cost" value={s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} mono />
    </div>
  );
}
