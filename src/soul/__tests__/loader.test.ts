import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>().mockReturnValue(false),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>().mockReturnValue(""),
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

// ── Heartbeat Section (scenarios 12-16) ──────────────────────────────────────

describe("buildSystemPrompt() heartbeat section", () => {
  // Scenario 12
  it("includes Heartbeat Protocol section when isHeartbeat: true", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("NO_ACTION");
    expect(prompt).toContain("woken by your periodic heartbeat timer");
  });

  // Scenario 13
  it("does NOT include heartbeat section when isHeartbeat: false", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: false });
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  it("does NOT include heartbeat section when isHeartbeat is omitted", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  // Scenario 14
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

  // Scenario 15
  it("works when HEARTBEAT.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("_No HEARTBEAT.md found._");
  });

  // Scenario 16
  it("sanitizes HEARTBEAT.md content via sanitizeForContext()", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "user-controlled content" : ""
    );

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    // Our sanitizeForContext mock prepends [sanitized]
    expect(prompt).toContain("[sanitized]user-controlled content");
  });
});

// ── New prompt sections (scenarios 17-20) ────────────────────────────────────

describe("buildSystemPrompt() standard sections", () => {
  // Scenario 17
  it('includes "Active Memory" section', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("## Active Memory");
    expect(prompt).toContain("memory_read");
  });

  // Scenario 18
  it('includes "Safety" section', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("irreversible");
  });

  // Scenario 19
  it('includes "Silent Reply" section with __SILENT__ token', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("## Silent Reply");
    expect(prompt).toContain("__SILENT__");
  });

  // Scenario 20
  it('includes "Runtime" section', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("_Runtime:");
    expect(prompt).toContain("agent=teleton");
    expect(prompt).toContain("channel=telegram");
  });

  it("Runtime section includes agentModel when provided", () => {
    const prompt = buildSystemPrompt({ agentModel: "claude-opus-4-6" });
    expect(prompt).toContain("model=claude-opus-4-6");
  });
});

// ── DEFAULT_SOUL (scenarios 21-23) ──────────────────────────────────────────

describe("DEFAULT_SOUL / loadSoul()", () => {
  // Scenario 21
  it('default soul contains "autonomous" or "agent"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    const hasAutonomous = soul.toLowerCase().includes("autonomous");
    const hasAgent = soul.toLowerCase().includes("agent");
    expect(hasAutonomous || hasAgent).toBe(true);
  });

  // Scenario 22
  it('default soul does NOT contain old filler "helpful and concise"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    expect(soul).not.toContain("helpful and concise");
  });

  // Scenario 23
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
