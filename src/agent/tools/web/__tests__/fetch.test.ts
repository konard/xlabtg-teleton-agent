import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../../types.js";

// Mock constants so retry delays are tiny and timeout is fast
vi.mock("../../../../constants/timeouts.js", () => ({
  RETRY_DEFAULT_MAX_ATTEMPTS: 3,
  RETRY_DEFAULT_BASE_DELAY_MS: 1,
  RETRY_DEFAULT_MAX_DELAY_MS: 1,
  RETRY_DEFAULT_TIMEOUT_MS: 5000,
  RETRY_BLOCKCHAIN_BASE_DELAY_MS: 1,
  RETRY_BLOCKCHAIN_MAX_DELAY_MS: 1,
  RETRY_BLOCKCHAIN_TIMEOUT_MS: 5000,
  RETRY_WEB_FETCH_TIMEOUT_MS: 100,
}));

vi.mock("../../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the Tavily client
const mockExtract = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ extract: mockExtract })),
}));

const { webFetchExecutor } = await import("../fetch.js");

function makeContext(tavilyKey?: string): ToolContext {
  return {
    bridge: {} as any,
    db: {} as any,
    chatId: "1",
    senderId: 1,
    isGroup: false,
    config: tavilyKey ? ({ tavily_api_key: tavilyKey } as any) : undefined,
  };
}

describe("webFetchExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when Tavily API key is not configured", async () => {
    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tavily_api_key/i);
  });

  it("returns error for invalid URL", async () => {
    const result = await webFetchExecutor({ url: "not-a-url" }, makeContext("key"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid URL");
  });

  it("returns error for blocked URL scheme", async () => {
    const result = await webFetchExecutor({ url: "ftp://example.com" }, makeContext("key"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked URL scheme/);
  });

  it("returns extracted content on success", async () => {
    mockExtract.mockResolvedValue({
      results: [{ title: "Example", rawContent: "Hello world" }],
      failedResults: [],
    });

    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext("key"));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      title: "Example",
      text: "Hello world",
      url: "https://example.com",
      truncated: false,
    });
  });

  it("truncates text longer than max_length", async () => {
    mockExtract.mockResolvedValue({
      results: [{ title: "Long page", rawContent: "a".repeat(100) }],
      failedResults: [],
    });

    const result = await webFetchExecutor(
      { url: "https://example.com", max_length: 10 },
      makeContext("key")
    );
    expect(result.success).toBe(true);
    expect((result.data as any).truncated).toBe(true);
    expect((result.data as any).text.length).toBe(10);
  });

  it("returns error when no content is extracted", async () => {
    mockExtract.mockResolvedValue({ results: [], failedResults: [] });

    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext("key"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No content extracted/);
  });

  it("returns failed result error message when available", async () => {
    mockExtract.mockResolvedValue({
      results: [],
      failedResults: [{ error: "403 Forbidden" }],
    });

    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext("key"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/403 Forbidden/);
  });

  it("retries up to 3 times on transient failure then succeeds", async () => {
    mockExtract
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        results: [{ title: "Recovered", rawContent: "content" }],
        failedResults: [],
      });

    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext("key"));
    expect(result.success).toBe(true);
    expect(mockExtract).toHaveBeenCalledTimes(3);
  });

  it("returns error after all retries are exhausted", async () => {
    mockExtract.mockRejectedValue(new Error("persistent error"));

    const result = await webFetchExecutor({ url: "https://example.com" }, makeContext("key"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("persistent error");
    expect(mockExtract).toHaveBeenCalledTimes(3);
  });

  it("returns a graceful timeout message when fetch times out", async () => {
    vi.useFakeTimers();

    mockExtract.mockImplementation(() => new Promise<never>(() => {})); // never resolves

    const promise = webFetchExecutor({ url: "https://example.com" }, makeContext("key"));

    // Advance past the per-attempt timeout (100ms) for all 3 attempts plus small backoffs
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 0\.1s/);

    vi.useRealTimers();
  });
});
