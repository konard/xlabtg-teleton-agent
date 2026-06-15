/**
 * One-shot permission hardening for existing files.
 *
 * Files created before the 0o600 fix may have default permissions (0o644).
 * This runs at boot to retroactively tighten them.
 */

import { chmodSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { TELETON_ROOT, WORKSPACE_ROOT, WORKSPACE_PATHS } from "./paths.js";
import { createLogger } from "../utils/logger.js";
import { PLAIN_FILES, SQLITE_FILES } from "../backup/targets.js";

const log = createLogger("Permissions");

const TARGET_MODE = 0o600;
const TARGET_DIR_MODE = 0o700;

const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

function sqliteFilesWithSidecars(): string[] {
  return SQLITE_FILES.flatMap((file) => [
    file,
    ...SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${file}${suffix}`),
  ]);
}

/** Files in TELETON_ROOT that should be 0o600 */
const ROOT_FILES = [...PLAIN_FILES, ...sqliteFilesWithSidecars()];

/** Directories that should be 0o700 */
const SECURE_DIRS = ["secrets", "plugins", "tls"];

/**
 * Harden file permissions on existing ~/.teleton/ files.
 * Skips files that already have correct permissions.
 * Safe to call multiple times (idempotent).
 */
export function hardenExistingPermissions(): void {
  let hardened = 0;

  // 1. Root and workspace directory modes
  hardened += hardenDirectoryMode(TELETON_ROOT);
  hardened += hardenDirectoryTreeModes(WORKSPACE_ROOT);

  // 2. Root-level sensitive files
  for (const file of ROOT_FILES) {
    hardened += hardenFile(join(TELETON_ROOT, file));
  }

  // 3. Workspace files (MEMORY.md, IDENTITY.md, etc.)
  for (const path of [
    WORKSPACE_PATHS.MEMORY,
    WORKSPACE_PATHS.IDENTITY,
    WORKSPACE_PATHS.SOUL,
    WORKSPACE_PATHS.USER,
    WORKSPACE_PATHS.STRATEGY,
    WORKSPACE_PATHS.SECURITY,
    WORKSPACE_PATHS.HEARTBEAT,
  ]) {
    hardened += hardenFile(path);
  }

  // 4. Memory directory (session files, daily logs)
  hardened += hardenDirectory(WORKSPACE_PATHS.MEMORY_DIR, TARGET_MODE);

  // 5. Downloads directory
  hardened += hardenDirectory(WORKSPACE_PATHS.DOWNLOADS_DIR, TARGET_MODE);

  // 6. Secure directory trees
  for (const dir of SECURE_DIRS) {
    hardened += hardenDirectoryTreeModes(join(TELETON_ROOT, dir));
  }

  // 7. Plugin files
  hardened += hardenDirectory(WORKSPACE_PATHS.PLUGINS_DIR, TARGET_MODE);

  if (hardened > 0) {
    log.info(`Hardened permissions on ${hardened} existing path(s)`);
  }
}

function hardenDirectoryMode(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  try {
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) return 0;
    if ((stat.mode & 0o777) !== TARGET_DIR_MODE) {
      chmodSync(dirPath, TARGET_DIR_MODE);
      return 1;
    }
  } catch {
    // Skip directories we can't stat/chmod (e.g., owned by another user)
  }
  return 0;
}

function hardenDirectoryTreeModes(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let count = hardenDirectoryMode(dirPath);

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += hardenDirectoryTreeModes(join(dirPath, entry.name));
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return count;
}

function hardenFile(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    const stat = statSync(filePath);
    if ((stat.mode & 0o777) !== TARGET_MODE) {
      chmodSync(filePath, TARGET_MODE);
      return 1;
    }
  } catch {
    // Skip files we can't stat/chmod (e.g., owned by another user)
  }
  return 0;
}

function hardenDirectory(dirPath: string, fileMode: number): number {
  if (!existsSync(dirPath)) return 0;
  let count = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          if ((stat.mode & 0o777) !== fileMode) {
            chmodSync(fullPath, fileMode);
            count++;
          }
        } catch {
          // Skip
        }
      } else if (entry.isDirectory()) {
        // Recurse into subdirectories (e.g., plugins/my-plugin/)
        count += hardenDirectory(fullPath, fileMode);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return count;
}
