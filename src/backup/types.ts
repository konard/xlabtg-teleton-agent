// src/backup/types.ts

import type { BackupTargetKind } from "./targets.js";

/** Current backup manifest format version. Bump on breaking layout changes. */
export const BACKUP_FORMAT_VERSION = 1;

/** Name of the manifest entry stored inside every archive. */
export const MANIFEST_NAME = "manifest.json";

export interface BackupFileEntry {
  /** Path inside the archive, relative to TELETON_ROOT (POSIX separators). */
  path: string;
  /** SHA-256 of the stored bytes (hex). */
  sha256: string;
  /** Size in bytes of the stored content. */
  size: number;
  /** How this file was captured. */
  kind: BackupTargetKind;
}

export interface BackupManifest {
  /** Manifest layout version (see BACKUP_FORMAT_VERSION). */
  format_version: number;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** teleton package version that produced the backup. */
  app_version: string;
  /** memory.db schema version at backup time (null if no DB). */
  schema_version: string | null;
  /** Whether this backup was created automatically before a migration. */
  pre_upgrade: boolean;
  /** Per-file integrity records. */
  files: BackupFileEntry[];
}

export interface CreateBackupResult {
  /** Absolute path to the written archive. */
  archivePath: string;
  /** The manifest embedded in the archive. */
  manifest: BackupManifest;
  /** Archive size in bytes. */
  sizeBytes: number;
}

export interface RestoreResult {
  /** Absolute path of the archive that was restored. */
  archivePath: string;
  /** Manifest read from the archive. */
  manifest: BackupManifest;
  /** Files that were written to disk (archive-relative paths). */
  restoredFiles: string[];
  /** Absolute path of the safety backup of the previous state (if any). */
  safetyBackupPath: string | null;
}
