import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { testGroqApiKey, groqComplete, groqListModels } from "../groq/GroqTextProvider.js";

// Helper to mock global fetch
function mockFetch(status: number, body = "") {
  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue({ data: [] }),
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
  return mockResponse;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testGroqApiKey", () => {
  it("returns valid=true when API responds with 200", async () => {
    mockFetch(200);
    const result = await testGroqApiKey("gsk_valid_key");
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.statusCode).toBeNull();
    expect(result.hint).toBeNull();
  });

  it("returns valid=false with statusCode=401 on unauthorized", async () => {
    mockFetch(401, '{"error":"Invalid API Key"}');
    const result = await testGroqApiKey("gsk_bad_key");
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.hint).toContain("Invalid API key");
  });

  it("returns valid=false with statusCode=403 on forbidden", async () => {
    mockFetch(403, '{"error":"Forbidden"}');
    const result = await testGroqApiKey("gsk_restricted_key");
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.hint).toContain("Access denied");
    expect(result.hint).toContain("llama-3.3-70b-versatile");
  });

  it("returns valid=false with statusCode=429 on rate limit", async () => {
    mockFetch(429, '{"error":"Too Many Requests"}');
    const result = await testGroqApiKey("gsk_rate_limited_key");
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.hint).toContain("Rate limit");
  });

  it("returns valid=false with statusCode=500 on server error", async () => {
    mockFetch(500, '{"error":"Internal Server Error"}');
    const result = await testGroqApiKey("gsk_valid_key");
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.hint).toContain("server error");
  });

  it("returns valid=false with hint for empty key", async () => {
    const result = await testGroqApiKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No API key");
    expect(result.hint).toBeDefined();
  });

  it("includes error message on failure", async () => {
    mockFetch(401, '{"error":"Invalid API Key"}');
    const result = await testGroqApiKey("gsk_bad");
    expect(result.error).toContain("401");
  });

  it("does not expose raw API key from upstream body in error message", async () => {
    mockFetch(401, '{"detail":"Invalid key sk-secret-key-1234 rejected"}');
    const result = await testGroqApiKey("gsk_bad");
    expect(result.error).not.toContain("sk-secret-key-1234");
    expect(result.error).toContain("[REDACTED]");
  });

  it("does not expose gsk_ token from upstream body in error message", async () => {
    mockFetch(403, '{"error":"token gsk_verysecrettoken123 is not authorized"}');
    const result = await testGroqApiKey("gsk_bad");
    expect(result.error).not.toContain("gsk_verysecrettoken123");
    expect(result.error).toContain("[REDACTED]");
  });

  it("truncates upstream body longer than 200 characters in error message", async () => {
    const longBody = "x".repeat(300);
    mockFetch(500, longBody);
    const result = await testGroqApiKey("gsk_key");
    expect(result.error!.length).toBeLessThan(300);
    expect(result.error).toContain("…");
  });
});

describe("groqComplete — secret redaction in errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws an error without raw secret token in message when upstream body contains sk-", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('{"error":"sk-leaked-secret-key is invalid"}'),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(
      groqComplete({ apiKey: "gsk_key", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("sk-leaked-secret-key") })
    );
  });

  it("throws an error with [REDACTED] when upstream body contains Bearer token", async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue("Bearer gsk_sometoken: forbidden"),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(
      groqComplete({ apiKey: "gsk_key", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(expect.objectContaining({ message: expect.stringContaining("[REDACTED]") }));
  });
});

describe("groqListModels — secret redaction in errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws an error without raw secret token when upstream body contains gsk_", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('{"error":"gsk_leaked123 is invalid"}'),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(groqListModels("gsk_key")).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("gsk_leaked123") })
    );
  });
});
