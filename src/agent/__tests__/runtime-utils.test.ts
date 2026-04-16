import { describe, it, expect } from "vitest";
import {
  isContextOverflowError,
  isTrivialMessage,
  parseRetryAfterMs,
  isNetworkError,
  isNetworkErrorMessage,
  trimRagContext,
  LoopStallDetector,
} from "../../agent/runtime-utils.js";
import { AgentConfigSchema } from "../../config/schema.js";

// ─── T10: isContextOverflowError ────────────────────────────────

describe("isContextOverflowError (replicated from runtime.ts — not exported)", () => {
  it("T10a: detects 'prompt is too long'", () => {
    expect(isContextOverflowError("Error: prompt is too long for this model")).toBe(true);
  });

  it("T10b: detects 'context length exceeded'", () => {
    expect(isContextOverflowError("context length exceeded: 200000 > 128000")).toBe(true);
  });

  it("T10c: detects 'maximum context length'", () => {
    expect(isContextOverflowError("This model's maximum context length is 128000 tokens")).toBe(
      true
    );
  });

  it("T10d: detects 'too many tokens'", () => {
    expect(isContextOverflowError("too many tokens in the request")).toBe(true);
  });

  it("T10e: detects 'request_too_large'", () => {
    expect(isContextOverflowError("request_too_large")).toBe(true);
  });

  it("T10f: detects compound 'exceeds' + 'maximum'", () => {
    expect(isContextOverflowError("Input exceeds the maximum allowed size")).toBe(true);
  });

  it("T10g: detects compound 'context' + 'limit'", () => {
    expect(isContextOverflowError("You have hit the context limit for this conversation")).toBe(
      true
    );
  });

  it("T10h: case-insensitive detection", () => {
    expect(isContextOverflowError("PROMPT IS TOO LONG")).toBe(true);
    expect(isContextOverflowError("Context Length Exceeded")).toBe(true);
    expect(isContextOverflowError("TOO MANY TOKENS")).toBe(true);
  });

  it("T10i: returns false for unrelated errors", () => {
    expect(isContextOverflowError("Rate limit exceeded")).toBe(false);
    expect(isContextOverflowError("Internal server error")).toBe(false);
    expect(isContextOverflowError("Connection timeout")).toBe(false);
    expect(isContextOverflowError("Invalid API key")).toBe(false);
    expect(isContextOverflowError("502 Bad Gateway")).toBe(false);
  });

  it("T10j: returns false for undefined/empty", () => {
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError("")).toBe(false);
  });

  it("T10k: does not false-positive on partial matches", () => {
    // "exceeds" alone without "maximum" → false
    expect(isContextOverflowError("Rate exceeds allowed threshold")).toBe(false);
    // "maximum" alone without "exceeds" → false
    expect(isContextOverflowError("maximum retries reached")).toBe(false);
    // "context" alone without "limit" → false
    expect(isContextOverflowError("context is empty")).toBe(false);
    // "limit" alone without "context" → false
    expect(isContextOverflowError("rate limit reached")).toBe(false);
  });
});

// ─── T11: isTrivialMessage ──────────────────────────────────────

