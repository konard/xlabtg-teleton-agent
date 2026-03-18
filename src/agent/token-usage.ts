// ── Global token usage accumulator (in-memory, resets on restart) ───

import { getMetrics } from "../services/metrics.js";

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
}

export function resetTokenUsage() {
  globalTokenUsage.totalTokens = 0;
  globalTokenUsage.totalCost = 0;
}
