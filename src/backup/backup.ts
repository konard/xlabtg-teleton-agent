// src/backup/backup.ts
//
// Creates a timestamped, integrity-verified `.tar.gz` backup of all critical
// Teleton data under TELETON_ROOT. SQLite databases are captured with a
// consistent snapshot (better-sqlite3 `serialize()` + integrity check) rather
// than a raw file copy, so a backup taken while the agent is running is always
// restorable.

import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { createLogger } from "../utils/logger.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createTarGz, type ArchiveEntry } from "./archive.js";
import { listFilesRecursive, resolveBackupTargets } from "./targets.js";
import {
  BACKUP_FORMAT_VERSION,
  MANIFEST_NAME,
  type BackupFileEntry,
  type BackupManifest,
  type CreateBackupResult,
} from "./types.js";
import { getAppVersion, readSchemaVersion } from "./versions.js";

const log = createLogger("Backup");

export interface CreateBackupOptions {
  /** Root directory holding the data (default: TELETON_ROOT). */
  root?: string;
  /** Directory the archive is written into (default: <root>/backups). */
  outDir?: string;
  /** Mark the archive as an automatic pre-upgrade backup. */
  preUpgrade?: boolean;
  /** Explicit timestamp (mainly for tests); defaults to now. */
  now?: Date;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

/** Build the `teleton-backup-YYYY-MM-DD-HHMMSS[-pre-upgrade].tar.gz` filename. */
export function buildArchiveName(now: Date, preUpgrade: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = preUpgrade ? "-pre-upgrade" : "";
  return `teleton-backup-${stamp}${suffix}.tar.gz`;
}

/**
 * Produce a consistent snapshot of a SQLite database as a Buffer. Uses
 * better-sqlite3 `serialize()` (which folds in any WAL contents) and verifies
 * the snapshot passes an integrity check before returning.
 */
function snapshotSqlite(absPath: string): Buffer {
  const source = new Database(absPath, { fileMustExist: true });
  let snapshot: Buffer;
  try {
    snapshot = source.serialize();
  } finally {
    source.close();
  }

  // serialize() preserves the source journal mode in the file header. A
  // WAL-mode header (bytes 18/19 == 2) cannot be opened as an in-memory
  // database, so normalise it to rollback-journal format (== 1). The page
  // data is identical and the agent re-enables WAL via PRAGMA on next open.
  if (snapshot.length > 19) {
    if (snapshot[18] === 2) snapshot[18] = 1;
    if (snapshot[19] === 2) snapshot[19] = 1;
  }

  // Re-open the serialized snapshot in-memory and verify its integrity.
  const verify = new Database(snapshot);
  try {
    const result = verify.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`SQLite integrity check failed for ${absPath}: ${String(result)}`);
    }
  } finally {
    verify.close();
  }

  return snapshot;
}

/**
 * Create a backup archive. Returns the archive path and its manifest.
 * Throws if any SQLite snapshot fails its integrity check.
 */
export function createBackup(options: CreateBackupOptions = {}): CreateBackupResult {
  const root = options.root ?? TELETON_ROOT;
  const outDir = options.outDir ?? join(root, "backups");
  const now = options.now ?? new Date();
  const preUpgrade = options.preUpgrade ?? false;

  const targets = resolveBackupTargets(root);
  const entries: ArchiveEntry[] = [];
  const fileRecords: BackupFileEntry[] = [];

  for (const target of targets) {
    if (target.kind === "dir") {
      for (const fileAbs of listFilesRecursive(target.absPath)) {
        const archivePath = toPosix(relative(root, fileAbs));
        const data = readFileSync(fileAbs);
        entries.push({ name: archivePath, data, mode: 0o600 });
        fileRecords.push({
          path: archivePath,
          sha256: sha256(data),
          size: data.length,
          kind: "file",
        });
      }
      continue;
    }

    const data =
      target.kind === "sqlite" ? snapshotSqlite(target.absPath) : readFileSync(target.absPath);
    entries.push({ name: target.archivePath, data, mode: 0o600 });
    fileRecords.push({
      path: target.archivePath,
      sha256: sha256(data),
      size: data.length,
      kind: target.kind,
    });
  }

  const manifest: BackupManifest = {
    format_version: BACKUP_FORMAT_VERSION,
    created_at: now.toISOString(),
    app_version: getAppVersion(),
    schema_version: readSchemaVersion(join(root, "memory.db")),
    pre_upgrade: preUpgrade,
    files: fileRecords,
  };

  const manifestData = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
  // Manifest first so readers can stream the metadata before the payload.
  entries.unshift({ name: MANIFEST_NAME, data: manifestData, mode: 0o600 });

  const archive = createTarGz(entries);

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const archivePath = join(outDir, buildArchiveName(now, preUpgrade));
  writeFileSync(archivePath, archive, { mode: 0o600 });

  log.info(
    { archivePath, files: fileRecords.length, sizeBytes: archive.length, preUpgrade },
    "Backup created"
  );

  return {
    archivePath,
    manifest,
    sizeBytes: statSync(archivePath).size,
  };
}
