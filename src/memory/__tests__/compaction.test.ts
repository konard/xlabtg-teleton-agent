import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context, Message } from "@mariozechner/pi-ai";
import {
  extractCriticalIdentifiers,
  shouldCompact,
  shouldFlushMemory,
  CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  CompactionManager,
} from "../compaction.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUserMsg(content: string, ts = Date.now()): Message {
  return { role: "user", content, timestamp: ts };
}

function makeAssistantMsg(text: string, ts = Date.now()): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: ts,
  };
}

function makeContext(messageCount: number): Context {
  const messages: Message[] = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push(makeUserMsg(`msg ${i}`));
  }
  return { messages };
}

// ─── extractCriticalIdentifiers ──────────────────────────────────────────────

describe("extractCriticalIdentifiers", () => {
  it("extracts TON addresses from user messages", () => {
    const addr = "EQD4FPiA80ebStuyioxcmKoh_9juuSIoYBrmHE3Gm1JXXXXX";
    const msgs: Message[] = [makeUserMsg(`send to ${addr} please`)];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain(addr);
    expect(result).toContain("TON address");
  });

  it("extracts ETH addresses from user messages", () => {
    const addr = "0xAbcD1234567890aBcD1234567890aBcD12345678";
    const msgs: Message[] = [makeUserMsg(`my wallet is ${addr}`)];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain(addr);
    expect(result).toContain("ETH address");
  });

  it("extracts transaction hashes (64 hex chars)", () => {
    const hash = "a".repeat(64);
    const msgs: Message[] = [makeUserMsg(`tx: ${hash}`)];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain(hash);
    expect(result).toContain("tx hash");
  });

  it("extracts URLs from user messages", () => {
    const url = "https://example.com/some/path?foo=bar";
    const msgs: Message[] = [makeUserMsg(`see ${url}`)];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain(url);
    expect(result).toContain("URL");
  });

  it("extracts large numbers (6+ digits)", () => {
    const msgs: Message[] = [makeUserMsg("transfer 1234567 nanotons")];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain("1234567");
    expect(result).toContain("number");
  });

  it("extracts Telegram usernames", () => {
    const msgs: Message[] = [makeUserMsg("contact @alice_example please")];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain("@alice_example");
    expect(result).toContain("username");
  });

  it("extracts identifiers from assistant messages", () => {
    const addr = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";
    const msgs: Message[] = [makeAssistantMsg(`I found the address: ${addr}`)];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toContain(addr);
  });

  it("deduplicates repeated identifiers", () => {
    const addr = "0xAbcD1234567890aBcD1234567890aBcD12345678";
    const msgs: Message[] = [makeUserMsg(`wallet ${addr}`), makeUserMsg(`again ${addr}`)];
    const result = extractCriticalIdentifiers(msgs);
    const count = (result.match(new RegExp(addr, "g")) || []).length;
    expect(count).toBe(1);
  });

  it("returns empty string when no identifiers found", () => {
    const msgs: Message[] = [makeUserMsg("hello, how are you?")];
    const result = extractCriticalIdentifiers(msgs);
    expect(result).toBe("");
  });

  it("handles empty message array", () => {
    expect(extractCriticalIdentifiers([])).toBe("");
  });

  it("ignores toolResult messages (no text content to scan)", () => {
    const msgs: Message[] = [
      {
        role: "toolResult",
        content: "0xAbcD1234567890aBcD1234567890aBcD12345678",
        toolCallId: "1",
        toolName: "foo",
      } as unknown as Message,
    ];
    // Should not throw
    expect(() => extractCriticalIdentifiers(msgs)).not.toThrow();
  });
});

// ─── shouldCompact ────────────────────────────────────────────────────────────

describe("shouldCompact", () => {
  const config: CompactionConfig = {
    enabled: true,
    maxMessages: 5,
  };

  it("returns true when message count reaches maxMessages", () => {
    const ctx = makeContext(5);
    expect(shouldCompact(ctx, config)).toBe(true);
  });

  it("returns false when message count is below maxMessages", () => {
    const ctx = makeContext(4);
    expect(shouldCompact(ctx, config)).toBe(false);
  });

  it("returns false when compaction is disabled", () => {
    const ctx = makeContext(10);
    expect(shouldCompact(ctx, { enabled: false, maxMessages: 5 })).toBe(false);
  });

  it("returns true when token count exceeds maxTokens", () => {
    const ctx = makeContext(1);
    // Pass token count directly (larger than threshold)
    expect(shouldCompact(ctx, { enabled: true, maxTokens: 100 }, 200)).toBe(true);
  });

  it("returns false when neither threshold is exceeded", () => {
    const ctx = makeContext(2);
    expect(shouldCompact(ctx, { enabled: true, maxMessages: 10, maxTokens: 10000 }, 500)).toBe(
      false
    );
  });
});

// ─── shouldFlushMemory ───────────────────────────────────────────────────────

describe("shouldFlushMemory", () => {
  it("returns true when tokens >= softThresholdTokens", () => {
    const ctx = makeContext(1);
    const cfg: CompactionConfig = {
      enabled: true,
      memoryFlushEnabled: true,
      softThresholdTokens: 1000,
    };
    expect(shouldFlushMemory(ctx, cfg, 1500)).toBe(true);
  });

  it("returns false when tokens < softThresholdTokens", () => {
    const ctx = makeContext(1);
    const cfg: CompactionConfig = {
      enabled: true,
      memoryFlushEnabled: true,
      softThresholdTokens: 1000,
    };
    expect(shouldFlushMemory(ctx, cfg, 500)).toBe(false);
  });

  it("returns false when memoryFlushEnabled is false", () => {
    const ctx = makeContext(1);
    const cfg: CompactionConfig = {
      enabled: true,
      memoryFlushEnabled: false,
      softThresholdTokens: 100,
    };
    expect(shouldFlushMemory(ctx, cfg, 9999)).toBe(false);
  });

  it("returns false when compaction is disabled", () => {
    const ctx = makeContext(1);
    const cfg: CompactionConfig = {
      enabled: false,
      memoryFlushEnabled: true,
      softThresholdTokens: 100,
    };
    expect(shouldFlushMemory(ctx, cfg, 9999)).toBe(false);
  });
});

// ─── CompactionManager ────────────────────────────────────────────────────────

describe("CompactionManager", () => {
  it("getConfig returns current config", () => {
    const mgr = new CompactionManager({ enabled: false });
    expect(mgr.getConfig().enabled).toBe(false);
  });

  it("updateConfig merges partial config", () => {
    const mgr = new CompactionManager({ enabled: true, maxMessages: 100 });
    mgr.updateConfig({ maxMessages: 50 });
    expect(mgr.getConfig().maxMessages).toBe(50);
    expect(mgr.getConfig().enabled).toBe(true);
  });

  it("DEFAULT_COMPACTION_CONFIG has logCompaction and autoPreserve enabled", () => {
    expect(DEFAULT_COMPACTION_CONFIG.logCompaction).toBe(true);
    expect(DEFAULT_COMPACTION_CONFIG.autoPreserve).toBe(true);
  });

  it("checkAndCompact returns null when compaction is not needed", async () => {
    const mgr = new CompactionManager({ enabled: true, maxMessages: 1000 });
    const ctx = makeContext(5);
    const result = await mgr.checkAndCompact("sess-1", ctx, "fake-key");
    expect(result).toBeNull();
  });
});
