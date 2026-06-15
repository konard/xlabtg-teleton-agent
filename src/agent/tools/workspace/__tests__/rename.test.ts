import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";
import { workspaceRenameExecutor } from "../rename.js";

vi.mock("../../../../workspace/paths.js", async () => {
  const tempWorkspace = mkdtempSync(join(tmpdir(), "teleton-rename-test-"));

  return {
    assertSafeTeletonRoot: vi.fn(),
    TELETON_ROOT: join(tempWorkspace, ".."),
    WORKSPACE_ROOT: tempWorkspace,
    WORKSPACE_PATHS: {
      SOUL: join(tempWorkspace, "SOUL.md"),
      MEMORY: join(tempWorkspace, "MEMORY.md"),
      IDENTITY: join(tempWorkspace, "IDENTITY.md"),
      USER: join(tempWorkspace, "USER.md"),
      STRATEGY: join(tempWorkspace, "STRATEGY.md"),
      SECURITY: join(tempWorkspace, "SECURITY.md"),
      HEARTBEAT: join(tempWorkspace, "HEARTBEAT.md"),
      MEMORY_DIR: join(tempWorkspace, "memory"),
      DOWNLOADS_DIR: join(tempWorkspace, "downloads"),
      UPLOADS_DIR: join(tempWorkspace, "uploads"),
      TEMP_DIR: join(tempWorkspace, "temp"),
      MEMES_DIR: join(tempWorkspace, "memes"),
      PLUGINS_DIR: join(tempWorkspace, "..", "plugins"),
    },
    ALLOWED_EXTENSIONS: {
      images: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"],
      audio: [".mp3", ".ogg", ".wav", ".m4a", ".opus"],
      video: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
      documents: [".md", ".txt", ".json", ".csv", ".pdf", ".yaml", ".yml"],
      code: [".ts", ".js", ".py", ".sh", ".sql"],
      stickers: [".webp", ".tgs"],
      media: [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".mp3",
        ".ogg",
        ".wav",
        ".m4a",
        ".opus",
        ".mp4",
        ".mov",
        ".avi",
        ".webm",
        ".mkv",
      ],
    },
    MAX_FILE_SIZES: {
      image: 10 * 1024 * 1024,
      audio: 50 * 1024 * 1024,
      video: 100 * 1024 * 1024,
      document: 50 * 1024 * 1024,
      total_workspace: 500 * 1024 * 1024,
    },
    TEXT_FILE_EXTENSIONS: [".md", ".txt", ".json", ".csv", ".yaml", ".yml"],
    PROTECTED_WORKSPACE_FILES: [
      "SOUL.md",
      "STRATEGY.md",
      "SECURITY.md",
      "MEMORY.md",
      "IDENTITY.md",
      "USER.md",
    ],
    IMMUTABLE_FILES: ["SOUL.md", "STRATEGY.md", "SECURITY.md"],
    MEMORY_SCAN_FILES: ["MEMORY.md", "HEARTBEAT.md", "USER.md", "IDENTITY.md"],
  };
});

describe("workspaceRenameExecutor", () => {
  let tempWorkspace: string;
  const context = {} as ToolContext;

  beforeAll(async () => {
    const paths = await import("../../../../workspace/paths.js");
    tempWorkspace = paths.WORKSPACE_ROOT;
  });

  beforeEach(() => {
    rmSync(tempWorkspace, { recursive: true, force: true });
    mkdirSync(tempWorkspace, { recursive: true });
    writeFileSync(join(tempWorkspace, "SOUL.md"), "# Soul");
    writeFileSync(join(tempWorkspace, "STRATEGY.md"), "# Strategy");
    writeFileSync(join(tempWorkspace, "SECURITY.md"), "# Security");
    writeFileSync(join(tempWorkspace, "MEMORY.md"), "# Memory");
    writeFileSync(join(tempWorkspace, "notes.md"), "# Notes");
  });

  afterAll(() => {
    rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("rejects moving a protected core file away from its canonical path", async () => {
    const result = await workspaceRenameExecutor({ from: "SOUL.md", to: "SOUL.md.bak" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot rename protected file: SOUL.md");
    expect(existsSync(join(tempWorkspace, "SOUL.md"))).toBe(true);
    expect(existsSync(join(tempWorkspace, "SOUL.md.bak"))).toBe(false);
  });

  it.each(["SECURITY.md", "MEMORY.md"])(
    "rejects overwriting protected or immutable core file %s",
    async (filename) => {
      const originalContent = readFileSync(join(tempWorkspace, filename), "utf-8");

      const result = await workspaceRenameExecutor(
        { from: "notes.md", to: filename, overwrite: true },
        context
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Cannot overwrite protected or immutable file: ${filename}`);
      expect(readFileSync(join(tempWorkspace, filename), "utf-8")).toBe(originalContent);
      expect(existsSync(join(tempWorkspace, "notes.md"))).toBe(true);
    }
  );

  it("allows renaming normal workspace files", async () => {
    const result = await workspaceRenameExecutor(
      { from: "notes.md", to: "archive/notes.md" },
      context
    );

    expect(result.success).toBe(true);
    expect(existsSync(join(tempWorkspace, "notes.md"))).toBe(false);
    expect(readFileSync(join(tempWorkspace, "archive", "notes.md"), "utf-8")).toBe("# Notes");
  });
});
