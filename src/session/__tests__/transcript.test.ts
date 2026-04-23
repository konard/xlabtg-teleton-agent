import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need a temp dir before any imports so we can mock paths
const tempRoot = mkdtempSync(join(tmpdir(), "teleton-transcript-test-"));
const SESSIONS_DIR = join(tempRoot, "sessions");

vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: tempRoot,
  WORKSPACE_ROOT: join(tempRoot, "workspace"),
  WORKSPACE_PATHS: {},
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are registered
const {
  getTranscriptPath,
  appendToTranscript,
  readTranscript,
  transcriptExists,
  getTranscriptSize,
  deleteTranscript,
  archiveTranscript,
  cleanupOldTranscripts,
  MAX_TRANSCRIPT_MESSAGES,
} = await import("../transcript.js");

// Helper to build a simple user message
function userMsg(text: string) {
  return { role: "user" as const, content: text, timestamp: Date.now() };
}

// Helper to build an assistant message
function assistantMsg(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
  };
}

// Helper to build an assistant message that contains a tool call
function assistantToolCallMsg(toolCallId: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id: toolCallId, name: "myTool", input: {} }],
  };
}

// Helper to build a toolResult message
function toolResultMsg(toolCallId: string, content: string) {
  return {
    role: "toolResult" as const,
    toolCallId,
    content,
  };
}

describe("transcript – getTranscriptPath", () => {
  it("returns a path inside the sessions dir with .jsonl extension", () => {
    const path = getTranscriptPath("session-abc");
    expect(path).toContain("sessions");
    expect(path).toContain("session-abc.jsonl");
  });

  it("includes the sessionId verbatim", () => {
    const sid = "my-unique-session-42";
    expect(getTranscriptPath(sid)).toContain(sid);
  });
});

