import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>().mockReturnValue(false),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>().mockReturnValue(""),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(args[0] as string),
  readFileSync: (...args: unknown[]) => mockReadFileSync(args[0] as string, args[1] as string),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  realpathSync: vi.fn((p: string) => p),
}));

vi.mock("../../memory/daily-logs.js", () => ({
  readRecentMemory: vi.fn().mockReturnValue(null),
}));

vi.mock("../../utils/sanitize.js", () => ({
  sanitizeForPrompt: vi.fn((v: string) => v),
  sanitizeForContext: vi.fn((v: string) => `[sanitized]${v}`),
}));

import { buildSystemPrompt, loadSoul, loadHeartbeat, clearPromptCache } from "../loader.js";
import { WORKSPACE_PATHS } from "../../workspace/index.js";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearPromptCache();
  mockExistsSync.mockReturnValue(false);
});

// ── Heartbeat Section ────────────────────────────────────────────────────────

describe("buildSystemPrompt() heartbeat section", () => {
  it("includes Heartbeat Protocol section when isHeartbeat: true", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("NO_ACTION");
    expect(prompt).toContain("woken by your periodic heartbeat timer");
  });

  it("does NOT include heartbeat section when isHeartbeat: false", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: false });
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  it("does NOT include heartbeat section when isHeartbeat is omitted", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  it("includes HEARTBEAT.md content when file exists", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "Check RSS feeds every hour" : ""
    );

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("Check RSS feeds every hour");
  });

  it("works when HEARTBEAT.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("_No HEARTBEAT.md found._");
  });

  it("sanitizes HEARTBEAT.md content via sanitizeForContext()", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "user-controlled content" : ""
    );

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("[sanitized]user-controlled content");
  });
});

// ── Restructured prompt sections ─────────────────────────────────────────────

describe("buildSystemPrompt() restructured sections", () => {
  it("includes safety reminder as last section (recency bias)", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("<reminder>");
    expect(prompt).toContain("irreversible");
    // Reminder should be at the very end
    const reminderIdx = prompt.lastIndexOf("<reminder>");
    const lastNewline = prompt.lastIndexOf("\n", prompt.length - 2);
    expect(reminderIdx).toBeGreaterThan(lastNewline - 200);
  });

  it("does NOT include removed sections (Runtime tag)", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("_Runtime:");
  });

  it("includes __SILENT__ in DEFAULT_SOUL personality", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("__SILENT__");
  });

  it("applies active adaptive prompt sections", () => {
    const prompt = buildSystemPrompt({
      adaptiveSections: {
        persona: "# Test Persona\n\nAdaptive identity.",
        response_format: "Answer with a single verified sentence.",
        safety: "Confirm before irreversible actions and preserve privacy.",
      },
    });

    expect(prompt).toContain("Adaptive identity.");
    expect(prompt).toContain("## Response Format\nAnswer with a single verified sentence.");
    expect(prompt).toContain("Confirm before irreversible actions and preserve privacy.");
    expect(prompt).not.toContain("Respond in 1-3 short sentences");
  });
});

// ── DEFAULT_SOUL / loadSoul() ────────────────────────────────────────────────

describe("DEFAULT_SOUL / loadSoul()", () => {
  it('default soul contains "autonomous" or "agent"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    const hasAutonomous = soul.toLowerCase().includes("autonomous");
    const hasAgent = soul.toLowerCase().includes("agent");
    expect(hasAutonomous || hasAgent).toBe(true);
  });

  it('default soul does NOT contain old filler "helpful and concise"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    expect(soul).not.toContain("helpful and concise");
  });

  it("custom SOUL.md overrides DEFAULT_SOUL", () => {
    mockExistsSync.mockImplementation((p: string) => (p === WORKSPACE_PATHS.SOUL ? true : false));
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.SOUL ? "I am a custom personality." : ""
    );

    const soul = loadSoul();
    expect(soul).toBe("I am a custom personality.");
    expect(soul).not.toContain("Teleton");
  });
});

// ── Response Format — tool-call instruction (issue #133) ────────────────────

