// src/backup/versions.ts
//
// Helpers for reading the running application version and the on-disk SQLite
// schema version. Both feed the backup manifest so a restore can warn about
// (or refuse) cross-version restores.

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Walk up from this module to find the package.json and return its version. */
export function getAppVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        // Skip nested package.json files that are not the root teleton package.
        if (pkg.name === "teleton" && pkg.version) return pkg.version;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

/**
 * Read the `schema_version` value from a SQLite database file without running
 * any migrations. Returns null when the file or the meta table is absent.
 */
export function readSchemaVersion(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
