import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  info: vi.fn(),
  query: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@upstash/vector", () => ({
  Index: vi.fn(function () {
    return {
      delete: mocks.delete,
      info: mocks.info,
      query: mocks.query,
      upsert: mocks.upsert,
    };
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { UpstashSemanticVectorStore } from "../vector-store.js";

function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("UpstashSemanticVectorStore timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reports fallback when the Upstash health check times out", async () => {
    vi.useFakeTimers();
    mocks.info.mockReturnValue(pending());
    const store = new UpstashSemanticVectorStore({
      url: "https://example.upstash.io",
      token: "token",
      requestTimeoutMs: 25,
    });

    const statusPromise = store.healthCheck();
    const expectation = expect(statusPromise).resolves.toMatchObject({
      mode: "fallback",
      reason: expect.stringContaining("timed out"),
    });
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("fails semantic search quickly when Upstash does not respond", async () => {
    vi.useFakeTimers();
    mocks.query.mockReturnValue(pending());
    const store = new UpstashSemanticVectorStore({
      url: "https://example.upstash.io",
      token: "token",
      requestTimeoutMs: 25,
    });

    const searchPromise = store.searchKnowledge([0.1, 0.2], 3);
    const expectation = expect(searchPromise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });
});
