import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const { tempRoot, tempWorkspace } = vi.hoisted(() => {
  const { mkdtempSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");
  const root = mkdtempSync(join(tmpdir(), "teleton-harden-test-"));
  const workspace = join(root, "workspace");
  return { tempRoot: root, tempWorkspace: workspace };
});

vi.mock("../paths.js", () => ({
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
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { hardenExistingPermissions } = await import("../harden-permissions.js");

function cleanRoot() {
  if (!existsSync(tempRoot)) {
    mkdirSync(tempRoot, { recursive: true });
    return;
  }

  for (const entry of require("fs").readdirSync(tempRoot) as string[]) {
    rmSync(join(tempRoot, entry), { recursive: true, force: true });
  }
}

function writePermissiveRootFile(name: string): string {
  const absPath = join(tempRoot, name);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, "sensitive", { mode: 0o644 });
  chmodSync(absPath, 0o644);
  return absPath;
}

function fileMode(absPath: string): number {
  return statSync(absPath).mode & 0o777;
}

describe("hardenExistingPermissions", () => {
  beforeEach(() => {
    cleanRoot();
    mkdirSync(tempWorkspace, { recursive: true });
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("hardens real root database files, sqlite sidecars, and session artifacts", () => {
    const sensitiveFiles = [
      "config.yaml",
      "wallet.json",
      "telegram_session.txt",
      "gramjs_bot_session.txt",
      "telegram-offset.json",
      "memory.db",
      "memory.db-wal",
      "memory.db-shm",
      "memory.db-journal",
      "deals.db",
      "deals.db-wal",
      "deals.db-shm",
      "deals.db-journal",
    ];

    const paths = sensitiveFiles.map(writePermissiveRootFile);
    for (const path of paths) {
      expect(fileMode(path)).toBe(0o644);
    }

    hardenExistingPermissions();

    for (const path of paths) {
      expect(fileMode(path)).toBe(0o600);
    }
  });
});