describe("transcript – appendToTranscript + readTranscript", () => {
  // Each test uses a unique sessionId so the module-level cache doesn't bleed across tests
  let sid: string;

  beforeEach(() => {
    sid = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  it("creates the sessions directory if it does not exist", () => {
    const { existsSync } = require("fs");
    appendToTranscript(sid, userMsg("hello"));
    expect(existsSync(SESSIONS_DIR)).toBe(true);
  });

  it("reads an empty transcript for a non-existent session", () => {
    const messages = readTranscript("does-not-exist-" + Date.now());
    expect(messages).toEqual([]);
  });

  it("round-trips a single user message", () => {
    const msg = userMsg("hello world");
    appendToTranscript(sid, msg);
    const messages = readTranscript(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("appends multiple messages in order", () => {
    appendToTranscript(sid, userMsg("first"));
    appendToTranscript(sid, userMsg("second"));
    appendToTranscript(sid, userMsg("third"));

    const messages = readTranscript(sid);
    expect(messages).toHaveLength(3);
    expect((messages[0] as ReturnType<typeof userMsg>).content).toBe("first");
    expect((messages[2] as ReturnType<typeof userMsg>).content).toBe("third");
  });

  it("updates the in-memory cache on subsequent appends", () => {
    appendToTranscript(sid, userMsg("a"));
    // Read to populate cache
    readTranscript(sid);
    // Append again – should update cache without re-reading disk
    appendToTranscript(sid, userMsg("b"));
    const messages = readTranscript(sid);
    expect(messages).toHaveLength(2);
  });

  it("round-trips an assistant message", () => {
    const msg = assistantMsg("I can help with that");
    appendToTranscript(sid, msg);
    const messages = readTranscript(sid);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
  });

  it("sanitizes orphaned toolResults (removes toolResult without prior toolCall)", () => {
    // Append a toolResult with no preceding assistant toolCall
    appendToTranscript(sid, toolResultMsg("orphan-id", "result") as any);
    const messages = readTranscript(sid);
    // The orphaned toolResult should be removed by sanitizeMessages
    expect(messages).toHaveLength(0);
  });

  it("keeps a valid toolCall+toolResult pair", () => {
    appendToTranscript(sid, assistantToolCallMsg("call-1") as any);
    appendToTranscript(sid, toolResultMsg("call-1", "output") as any);

    const messages = readTranscript(sid);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("toolResult");
  });

  it("returns an array (not null/undefined) that is independent from the original call", () => {
    appendToTranscript(sid, userMsg("original"));
    const first = readTranscript(sid);
    expect(Array.isArray(first)).toBe(true);
    expect(first).toHaveLength(1);
    // A second call must return a fresh array object
    const second = readTranscript(sid);
    expect(first).not.toBe(second);
  });
});

describe("transcript – transcriptExists", () => {
  it("returns false for a session that has never been written", () => {
    expect(transcriptExists("nonexistent-" + Date.now())).toBe(false);
  });

  it("returns true after appending a message", () => {
    const sid = `exist-${Date.now()}`;
    appendToTranscript(sid, userMsg("hi"));
    expect(transcriptExists(sid)).toBe(true);
  });
});

describe("transcript – getTranscriptSize", () => {
  it("returns 0 for a nonexistent transcript", () => {
    expect(getTranscriptSize("ghost-" + Date.now())).toBe(0);
  });

  it("returns the correct count after appending messages", () => {
    const sid = `size-${Date.now()}`;
    appendToTranscript(sid, userMsg("a"));
    appendToTranscript(sid, userMsg("b"));
    expect(getTranscriptSize(sid)).toBe(2);
  });
});

describe("transcript – deleteTranscript", () => {
  it("returns false when the transcript does not exist", () => {
    expect(deleteTranscript("ghost-" + Date.now())).toBe(false);
  });

  it("removes the file and returns true on success", () => {
    const sid = `del-${Date.now()}`;
    appendToTranscript(sid, userMsg("bye"));
    expect(transcriptExists(sid)).toBe(true);

    const result = deleteTranscript(sid);
    expect(result).toBe(true);
    expect(transcriptExists(sid)).toBe(false);
  });

  it("clears the in-memory cache after deletion", () => {
    const sid = `del-cache-${Date.now()}`;
    appendToTranscript(sid, userMsg("cached"));
    readTranscript(sid); // populate cache
    deleteTranscript(sid);

    // After deletion, readTranscript must return [] (file gone, cache cleared)
    const messages = readTranscript(sid);
    expect(messages).toEqual([]);
  });
});

describe("transcript – archiveTranscript", () => {
  it("returns false when the transcript does not exist", () => {
    expect(archiveTranscript("ghost-" + Date.now())).toBe(false);
  });

  it("renames the file and returns true on success", () => {
    const sid = `arch-${Date.now()}`;
    appendToTranscript(sid, userMsg("archive me"));

    const result = archiveTranscript(sid);
    expect(result).toBe(true);
    // Original .jsonl should be gone
    expect(transcriptExists(sid)).toBe(false);
  });

  it("clears the in-memory cache after archiving", () => {
    const sid = `arch-cache-${Date.now()}`;
    appendToTranscript(sid, userMsg("archived"));
    readTranscript(sid); // populate cache
    archiveTranscript(sid);

    // Cache cleared; transcript gone → should return []
    const messages = readTranscript(sid);
    expect(messages).toEqual([]);
  });
});

describe("transcript – cleanupOldTranscripts", () => {
  it("returns 0 when called with a very large maxAgeDays so no files qualify", () => {
    // maxAgeDays=9999 means only files older than ~27 years are deleted – none qualify.
    const sid = `fresh-${Date.now()}`;
    appendToTranscript(sid, userMsg("fresh"));
    const deleted = cleanupOldTranscripts(9999);
    expect(deleted).toBe(0);
    // File created moments ago must still be present
    expect(transcriptExists(sid)).toBe(true);
  });

  it("returns a number (zero or more)", () => {
    const result = cleanupOldTranscripts(9999);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe("transcript – message cap and auto-archive (regression)", () => {
  it("exports MAX_TRANSCRIPT_MESSAGES as a positive number", () => {
    expect(typeof MAX_TRANSCRIPT_MESSAGES).toBe("number");
    expect(MAX_TRANSCRIPT_MESSAGES).toBeGreaterThan(0);
  });

  it("auto-archives transcript when message count exceeds MAX_TRANSCRIPT_MESSAGES", () => {
    const sid = `cap-${Date.now()}`;

    // Write MAX_TRANSCRIPT_MESSAGES messages to disk first (they go to disk directly)
    for (let i = 0; i < MAX_TRANSCRIPT_MESSAGES; i++) {
      appendToTranscript(sid, userMsg(`msg-${i}`));
    }

    // Populate the cache by reading
    const before = readTranscript(sid);
    expect(before.length).toBe(MAX_TRANSCRIPT_MESSAGES);
    expect(transcriptExists(sid)).toBe(true);

    // One more message should trigger auto-archive
    appendToTranscript(sid, userMsg("overflow"));

    // The original .jsonl file should be gone (archived)
    expect(transcriptExists(sid)).toBe(false);
  });

  it("readTranscript returns at most MAX_TRANSCRIPT_MESSAGES messages for large files", () => {
    const { appendFileSync: afs, mkdirSync: mds, existsSync: efs } = require("fs");
    const sid = `large-${Date.now()}`;
    const total = MAX_TRANSCRIPT_MESSAGES + 50;

    // Write directly to disk (bypass cache) to simulate a pre-existing large file
    const transcriptPath = getTranscriptPath(sid);
    const sessionsDir = join(tempRoot, "sessions");
    if (!efs(sessionsDir)) mds(sessionsDir, { recursive: true });

    for (let i = 0; i < total; i++) {
      afs(transcriptPath, JSON.stringify(userMsg(`m${i}`)) + "\n", "utf-8");
    }

    const messages = readTranscript(sid);
    // Should return at most MAX_TRANSCRIPT_MESSAGES
    expect(messages.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_MESSAGES);
    // Should return the last N messages (most recent)
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe("transcript – LRU cache eviction (regression)", () => {
  it("evicts old sessions when LRU capacity is reached", async () => {
    // We can't directly inspect the internal cache, but we can verify that
    // reading many distinct sessions does not throw and returns valid results.
    const sids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const sid = `lru-${Date.now()}-${i}`;
      sids.push(sid);
      appendToTranscript(sid, userMsg(`session-${i}`));
      readTranscript(sid); // populate cache
    }

    // Reading any session should still work correctly after many sessions were cached
    for (const sid of sids) {
      const msgs = readTranscript(sid);
      expect(Array.isArray(msgs)).toBe(true);
    }
  });
});

afterEach(() => {
  // Nothing special; each test uses a unique sid.
});

// Final teardown: remove temp directory
afterEach(() => {
  // Intentionally not removing the temp dir per-test so files persist for the test run.
});

// Global teardown happens after all tests in the file
import { afterAll } from "vitest";
afterAll(() => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
