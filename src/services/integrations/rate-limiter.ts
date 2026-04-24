import type { IntegrationRateLimitConfig } from "./base.js";

export interface GlobalIntegrationRateLimit {
  requestsPerMinute?: number;
  requestsPerHour?: number;
}

export class IntegrationRateLimitError extends Error {
  readonly scope: "global" | "integration";
  readonly retryAfterMs: number;

  constructor(scope: "global" | "integration", retryAfterMs: number) {
    super(
      scope === "global"
        ? "Global integration rate limit exceeded"
        : "Integration rate limit exceeded"
    );
    this.name = "IntegrationRateLimitError";
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface IntegrationRateLimiterOptions {
  global?: GlobalIntegrationRateLimit;
  now?: () => number;
}

interface WindowCheck {
  allowed: boolean;
  retryAfterMs: number;
}

export class IntegrationRateLimiter {
  private readonly global: GlobalIntegrationRateLimit;
  private readonly now: () => number;
  private readonly globalTimestamps: number[] = [];
  private readonly integrationTimestamps = new Map<string, number[]>();
  private readonly queueDepth = new Map<string, number>();

  constructor(options: IntegrationRateLimiterOptions = {}) {
    this.global = options.global ?? {};
    this.now = options.now ?? (() => Date.now());
  }

  async schedule<T>(
    integrationId: string,
    limits: IntegrationRateLimitConfig,
    task: () => Promise<T>
  ): Promise<T> {
    const decision = this.consume(integrationId, limits);
    if (decision.allowed) return task();

    if (limits.queue) {
      const depth = this.queueDepth.get(integrationId) ?? 0;
      const maxQueueSize = limits.maxQueueSize ?? 10;
      if (depth >= maxQueueSize) {
        throw new IntegrationRateLimitError(decision.scope, decision.retryAfterMs);
      }
      this.queueDepth.set(integrationId, depth + 1);
      try {
        await new Promise((resolve) => setTimeout(resolve, decision.retryAfterMs));
        return await this.schedule(integrationId, { ...limits, queue: false }, task);
      } finally {
        this.queueDepth.set(
          integrationId,
          Math.max(0, (this.queueDepth.get(integrationId) ?? 1) - 1)
        );
      }
    }

    throw new IntegrationRateLimitError(decision.scope, decision.retryAfterMs);
  }

  private consume(
    integrationId: string,
    limits: IntegrationRateLimitConfig
  ): { allowed: true } | { allowed: false; scope: "global" | "integration"; retryAfterMs: number } {
    const now = this.now();
    const globalCheck = checkLimits(this.globalTimestamps, this.global, now);
    if (!globalCheck.allowed) {
      return { allowed: false, scope: "global", retryAfterMs: globalCheck.retryAfterMs };
    }

    const integrationWindow = this.integrationTimestamps.get(integrationId) ?? [];
    const integrationCheck = checkLimits(integrationWindow, limits, now);
    if (!integrationCheck.allowed) {
      this.integrationTimestamps.set(integrationId, integrationWindow);
      return {
        allowed: false,
        scope: "integration",
        retryAfterMs: integrationCheck.retryAfterMs,
      };
    }

    this.globalTimestamps.push(now);
    integrationWindow.push(now);
    this.integrationTimestamps.set(integrationId, integrationWindow);
    return { allowed: true };
  }
}

function checkLimits(
  timestamps: number[],
  limits: GlobalIntegrationRateLimit,
  now: number
): WindowCheck {
  prune(timestamps, now - 60 * 60 * 1000);
  const minuteLimit = limits.requestsPerMinute;
  if (minuteLimit && countSince(timestamps, now - 60 * 1000) >= minuteLimit) {
    return {
      allowed: false,
      retryAfterMs: retryAfter(timestamps, now, 60 * 1000, minuteLimit),
    };
  }

  const hourLimit = limits.requestsPerHour;
  if (hourLimit && timestamps.length >= hourLimit) {
    return {
      allowed: false,
      retryAfterMs: retryAfter(timestamps, now, 60 * 60 * 1000, hourLimit),
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

function prune(timestamps: number[], cutoff: number): void {
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
}

function countSince(timestamps: number[], cutoff: number): number {
  let count = 0;
  for (const timestamp of timestamps) {
    if (timestamp >= cutoff) count++;
  }
  return count;
}

function retryAfter(timestamps: number[], now: number, windowMs: number, limit: number): number {
  const relevant = timestamps.filter((timestamp) => timestamp >= now - windowMs);
  const oldestBlocking = relevant[Math.max(0, relevant.length - limit)];
  if (!oldestBlocking) return windowMs;
  return Math.max(1, oldestBlocking + windowMs - now);
}
