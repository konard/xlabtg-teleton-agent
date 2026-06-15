import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { mutatingRateLimit, readRateLimit } from "../rate-limit.js";

type RateLimitEnv = {
  Variables: {
    keyPrefix: string;
  };
};

function createLimitedApp(middleware: MiddlewareHandler, keyPrefix: string) {
  const app = new Hono<RateLimitEnv>();

  app.use("*", async (c, next) => {
    c.set("keyPrefix", keyPrefix);
    return middleware(c, next);
  });

  app.get("/test", (c) => c.text("ok"));
  app.post("/test", (c) => c.text("ok"));

  return app;
}

async function requestStatuses(
  app: ReturnType<typeof createLimitedApp>,
  init: RequestInit,
  count: number
): Promise<number[]> {
  const statuses: number[] = [];

  for (let i = 0; i < count; i++) {
    const res = await app.request("/test", init);
    statuses.push(res.status);
  }

  return statuses;
}

describe("API rate-limit middleware", () => {
  it("enforces mutating rate limit across POST requests", async () => {
    const app = createLimitedApp(mutatingRateLimit, "mutating-regression");
    const statuses = await requestStatuses(app, { method: "POST" }, 11);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it("does not apply mutating rate limit to GET requests", async () => {
    const app = createLimitedApp(mutatingRateLimit, "mutating-get-bypass");
    const statuses = await requestStatuses(app, { method: "GET" }, 12);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it("enforces read rate limit across GET requests", async () => {
    const app = createLimitedApp(readRateLimit, "read-regression");
    const statuses = await requestStatuses(app, { method: "GET" }, 301);

    expect(statuses.slice(0, 300).every((status) => status === 200)).toBe(true);
    expect(statuses[300]).toBe(429);
  });

  it("does not apply read rate limit to POST requests", async () => {
    const app = createLimitedApp(readRateLimit, "read-post-bypass");
    const statuses = await requestStatuses(app, { method: "POST" }, 12);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
