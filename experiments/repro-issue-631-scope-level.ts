/**
 * Reproduction for issue #631 — "no such column: scope_level" at agent startup.
 *
 * Replays the exact DB bootstrap the app performs (ensureSchema + runMigrations)
 * and then exercises the two code paths that the lost migrations broke:
 *   1. loadAllToolConfigs() — the call in the crash stack trace.
 *   2. initializeToolConfig()/saveToolConfig() — the seeding step that runs
 *      immediately after and writes scope='open', which the stale `scope`
 *      CHECK constraint also rejects.
 *
 * Run with: npx tsx experiments/repro-issue-631-scope-level.ts
 */
import Database from "better-sqlite3";
import { ensureSchema, runMigrations } from "../src/memory/schema.js";
import {
  loadAllToolConfigs,
  initializeToolConfig,
  saveToolConfig,
} from "../src/memory/tool-config.js";

function bootstrap(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Mirrors MemoryDatabase.initialize() for a fresh database.
  ensureSchema(db);
  runMigrations(db);
  return db;
}

function describe(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${label}: OK`);
  } catch (error) {
    console.log(`  ❌ ${label}: ${(error as Error).message}`);
  }
}

console.log("Bug 1 — loadAllToolConfigs() reads tool_config.scope_level");
{
  const db = bootstrap();
  describe("loadAllToolConfigs()", () => {
    loadAllToolConfigs(db);
  });
  db.close();
}

console.log("Bug 2 — seeding writes scope='open' (levelToScope('all'))");
{
  const db = bootstrap();
  describe("initializeToolConfig(level='all')", () => {
    initializeToolConfig(db, "bash", "all");
  });
  describe("saveToolConfig(level='off')", () => {
    saveToolConfig(db, "bash", "off");
  });
  db.close();
}
