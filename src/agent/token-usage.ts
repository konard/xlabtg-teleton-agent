// ── Global token usage accumulator (in-memory, resets on restart) ───

import { getMetrics } from "../services/metrics.js";
import { getAnalytics } from "../services/analytics.js";

const globalTokenUsage = { totalTokens: 0, totalCost: 0 };

export function getTokenUsage() {
  return { ...globalTokenUsage };
}

export function accumulateTokenUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalCost: number;
}) {
  const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  globalTokenUsage.totalTokens += tokens;
  globalTokenUsage.totalCost += usage.totalCost;
  // Persist to metrics DB if initialized
  getMetrics()?.recordTokenUsage(tokens, usage.totalCost);
  // Persist daily cost record for the Analytics cost dashboard
  const analytics = getAnalytics();
  if (analytics && (usage.input > 0 || usage.output > 0 || usage.totalCost > 0)) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    analytics.upsertDailyCost(
      today,
      usage.input + usage.cacheRead + usage.cacheWrite,
      usage.output,
      usage.totalCost
    );
  }
}

export function resetTokenUsage() {
  globalTokenUsage.totalTokens = 0;
  globalTokenUsage.totalCost = 0;
}
