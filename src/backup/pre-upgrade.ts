// src/backup/pre-upgrade.ts
//
// Hook invoked on the first start after a version upgrade, when the on-disk
// schema version no longer matches the binary. It creates an automatic backup
// before Drizzle/SQLite migrations run and aborts startup if that backup fails
// — we never migrate (and risk corrupting) data we cannot recover.

import { createLogger } from "../utils/logger.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createBackup } from "./backup.js";

const log = createLogger("Backup");

/**
 * Create a pre-upgrade backup. Throws (aborting startup) when the backup
 * cannot be created — by design, so a failed backup never lets a migration
 * proceed unguarded.
 */
export function createPreUpgradeBackup(
  from: string,
  to: string,
  root: string = TELETON_ROOT
): void {
  log.warn(
    { from, to },
    "Schema version mismatch detected — creating pre-upgrade backup before migrating"
  );
  try {
    const result = createBackup({ root, preUpgrade: true });
    log.info({ archivePath: result.archivePath, from, to }, "Pre-upgrade backup created");
  } catch (error) {
    log.error(
      { err: error, from, to },
      "Pre-upgrade backup FAILED — aborting migration to protect your data"
    );
    throw new Error(
      `Pre-upgrade backup failed (${(error as Error).message}). ` +
        `Migration aborted to avoid data loss. Fix the issue or back up manually, then retry.`
    );
  }
}
