import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/fake/root",
}));

// fs mock — intercept file I/O so tests don't touch disk
const mockWriteFileSync = vi.fn();
const mockRenameSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockMkdirSync = vi.fn();

vi.mock("fs", () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// Dynamically import AFTER mocks are set up
const { readOffset, writeOffset, flushOffsets, getAllOffsets } = await import("../offset-store.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("offset-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWriteFileSync.mockReset();
    mockRenameSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    // Cancel any pending flush timer
    flushOffsets();
    vi.useRealTimers();
  });

  it("readOffset returns null for unknown chat", () => {
    expect(readOffset("chat-1")).toBeNull();
  });

  it("writeOffset updates in-memory state immediately", () => {
    writeOffset(100, "chat-1");
    expect(readOffset("chat-1")).toBe(100);
  });

  it("writeOffset does NOT write to disk immediately", () => {
    writeOffset(200, "chat-2");
    // Disk write is deferred — should not have happened yet
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("writeOffset flushes to disk after debounce delay", async () => {
    writeOffset(300, "chat-3");
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    // Advance past the 500 ms debounce
    await vi.advanceTimersByTimeAsync(600);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockRenameSync).toHaveBeenCalledTimes(1);
  });

  it("multiple writeOffset calls within debounce window result in a single disk write", async () => {
    writeOffset(10, "chat-4");
    writeOffset(11, "chat-4");
    writeOffset(12, "chat-4");

    await vi.advanceTimersByTimeAsync(600);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(readOffset("chat-4")).toBe(12);
  });

  it("flushOffsets writes to disk immediately and cancels pending timer", () => {
    writeOffset(50, "chat-5");
    // Timer is pending — no disk write yet
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    flushOffsets();

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockRenameSync).toHaveBeenCalledTimes(1);
  });

  it("writeOffset ignores lower message IDs", () => {
    writeOffset(100, "chat-6");
    writeOffset(50, "chat-6");
    expect(readOffset("chat-6")).toBe(100);
  });

  it("getAllOffsets returns all tracked chat offsets", () => {
    writeOffset(1, "chatA");
    writeOffset(2, "chatB");
    const offsets = getAllOffsets();
    expect(offsets["chatA"]).toBe(1);
    expect(offsets["chatB"]).toBe(2);
  });
});
