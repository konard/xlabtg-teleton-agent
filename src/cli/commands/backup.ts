// src/cli/commands/backup.ts
//
// CLI handlers for `teleton backup` and `teleton restore`.

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { confirm } from "@inquirer/prompts";
import { createBackup } from "../../backup/backup.js";
import { inspectBackup, restoreBackup } from "../../backup/restore.js";
import { resolveBackupTargets } from "../../backup/targets.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export interface BackupCommandOptions {
  out?: string;
  root?: string;
}

export async function backupCommand(options: BackupCommandOptions = {}): Promise<void> {
  const root = options.root ?? TELETON_ROOT;
  const targets = resolveBackupTargets(root);

  if (targets.length === 0) {
    console.error(`❌ No Teleton data found under ${root}`);
    console.error("   Run `teleton setup` first, or pass the correct data directory.");
    process.exitCode = 1;
    return;
  }

  console.log(`📦 Backing up Teleton data from ${root} ...`);
  const result = createBackup({ root, outDir: options.out });

  console.log(`✓ Backup created: ${result.archivePath}`);
  console.log(`  Files:        ${result.manifest.files.length}`);
  console.log(`  Size:         ${formatBytes(result.sizeBytes)}`);
  console.log(`  App version:  ${result.manifest.app_version}`);
  console.log(`  Schema:       ${result.manifest.schema_version ?? "n/a"}`);
}

export interface RestoreCommandOptions {
  file?: string;
  root?: string;
  force?: boolean;
  yes?: boolean;
}

/** Pick the most recent archive in the default backups directory. */
function findLatestBackup(root: string): string | null {
  const dir = join(root, "backups");
  if (!existsSync(dir)) return null;
  const archives = readdirSync(dir)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return archives[0]?.path ?? null;
}

export async function restoreCommand(options: RestoreCommandOptions = {}): Promise<void> {
  const root = options.root ?? TELETON_ROOT;

  const archivePath = options.file ?? findLatestBackup(root);
  if (!archivePath) {
    console.error("❌ No backup archive specified and none found under <root>/backups");
    console.error("   Pass one with: teleton restore --file <archive.tar.gz>");
    process.exitCode = 1;
    return;
  }

  // Inspect & verify before touching anything on disk.
  let manifest;
  try {
    manifest = inspectBackup(archivePath).manifest;
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`♻️  Restore from: ${archivePath}`);
  console.log(`  Created:      ${manifest.created_at}`);
  console.log(`  App version:  ${manifest.app_version}`);
  console.log(`  Schema:       ${manifest.schema_version ?? "n/a"}`);
  console.log(`  Files:        ${manifest.files.length}`);
  console.log("");
  console.warn("⚠️  This will overwrite current Teleton data. Stop the agent first.");

  if (!options.yes) {
    const proceed = await confirm({
      message: "Proceed with restore? A safety backup of current data will be created first.",
      default: false,
    });
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
  }

  try {
    const result = restoreBackup({ archivePath, root, force: options.force });
    console.log(`✓ Restored ${result.restoredFiles.length} file(s) to ${root}`);
    if (result.safetyBackupPath) {
      console.log(`  Previous state saved to: ${result.safetyBackupPath}`);
    }
    console.log("  Restart the agent to apply any pending schema migrations.");
  } catch (error) {
    console.error(`❌ Restore failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