describe("buildSystemPrompt() Response Format section — tool call instruction", () => {
  // Scenario 24: Verifies the fix for issue #133 — LLM must always respond after tool calls
  it('includes "After tool calls" instruction in Response Format', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("After tool calls");
    expect(prompt).toContain("human-readable response");
  });

  // Scenario 25: Instruction must be present in the Response Format section (not elsewhere)
  it('"After tool calls" instruction appears within "## Response Format" block', () => {
    const prompt = buildSystemPrompt({});
    const formatStart = prompt.indexOf("## Response Format");
    const formatEnd = prompt.indexOf("\n##", formatStart + 1);
    const formatSection =
      formatEnd > 0 ? prompt.slice(formatStart, formatEnd) : prompt.slice(formatStart);
    expect(formatSection).toContain("After tool calls");
  });
});

// ── Sender Context + owner privacy (issue #148) ─────────────────────────────

describe("buildSystemPrompt() sender context and owner privacy", () => {
  it("includes Sender Context section when senderId is provided", () => {
    const prompt = buildSystemPrompt({ senderId: 12345 });
    expect(prompt).toContain("## Sender Context");
    expect(prompt).toContain("Sender ID: 12345");
  });

  it("includes Sender Context section when chatType is provided", () => {
    const prompt = buildSystemPrompt({ chatType: "group" });
    expect(prompt).toContain("## Sender Context");
    expect(prompt).toContain("Chat Type: group");
  });

  it("does NOT include Sender Context when neither senderId nor chatType is provided", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("## Sender Context");
  });

  it('shows "Is Owner: true" when isOwner is true', () => {
    const prompt = buildSystemPrompt({ senderId: 42, isOwner: true });
    expect(prompt).toContain("Is Owner: true");
  });

  it('shows "Is Owner: false" when isOwner is false', () => {
    const prompt = buildSystemPrompt({ senderId: 42, isOwner: false });
    expect(prompt).toContain("Is Owner: false");
  });

  it("includes Identity section content when includeOwnerPersonalFiles is true and file exists", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.IDENTITY ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.IDENTITY ? "Owner identity data" : ""
    );

    const prompt = buildSystemPrompt({ includeOwnerPersonalFiles: true });
    expect(prompt).toContain("[sanitized]Owner identity data");
  });

  it("excludes Identity file content when includeOwnerPersonalFiles is false", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.IDENTITY ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.IDENTITY ? "Owner identity data" : ""
    );

    const prompt = buildSystemPrompt({ includeOwnerPersonalFiles: false });
    // The identity FILE content should not appear in the prompt
    expect(prompt).not.toContain("[sanitized]Owner identity data");
  });

  it("includes User Profile section content when includeOwnerPersonalFiles is true and file exists", () => {
    mockExistsSync.mockImplementation((p: string) => (p === WORKSPACE_PATHS.USER ? true : false));
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.USER ? "Owner user profile" : ""
    );

    const prompt = buildSystemPrompt({ includeOwnerPersonalFiles: true });
    expect(prompt).toContain("## User Profile");
    expect(prompt).toContain("[sanitized]Owner user profile");
  });

  it("excludes User Profile section content when includeOwnerPersonalFiles is false", () => {
    mockExistsSync.mockImplementation((p: string) => (p === WORKSPACE_PATHS.USER ? true : false));
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.USER ? "Owner user profile" : ""
    );

    const prompt = buildSystemPrompt({ includeOwnerPersonalFiles: false });
    expect(prompt).not.toContain("## User Profile");
    expect(prompt).not.toContain("[sanitized]Owner user profile");
  });

  it("includes IMPORTANT warning about not exposing owner data to non-owners in Sender Context", () => {
    const prompt = buildSystemPrompt({ senderId: 99, isOwner: false, chatType: "group" });
    expect(prompt).toContain("Is Owner: false");
    expect(prompt).toContain("do NOT expose owner-private data");
  });

  it("defaults to including Identity/User Profile content when includeOwnerPersonalFiles is omitted", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.IDENTITY || p === WORKSPACE_PATHS.USER ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === WORKSPACE_PATHS.IDENTITY) return "My identity";
      if (p === WORKSPACE_PATHS.USER) return "User info";
      return "";
    });

    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("[sanitized]My identity");
    expect(prompt).toContain("## User Profile");
    expect(prompt).toContain("[sanitized]User info");
  });
});

// ── loadHeartbeat() ─────────────────────────────────────────────────────────

describe("loadHeartbeat()", () => {
  it("returns file content when HEARTBEAT.md exists", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "Check feeds" : ""
    );

    expect(loadHeartbeat()).toBe("Check feeds");
  });

  it("returns null when HEARTBEAT.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadHeartbeat()).toBeNull();
  });
});