describe("isTrivialMessage (replicated from runtime.ts — not exported)", () => {
  it("T11a: 'ok' is trivial", () => {
    expect(isTrivialMessage("ok")).toBe(true);
  });

  it("T11b: 'K' (uppercase) is trivial", () => {
    expect(isTrivialMessage("K")).toBe(true);
  });

  it("T11c: 'oui' is trivial", () => {
    expect(isTrivialMessage("oui")).toBe(true);
  });

  it("T11d: 'merci' is trivial", () => {
    expect(isTrivialMessage("merci")).toBe(true);
  });

  it("T11e: 'ok let me check' is NOT trivial (multi-word)", () => {
    expect(isTrivialMessage("ok let me check")).toBe(false);
  });

  it("T11f: pure emoji is trivial (no alphanumeric chars)", () => {
    expect(isTrivialMessage("👍")).toBe(true);
    expect(isTrivialMessage("😂🔥")).toBe(true);
    expect(isTrivialMessage("🎉✨💯")).toBe(true);
  });

  it("T11g: empty/whitespace is trivial", () => {
    expect(isTrivialMessage("")).toBe(true);
    expect(isTrivialMessage("   ")).toBe(true);
    expect(isTrivialMessage("\n\t")).toBe(true);
  });

  it("T11h: all trivial keywords detected", () => {
    const trivialWords = [
      "ok",
      "okay",
      "k",
      "oui",
      "non",
      "yes",
      "no",
      "yep",
      "nope",
      "sure",
      "thanks",
      "merci",
      "thx",
      "ty",
      "lol",
      "haha",
      "cool",
      "nice",
      "wow",
      "bravo",
      "top",
      "parfait",
      "d'accord",
      "alright",
      "fine",
      "got it",
      "np",
      "gg",
    ];
    for (const word of trivialWords) {
      expect(isTrivialMessage(word)).toBe(true);
    }
  });

  it("T11i: trivial words with trailing punctuation", () => {
    expect(isTrivialMessage("ok.")).toBe(true);
    expect(isTrivialMessage("ok!")).toBe(true);
    expect(isTrivialMessage("merci!")).toBe(true);
    expect(isTrivialMessage("cool.")).toBe(true);
  });

  it("T11j: case-insensitive trivial detection", () => {
    expect(isTrivialMessage("OK")).toBe(true);
    expect(isTrivialMessage("Merci")).toBe(true);
    expect(isTrivialMessage("COOL")).toBe(true);
    expect(isTrivialMessage("Yes")).toBe(true);
    expect(isTrivialMessage("GG")).toBe(true);
  });

  it("T11k: leading/trailing whitespace stripped", () => {
    expect(isTrivialMessage("  ok  ")).toBe(true);
    expect(isTrivialMessage("\nmerci\n")).toBe(true);
  });

  it("T11l: non-trivial messages are detected as non-trivial", () => {
    expect(isTrivialMessage("What is the TON price?")).toBe(false);
    expect(isTrivialMessage("Send 1 TON to EQ...")).toBe(false);
    expect(isTrivialMessage("Can you check my balance?")).toBe(false);
    expect(isTrivialMessage("hello there")).toBe(false);
    expect(isTrivialMessage("ok but also check this")).toBe(false);
  });

  it("T11m: Cyrillic alphanumeric alone (without trivial pattern) is non-trivial", () => {
    expect(isTrivialMessage("Привет")).toBe(false);
    expect(isTrivialMessage("Да конечно")).toBe(false);
  });

  it("T11n: pure symbols (no letters/digits) are trivial", () => {
    expect(isTrivialMessage("...")).toBe(true);
    expect(isTrivialMessage("!!!")).toBe(true);
    expect(isTrivialMessage("???")).toBe(true);
    expect(isTrivialMessage("—")).toBe(true);
  });
});

// ─── T12: parseRetryAfterMs ─────────────────────────────────────

describe("parseRetryAfterMs", () => {
  it("T12a: parses 'retry-after: 30' → 30000ms", () => {
    expect(parseRetryAfterMs("429 Too Many Requests retry-after: 30")).toBe(30_000);
  });

  it("T12b: parses 'Retry-After: 60' (capital letters)", () => {
    expect(parseRetryAfterMs("Rate limit hit. Retry-After: 60")).toBe(60_000);
  });

  it("T12c: parses 'retry_after: 5'", () => {
    expect(parseRetryAfterMs("retry_after: 5")).toBe(5_000);
  });

  it("T12d: returns null when no Retry-After header present", () => {
    expect(parseRetryAfterMs("429 Rate limit reached for requests")).toBeNull();
  });

  it("T12e: returns null for empty string", () => {
    expect(parseRetryAfterMs("")).toBeNull();
  });

  it("T12f: returns null for unrelated error messages", () => {
    expect(parseRetryAfterMs("Internal server error 500")).toBeNull();
  });
});

// ─── T13: isNetworkError ─────────────────────────────────────────

