import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { mkdirSync, existsSync, writeFileSync, rmSync, statSync } from "fs";

// Create isolated temp directories before any mock factories run.
const { tempRoot, tempWorkspace } = vi.hoisted(() => {
  const { mkdtempSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");
  const root = mkdtempSync(join(tmpdir(), "teleton-manager-test-"));
  const workspace = join(root, "workspace");
  return { tempRoot: root, tempWorkspace: workspace };
});

vi.mock("../paths.js", () => {
  const { join } = require("path") as typeof import("path");
  return {
    TELETON_ROOT: tempRoot,
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
      PLUGINS_DIR: join(tempRoot, "plugins"),
    },
  };
});

vi.mock("../../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { join } from "path";

// Import after mocks
const { ensureWorkspace, isNewWorkspace, writeFileIfMissing, getWorkspaceStats } =
  await import("../manager.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanWorkspace() {
  if (existsSync(tempWorkspace)) rmSync(tempWorkspace, { recursive: true, force: true });
  if (existsSync(tempRoot)) {
    // Remove files inside tempRoot but keep the dir itself
    for (const entry of require("fs").readdirSync(tempRoot) as string[]) {
      const full = join(tempRoot, entry);
      rmSync(full, { recursive: true, force: true });
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ensureWorkspace", () => {
  beforeEach(() => {
    cleanWorkspace();
  });

  afterAll(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates the teleton root directory when it does not exist", async () => {
    await ensureWorkspace();
    expect(existsSync(tempRoot)).toBe(true);
  });

  it("creates the workspace directory when it does not exist", async () => {
    await ensureWorkspace();
    expect(existsSync(tempWorkspace)).toBe(true);
  });

  it("creates workspace subdirectories (memory, downloads, uploads, temp, memes)", async () => {
    const ws = await ensureWorkspace();
    expect(existsSync(ws.memoryDir)).toBe(true);
    expect(existsSync(ws.downloadsDir)).toBe(true);
    expect(existsSync(ws.uploadsDir)).toBe(true);
    expect(existsSync(ws.tempDir)).toBe(true);
    expect(existsSync(ws.memesDir)).toBe(true);
  });

  it("returns a Workspace object with the expected root fields", async () => {
    const ws = await ensureWorkspace();
    expect(ws.root).toBe(tempRoot);
    expect(ws.workspace).toBe(tempWorkspace);
  });

  it("returns a Workspace object with correct path fields", async () => {
    const ws = await ensureWorkspace();
    expect(ws.soulPath).toContain("SOUL.md");
    expect(ws.memoryPath).toContain("MEMORY.md");
    expect(ws.identityPath).toContain("IDENTITY.md");
    expect(ws.userPath).toContain("USER.md");
    expect(ws.strategyPath).toContain("STRATEGY.md");
    expect(ws.securityPath).toContain("SECURITY.md");
  });

  it("returns correct protected file paths (sessionPath, configPath, walletPath)", async () => {
    const ws = await ensureWorkspace();
    expect(ws.sessionPath).toBe(join(tempRoot, "telegram_session.txt"));
    expect(ws.configPath).toBe(join(tempRoot, "config.yaml"));
    expect(ws.walletPath).toBe(join(tempRoot, "wallet.json"));
  });

  it("is idempotent – calling ensureWorkspace twice does not throw", async () => {
    await expect(ensureWorkspace()).resolves.toBeDefined();
    await expect(ensureWorkspace()).resolves.toBeDefined();
  });

  it("does not create template files when ensureTemplates is not set", async () => {
    const ws = await ensureWorkspace();
    // Template files should NOT exist (no source templates)
    expect(existsSync(ws.soulPath)).toBe(false);
  });

  it("runs silently when silent option is true", async () => {
    // Just verify it resolves without errors
    await expect(ensureWorkspace({ silent: true })).resolves.toBeDefined();
  });
});

describe("isNewWorkspace", () => {
  beforeEach(() => {
    cleanWorkspace();
    mkdirSync(tempWorkspace, { recursive: true });
  });

  it("returns true when config.yaml does not exist", async () => {
    const ws = await ensureWorkspace({ silent: true });
    expect(isNewWorkspace(ws)).toBe(true);
  });

  it("returns false when config.yaml exists", async () => {
    const ws = await ensureWorkspace({ silent: true });
    writeFileSync(ws.configPath, "# config", "utf-8");
    expect(isNewWorkspace(ws)).toBe(false);
  });
});

describe("writeFileIfMissing", () => {
  beforeEach(() => {
    cleanWorkspace();
    mkdirSync(tempWorkspace, { recursive: true });
  });

  it("creates the file when it does not exist", () => {
    const target = join(tempWorkspace, "new-file.txt");
    writeFileIfMissing(target, "hello world");
    expect(existsSync(target)).toBe(true);
    expect(require("fs").readFileSync(target, "utf-8")).toBe("hello world");
  });

  it("does not overwrite an existing file", () => {
    const target = join(tempWorkspace, "existing.txt");
    writeFileSync(target, "original", "utf-8");
    writeFileIfMissing(target, "new content");
    expect(require("fs").readFileSync(target, "utf-8")).toBe("original");
  });

  it("creates intermediate directories when they do not exist", () => {
    const target = join(tempWorkspace, "deep", "nested", "file.txt");
    writeFileIfMissing(target, "content");
    expect(existsSync(target)).toBe(true);
  });

  it("writes empty string content when provided", () => {
    const target = join(tempWorkspace, "empty.txt");
    writeFileIfMissing(target, "");
    expect(existsSync(target)).toBe(true);
    expect(require("fs").readFileSync(target, "utf-8")).toBe("");
  });
});

describe("getWorkspaceStats", () => {
  beforeEach(() => {
    cleanWorkspace();
    mkdirSync(tempWorkspace, { recursive: true });
  });

  it("reports exists=true when the workspace directory exists", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats.exists).toBe(true);
  });

  it("reports hasConfig=false when config.yaml does not exist", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats.hasConfig).toBe(false);
  });

  it("reports hasConfig=true when config.yaml exists", async () => {
    const ws = await ensureWorkspace({ silent: true });
    writeFileSync(ws.configPath, "telegram_token: xxx", "utf-8");
    const stats = getWorkspaceStats(ws);
    expect(stats.hasConfig).toBe(true);
  });

  it("reports hasTemplates=false when template files are absent", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats.hasTemplates).toBe(false);
  });

  it("reports hasTemplates=true when soul, memory and identity files all exist", async () => {
    const ws = await ensureWorkspace({ silent: true });
    writeFileSync(ws.soulPath, "# Soul", "utf-8");
    writeFileSync(ws.memoryPath, "# Memory", "utf-8");
    writeFileSync(ws.identityPath, "# Identity", "utf-8");
    const stats = getWorkspaceStats(ws);
    expect(stats.hasTemplates).toBe(true);
  });

  it("reports hasSession=false when telegram_session.txt does not exist", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats.hasSession).toBe(false);
  });

  it("reports hasSession=true when telegram_session.txt exists", async () => {
    const ws = await ensureWorkspace({ silent: true });
    writeFileSync(ws.sessionPath, "session_data", "utf-8");
    const stats = getWorkspaceStats(ws);
    expect(stats.hasSession).toBe(true);
  });

  it("reports hasWallet=false when wallet.json does not exist", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats.hasWallet).toBe(false);
  });

  it("reports hasWallet=true when wallet.json exists", async () => {
    const ws = await ensureWorkspace({ silent: true });
    writeFileSync(ws.walletPath, "{}", "utf-8");
    const stats = getWorkspaceStats(ws);
    expect(stats.hasWallet).toBe(true);
  });

  it("returns an object with all expected keys", async () => {
    const ws = await ensureWorkspace({ silent: true });
    const stats = getWorkspaceStats(ws);
    expect(stats).toHaveProperty("exists");
    expect(stats).toHaveProperty("hasConfig");
    expect(stats).toHaveProperty("hasTemplates");
    expect(stats).toHaveProperty("hasSession");
    expect(stats).toHaveProperty("hasWallet");
  });
});
