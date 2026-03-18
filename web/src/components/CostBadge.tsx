import { ToolInfo, ToolUsageStats } from '../lib/api';

/**
 * Estimate the cost tier of a tool based on its category, name, and usage data.
 *
 * Returns:
 *  '$'   – cheap  (simple lookups, local operations)
 *  '$$'  – moderate (external API calls, moderate token usage)
 *  '$$$' – expensive (heavy computation, large context tools)
 */
export function estimateCostTier(tool: ToolInfo, stats?: ToolUsageStats): '$' | '$$' | '$$$' {
  const name = tool.name.toLowerCase();
  const category = (tool.category ?? '').toLowerCase();

  // If we have usage data and average duration is very long, bump up cost tier
  const avgMs = stats?.avgDurationMs ?? null;

  // Heavy/expensive tools: large context manipulation, web browsing, file ops with large output
  if (
    category === 'web' ||
    name.includes('browse') ||
    name.includes('search') ||
    name.includes('scrape') ||
    name.includes('fetch') ||
    name.includes('crawl') ||
    name.includes('execute') ||
    name.includes('run_code') ||
    name.includes('shell') ||
    name.includes('bash')
  ) {
    return '$$$';
  }

  // Moderate: external APIs, file reading, database queries
  if (
    category === 'api' ||
    category === 'files' ||
    category === 'database' ||
    name.includes('read') ||
    name.includes('write') ||
    name.includes('list') ||
    name.includes('create') ||
    name.includes('delete') ||
    name.includes('update') ||
    name.includes('send') ||
    name.includes('telegram') ||
    name.includes('memory')
  ) {
    return '$$';
  }

  // Bump up based on actual average duration if available
  if (avgMs !== null && avgMs > 5000) return '$$$';
  if (avgMs !== null && avgMs > 1000) return '$$';

  return '$';
}

const TIER_COLORS: Record<string, string> = {
  '$': 'var(--green)',
  '$$': '#f0a500',
  '$$$': 'var(--red, #e05252)',
};

const TIER_TITLES: Record<string, string> = {
  '$': 'Low cost — simple local operation',
  '$$': 'Moderate cost — involves external calls or file I/O',
  '$$$': 'High cost — web browsing, code execution, or heavy processing',
};

interface CostBadgeProps {
  tool: ToolInfo;
  stats?: ToolUsageStats;
}

export function CostBadge({ tool, stats }: CostBadgeProps) {
  const tier = estimateCostTier(tool, stats);
  return (
    <span
      title={TIER_TITLES[tier]}
      style={{
        display: 'inline-block',
        fontSize: '10px',
        fontWeight: 700,
        color: TIER_COLORS[tier],
        letterSpacing: '0.5px',
        lineHeight: 1,
        userSelect: 'none',
        cursor: 'default',
        minWidth: '22px',
      }}
    >
      {tier}
    </span>
  );
}