describe("isNetworkError", () => {
  it("T13a: detects 'network_error' from provider library (e.g. Anthropic finish reason)", () => {
    expect(isNetworkError(new Error("Unhandled stop reason: network_error"))).toBe(true);
  });

  it("T13b: detects 'network error' (with space)", () => {
    expect(isNetworkError(new Error("API network error occurred"))).toBe(true);
  });

  it("T13c: detects ECONNRESET", () => {
    expect(isNetworkError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("T13d: detects ECONNREFUSED", () => {
    expect(isNetworkError(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(true);
  });

  it("T13e: detects ETIMEDOUT", () => {
    expect(isNetworkError(new Error("connect ETIMEDOUT 10.0.0.1:443"))).toBe(true);
  });

  it("T13f: detects 'fetch failed'", () => {
    expect(isNetworkError(new Error("fetch failed"))).toBe(true);
  });

  it("T13g: detects 'Unhandled stop reason' (generic provider error)", () => {
    expect(isNetworkError(new Error("Unhandled stop reason: connection_error"))).toBe(true);
  });

  it("T13h: case-insensitive matching", () => {
    expect(isNetworkError(new Error("NETWORK_ERROR encountered"))).toBe(true);
    expect(isNetworkError(new Error("Fetch Failed"))).toBe(true);
  });

  it("T13i: returns false for non-network errors", () => {
    expect(isNetworkError(new Error("Rate limit exceeded"))).toBe(false);
    expect(isNetworkError(new Error("Internal server error"))).toBe(false);
    expect(isNetworkError(new Error("Invalid API key"))).toBe(false);
    expect(isNetworkError(new Error("Context length exceeded"))).toBe(false);
  });

  it("T13j: returns false for non-Error values", () => {
    expect(isNetworkError("network_error")).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });

  it("T13k: detects TimeoutError thrown by AbortSignal.timeout()", () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(isNetworkError(err)).toBe(true);
  });

  it("T13l: detects AbortError thrown when AbortController.abort() is called", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(isNetworkError(err)).toBe(true);
  });
});

// ─── T14: isNetworkErrorMessage ──────────────────────────────────

describe("isNetworkErrorMessage", () => {
  it("T14a: detects 'Provider finish_reason: network_error' (zai/openai-compat stopReason:error path)", () => {
    expect(isNetworkErrorMessage("Provider finish_reason: network_error")).toBe(true);
  });

  it("T14b: detects plain 'network_error'", () => {
    expect(isNetworkErrorMessage("network_error")).toBe(true);
  });

  it("T14c: detects 'network error' (with space)", () => {
    expect(isNetworkErrorMessage("API network error occurred")).toBe(true);
  });

  it("T14d: detects ECONNRESET", () => {
    expect(isNetworkErrorMessage("read ECONNRESET")).toBe(true);
  });

  it("T14e: detects ECONNREFUSED", () => {
    expect(isNetworkErrorMessage("connect ECONNREFUSED 127.0.0.1:443")).toBe(true);
  });

  it("T14f: detects ETIMEDOUT", () => {
    expect(isNetworkErrorMessage("connect ETIMEDOUT 10.0.0.1:443")).toBe(true);
  });

  it("T14g: detects 'fetch failed'", () => {
    expect(isNetworkErrorMessage("fetch failed")).toBe(true);
  });

  it("T14h: detects 'Unhandled stop reason' (thrown by provider library)", () => {
    expect(isNetworkErrorMessage("Unhandled stop reason: network_error")).toBe(true);
  });

  it("T14i: case-insensitive matching", () => {
    expect(isNetworkErrorMessage("NETWORK_ERROR encountered")).toBe(true);
    expect(isNetworkErrorMessage("Fetch Failed")).toBe(true);
  });

  it("T14j: returns false for non-network error messages", () => {
    expect(isNetworkErrorMessage("Rate limit exceeded")).toBe(false);
    expect(isNetworkErrorMessage("Internal server error")).toBe(false);
    expect(isNetworkErrorMessage("Invalid API key")).toBe(false);
    expect(isNetworkErrorMessage("Context length exceeded")).toBe(false);
  });

  it("T14k: returns false for empty string", () => {
    expect(isNetworkErrorMessage("")).toBe(false);
  });

  it("T14l: detects 'Connection error' (ZAI provider stopReason:error path)", () => {
    expect(isNetworkErrorMessage("Connection error.")).toBe(true);
    expect(isNetworkErrorMessage("connection error")).toBe(true);
  });

  it("T14m: detects 'Request timed out' (ZAI provider stopReason:error path)", () => {
    expect(isNetworkErrorMessage("Request timed out.")).toBe(true);
    expect(isNetworkErrorMessage("request timed out")).toBe(true);
  });
});

// ─── T15: trimRagContext ─────────────────────────────────────────

describe("trimRagContext", () => {
  it("T15a: returns context unchanged when maxChars is undefined", () => {
    const ctx = "knowledge chunk 1\n---\nknowledge chunk 2";
    expect(trimRagContext(ctx, undefined)).toBe(ctx);
  });

  it("T15b: returns context unchanged when length <= maxChars", () => {
    const ctx = "short context";
    expect(trimRagContext(ctx, 100)).toBe(ctx);
    expect(trimRagContext(ctx, ctx.length)).toBe(ctx);
  });

  it("T15c: trims context and appends marker when length > maxChars", () => {
    const ctx = "abcdefghijklmnopqrstuvwxyz";
    const result = trimRagContext(ctx, 10);
    expect(result).toBe("abcdefghij\n...[context trimmed]");
  });

  it("T15d: returns context unchanged when maxChars equals exact length", () => {
    const ctx = "exactly ten";
    expect(trimRagContext(ctx, ctx.length)).toBe(ctx);
  });

  it("T15e: trims at maxChars=1 (edge case — minimum allowed in schema is 500 but logic handles any positive int)", () => {
    const result = trimRagContext("hello", 1);
    expect(result).toBe("h\n...[context trimmed]");
  });

  it("T15f: returns empty string unchanged when maxChars is undefined", () => {
    expect(trimRagContext("", undefined)).toBe("");
  });

  it("T15g: returns empty string unchanged when maxChars > 0", () => {
    expect(trimRagContext("", 500)).toBe("");
  });
});

// ─── T16: AgentConfigSchema max_rag_chars ────────────────────────

describe("AgentConfigSchema max_rag_chars", () => {
  it("T16a: accepts valid max_rag_chars value", () => {
    const result = AgentConfigSchema.safeParse({ max_rag_chars: 4000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_rag_chars).toBe(4000);
  });

  it("T16b: omitting max_rag_chars leaves it undefined (no default limit)", () => {
    const result = AgentConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_rag_chars).toBeUndefined();
  });

  it("T16c: rejects max_rag_chars below minimum (500)", () => {
    const result = AgentConfigSchema.safeParse({ max_rag_chars: 499 });
    expect(result.success).toBe(false);
  });

  it("T16d: accepts max_rag_chars at exactly minimum (500)", () => {
    const result = AgentConfigSchema.safeParse({ max_rag_chars: 500 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_rag_chars).toBe(500);
  });

  it("T16e: rejects non-integer max_rag_chars", () => {
    const result = AgentConfigSchema.safeParse({ max_rag_chars: 4000.5 });
    expect(result.success).toBe(false);
  });
});

// ─── T17: Empty-response fallback condition ordering (issue #133) ────────────
//
// Replicates the condition logic from runtime.ts to verify correct precedence:
//   1. Zero-tokens first  → API-level failure, tools may not have run
//   2. Telegram send tool → silent success, no text needed
//   3. Tools ran but no text → LLM didn't generate a summary (most common issue)
//
// Previously, condition 3 was first, making condition 1 unreachable when
// totalToolCalls.length > 0.

function classifyEmptyResponse(opts: {
  content: string;
  totalToolCalls: string[];
  usedTelegramSendTool: boolean;
  inputTokens: number;
  outputTokens: number;
}): string {
  const { content, totalToolCalls, usedTelegramSendTool, inputTokens, outputTokens } = opts;
  if (!content && inputTokens === 0 && outputTokens === 0) {
    return "zero-tokens";
  } else if (!content && usedTelegramSendTool) {
    return "telegram-sent";
  } else if (!content && totalToolCalls.length > 0) {
    return "empty-after-tools";
  }
  return "has-content";
}

describe("Empty-response fallback condition ordering (issue #133)", () => {
  it("T17a: zero-token case is classified correctly even when tool calls present", () => {
    const result = classifyEmptyResponse({
      content: "",
      totalToolCalls: ["ton_trading_get_portfolio"],
      usedTelegramSendTool: false,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(result).toBe("zero-tokens");
  });

  it("T17b: telegram-send case is classified correctly (content empty, no text needed)", () => {
    const result = classifyEmptyResponse({
      content: "",
      totalToolCalls: ["telegram_send_message"],
      usedTelegramSendTool: true,
      inputTokens: 1000,
      outputTokens: 50,
    });
    expect(result).toBe("telegram-sent");
  });

  it("T17c: tools ran with tokens consumed but LLM returned no text → empty-after-tools", () => {
    // This is the primary scenario from issue #133:
    // tools executed (✓ in logs), tokens consumed (145.1K in, 980 out), but content is empty
    const result = classifyEmptyResponse({
      content: "",
      totalToolCalls: [
        "ton_trading_get_portfolio",
        "ton_trading_get_arbitrage_opportunities",
        "ton_trading_validate_token",
        "ton_trading_calculate_risk_metrics",
      ],
      usedTelegramSendTool: false,
      inputTokens: 145100,
      outputTokens: 980,
    });
    expect(result).toBe("empty-after-tools");
  });

  it("T17d: non-empty content passes through without fallback", () => {
    const result = classifyEmptyResponse({
      content: "Your portfolio contains 3 tokens.",
      totalToolCalls: ["ton_trading_get_portfolio"],
      usedTelegramSendTool: false,
      inputTokens: 5000,
      outputTokens: 20,
    });
    expect(result).toBe("has-content");
  });

  it("T17e: zero tokens with no tool calls → zero-tokens (API issue, not tool failure)", () => {
    const result = classifyEmptyResponse({
      content: "",
      totalToolCalls: [],
      usedTelegramSendTool: false,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(result).toBe("zero-tokens");
  });
});

// ─── T18: generateToolSummary fallback (issue #135) ──────────────────────────
//
// Replicates the generateToolSummary() logic from runtime.ts to verify
// that complex tool chain empty-response fallback produces meaningful output
// instead of a generic "couldn't generate a response" message.

function generateToolSummary(
  results: Array<{ toolName: string; result: { success: boolean; data?: unknown; error?: string } }>
): string {
  const successes = results.filter((r) => r.result.success);
  const failures = results.filter((r) => !r.result.success);

  if (failures.length === 0) {
    const names = successes.map((r) => r.toolName).join(", ");
    return `✅ Completed ${successes.length} operation${successes.length !== 1 ? "s" : ""} (${names}).`;
  } else if (successes.length === 0) {
    const errors = failures
      .map((r) => `${r.toolName}: ${r.result.error || "unknown error"}`)
      .join("; ");
    return `⚠️ ${failures.length} operation${failures.length !== 1 ? "s" : ""} failed: ${errors}`;
  } else {
    const errorDetails = failures
      .map((r) => `${r.toolName}: ${r.result.error || "unknown error"}`)
      .join("; ");
    return (
      `✅ ${successes.length} succeeded, ⚠️ ${failures.length} failed. ` + `Errors: ${errorDetails}`
    );
  }
}

describe("generateToolSummary fallback (issue #135)", () => {
  it("T18a: all tools succeed → lists tool names with checkmark", () => {
    const result = generateToolSummary([
      { toolName: "ton_trading_get_portfolio", result: { success: true } },
      { toolName: "ton_trading_get_arbitrage_opportunities", result: { success: true } },
      { toolName: "ton_trading_validate_token", result: { success: true } },
      { toolName: "ton_trading_calculate_risk_metrics", result: { success: true } },
    ]);
    expect(result).toContain("✅");
    expect(result).toContain("4 operations");
    expect(result).toContain("ton_trading_get_portfolio");
    expect(result).toContain("ton_trading_calculate_risk_metrics");
  });

  it("T18b: all tools fail → reports errors with tool names", () => {
    const result = generateToolSummary([
      {
        toolName: "tonapi_account_jettons",
        result: { success: false, error: "API key invalid" },
      },
      {
        toolName: "ton_trading_simulate_trade",
        result: { success: false, error: "Insufficient balance" },
      },
    ]);
    expect(result).toContain("⚠️");
    expect(result).toContain("2 operations failed");
    expect(result).toContain("API key invalid");
    expect(result).toContain("Insufficient balance");
  });

  it("T18c: mixed results → reports both successes and failures", () => {
    const result = generateToolSummary([
      { toolName: "ton_trading_get_portfolio", result: { success: true } },
      { toolName: "ton_trading_validate_token", result: { success: true } },
      {
        toolName: "ton_trading_simulate_trade",
        result: { success: false, error: "Slippage too high" },
      },
    ]);
    expect(result).toContain("✅ 2 succeeded");
    expect(result).toContain("⚠️ 1 failed");
    expect(result).toContain("Slippage too high");
  });

  it("T18d: single successful tool → singular 'operation' (not 'operations')", () => {
    const result = generateToolSummary([{ toolName: "ton_price", result: { success: true } }]);
    expect(result).toContain("1 operation");
    expect(result).not.toContain("1 operations");
  });

  it("T18e: failure with no error message → shows 'unknown error'", () => {
    const result = generateToolSummary([
      { toolName: "ton_trading_validate_token", result: { success: false } },
    ]);
    expect(result).toContain("unknown error");
  });
});

// ─── T19: LoopStallDetector ─────────────────────────────────────

describe("LoopStallDetector", () => {
  it("T19a: returns false on first occurrence of a signature set", () => {
    const detector = new LoopStallDetector(3);
    expect(detector.record(['tool_a:{"x":1}'])).toBe(false);
  });

  it("T19b: returns false on second consecutive repeat (below threshold)", () => {
    const detector = new LoopStallDetector(3);
    detector.record(['tool_a:{"x":1}']);
    expect(detector.record(['tool_a:{"x":1}'])).toBe(false);
  });

  it("T19c: returns true on third consecutive repeat (at threshold)", () => {
    const detector = new LoopStallDetector(3);
    const sigs = ['tool_a:{"x":1}'];
    detector.record(sigs);
    detector.record(sigs);
    expect(detector.record(sigs)).toBe(true);
  });

  it("T19d: resets counter when a different tool call set appears", () => {
    const detector = new LoopStallDetector(3);
    const sigs = ['tool_a:{"x":1}'];
    detector.record(sigs);
    detector.record(sigs); // count = 2
    detector.record(['tool_b:{"y":2}']); // different — resets
    // Now back to same sigs: should start counting from 1 again
    detector.record(sigs); // count = 1
    expect(detector.record(sigs)).toBe(false); // count = 2, still below threshold=3
  });

  it("T19e: does not trigger on non-consecutive repeats (previous bug reproduction)", () => {
    // This test reproduces the original bug: the agent legitimately calls memory_read
    // twice during a task (before and after a write), which should NOT be a stall.
    const detector = new LoopStallDetector(3);
    const readSig = ['memory_read:{"key":"balance"}'];
    const writeSig = ['memory_write:{"key":"balance","value":"100"}'];

    detector.record(readSig); // iter 1: read (new)
    detector.record(writeSig); // iter 2: write (new, resets)
    const result = detector.record(readSig); // iter 3: read again — non-consecutive, fine
    expect(result).toBe(false);
  });

  it("T19f: empty signatures never trigger stall", () => {
    const detector = new LoopStallDetector(3);
    expect(detector.record([])).toBe(false);
    expect(detector.record([])).toBe(false);
    expect(detector.record([])).toBe(false);
    expect(detector.record([])).toBe(false);
  });

  it("T19g: threshold=1 triggers on the very first call", () => {
    const detector = new LoopStallDetector(1);
    expect(detector.record(['tool_a:{"x":1}'])).toBe(true);
  });

  it("T19h: signature order within an iteration does not affect detection", () => {
    // Two tool calls with the same params but different order in the array
    // should produce the same signature key (sorted internally)
    const detector = new LoopStallDetector(3);
    const sigs1 = ['tool_b:{"y":2}', 'tool_a:{"x":1}'];
    const sigs2 = ['tool_a:{"x":1}', 'tool_b:{"y":2}'];
    detector.record(sigs1);
    detector.record(sigs2); // same set, different order → same key → count = 2
    expect(detector.record(sigs1)).toBe(true); // count = 3 → stall
  });

  it("T19i: multiple tool calls — partial overlap is not a stall", () => {
    const detector = new LoopStallDetector(3);
    const sigs1 = ["tool_a:{}", "tool_b:{}"];
    const sigs2 = ["tool_a:{}", "tool_c:{}"]; // one changed
    detector.record(sigs1);
    detector.record(sigs1); // count = 2
    // sigs2 is different — resets counter
    expect(detector.record(sigs2)).toBe(false);
  });
});
