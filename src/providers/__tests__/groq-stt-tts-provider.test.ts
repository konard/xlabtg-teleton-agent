import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Avoid real backoff delays from the rate limiter on retried errors.
vi.mock("../groq/rateLimiter.js", async (importActual) => {
  const actual = await importActual<typeof import("../groq/rateLimiter.js")>();
  return {
    ...actual,
    withGroqRateLimit: <T>(fn: () => Promise<T>) => fn(),
  };
});

import { groqTranscribe } from "../groq/GroqSTTProvider.js";
import { groqSpeak } from "../groq/GroqTTSProvider.js";

function mockGroqError(status: number, body: string) {
  const mockResponse = {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("groqTranscribe — error body sanitization", () => {
  it("sanitizes and truncates Groq STT upstream error bodies", async () => {
    mockGroqError(500, "x".repeat(5000) + " sk-secret-internal-detail");

    const err = await groqTranscribe(Buffer.from("audio"), "audio.mp3", {
      apiKey: "gsk_key",
    }).catch((e: Error) => e.message);

    expect(err.length).toBeLessThan(512);
    expect(err).not.toContain("sk-secret-internal-detail");
    expect(err).toContain("…");
  });

  it("redacts gsk_ tokens in STT error bodies", async () => {
    mockGroqError(403, '{"error":"token gsk_verysecrettoken123 not authorized"}');

    const err = await groqTranscribe(Buffer.from("audio"), "audio.mp3", {
      apiKey: "gsk_key",
    }).catch((e: Error) => e.message);

    expect(err).not.toContain("gsk_verysecrettoken123");
    expect(err).toContain("[REDACTED]");
  });
});

describe("groqSpeak — error body sanitization", () => {
  it("sanitizes and truncates Groq TTS upstream error bodies", async () => {
    mockGroqError(500, "x".repeat(5000) + " sk-secret-internal-detail");

    const err = await groqSpeak("hello", { apiKey: "gsk_key" }).catch((e: Error) => e.message);

    expect(err.length).toBeLessThan(512);
    expect(err).not.toContain("sk-secret-internal-detail");
    expect(err).toContain("…");
  });

  it("redacts Bearer tokens in TTS error bodies", async () => {
    mockGroqError(401, "Bearer gsk_sometoken: forbidden");

    const err = await groqSpeak("hello", { apiKey: "gsk_key" }).catch((e: Error) => e.message);

    expect(err).not.toContain("gsk_sometoken");
    expect(err).toContain("[REDACTED]");
  });
});
