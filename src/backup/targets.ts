// src/backup/targets.ts
//
// Enumerates the critical, user-owned data that lives under TELETON_ROOT
// (default: ~/.teleton). These are the files that must survive a backup /
// restore round-trip: wallet credentials, the main + per-plugin SQLite
// databases, Telegram sessions, configuration and the agent workspace.
//
// Anything that can be regenerated from scratch (downloaded ML models, cached
// binaries, temp files) is intentionally excluded to keep archives small.

import { existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";

export type BackupTargetKind = "sqlite" | "file" | "dir";

export interface BackupTarget {
  /** Absolute path on disk. */
  absPath: string;
  /** Path stored inside the archive, relative to TELETON_ROOT (POSIX). */
  archivePath: string;
  /** How the target should be handled (SQLite needs a consistent snapshot). */
  kind: BackupTargetKind;
}

/** Top-level SQLite databases stored directly under TELETON_ROOT. */
const SQLITE_FILES = ["memory.db", "deals.db"];

/**
 * Plain files (non-SQLite) under TELETON_ROOT that hold critical state.
 * wallet.json holds the (encrypted) TON mnemonic; the session/offset files
 * keep the Telegram login alive.
 */
const PLAIN_FILES = [
  "config.yaml",
  "wallet.json",
  "telegram_session.txt",
  "gramjs_bot_session.txt",
  "telegram-offset.json",
];

/** Directories copied recursively. */
const DIRECTORIES = ["workspace"];

/** Directory holding per-plugin SQLite databases. */
const PLUGIN_DATA_REL = join("plugins", "data");

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

function archiveRel(root: string, absPath: string): string {
  return toPosix(relative(root, absPath));
}

/**
 * Resolve the set of backup targets that currently exist under `root`.
 * Missing files are silently skipped so a partially-initialised install still
 * produces a valid (smaller) backup.
 */
export function resolveBackupTargets(root: string = TELETON_ROOT): BackupTarget[] {
  const targets: BackupTarget[] = [];

  for (const name of SQLITE_FILES) {
    const absPath = join(root, name);
    if (existsSync(absPath)) {
      targets.push({ absPath, archivePath: archiveRel(root, absPath), kind: "sqlite" });
    }
  }

  // Per-plugin databases: plugins/data/*.db
  const pluginDataDir = join(root, PLUGIN_DATA_REL);
  if (existsSync(pluginDataDir)) {
    for (const entry of readdirSync(pluginDataDir)) {
      if (!entry.endsWith(".db")) continue;
      const absPath = join(pluginDataDir, entry);
      if (statSync(absPath).isFile()) {
        targets.push({ absPath, archivePath: archiveRel(root, absPath), kind: "sqlite" });
      }
    }
  }

  for (const name of PLAIN_FILES) {
    const absPath = join(root, name);
    if (existsSync(absPath)) {
      targets.push({ absPath, archivePath: archiveRel(root, absPath), kind: "file" });
    }
  }

  for (const name of DIRECTORIES) {
    const absPath = join(root, name);
    if (existsSync(absPath) && statSync(absPath).isDirectory()) {
      targets.push({ absPath, archivePath: archiveRel(root, absPath), kind: "dir" });
    }
  }

  return targets;
}

/** Recursively collect every regular file under `dir` (absolute paths). */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}
