import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import { openModuleDb } from "../utils/module-db.js";
import type Database from "better-sqlite3";

const DB_PATH = join(TELETON_ROOT, "soul-versions.db");

let db: Database.Database | null = null;

const MAX_VERSIONS_PER_FILE = 50;

function getSoulVersionsDb(): Database.Database {
  if (db) return db;
  db = openModuleDb(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_soul_versions_filename ON soul_versions(filename);
    CREATE INDEX IF NOT EXISTS idx_soul_versions_created_at ON soul_versions(created_at DESC);
  `);

  return db;
}

export interface SoulVersionMeta {
  id: number;
  filename: string;
  comment: string | null;
  created_at: string;
  content_length: number;
}

export interface SoulVersion {
  id: number;
  filename: string;
  content: string;
  comment: string | null;
  created_at: string;
}

export function listVersions(filename: string): SoulVersionMeta[] {
  const d = getSoulVersionsDb();
  return d
    .prepare(
      `SELECT id, filename, comment, created_at, length(content) as content_length
       FROM soul_versions
       WHERE filename = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(filename) as SoulVersionMeta[];
}

export function getVersion(filename: string, id: number): SoulVersion | null {
  const d = getSoulVersionsDb();
  const row = d
    .prepare(
      `SELECT id, filename, content, comment, created_at
       FROM soul_versions
       WHERE id = ? AND filename = ?`
    )
    .get(id, filename) as SoulVersion | undefined;
  return row ?? null;
}

export function saveVersion(filename: string, content: string, comment?: string): SoulVersionMeta {
  const d = getSoulVersionsDb();

  // Insert new version
  const stmt = d.prepare(`INSERT INTO soul_versions (filename, content, comment) VALUES (?, ?, ?)`);
  const result = stmt.run(filename, content, comment ?? null);
  const newId = result.lastInsertRowid as number;

  // Enforce max versions per file — delete oldest beyond the limit
  const countRow = d
    .prepare(`SELECT COUNT(*) as c FROM soul_versions WHERE filename = ?`)
    .get(filename) as { c: number };

  if (countRow.c > MAX_VERSIONS_PER_FILE) {
    const toDelete = countRow.c - MAX_VERSIONS_PER_FILE;
    d.prepare(
      `DELETE FROM soul_versions WHERE filename = ? AND id IN (
        SELECT id FROM soul_versions WHERE filename = ? ORDER BY created_at ASC, id ASC LIMIT ?
       )`
    ).run(filename, filename, toDelete);
  }

  const saved = d
    .prepare(
      `SELECT id, filename, comment, created_at, length(content) as content_length
       FROM soul_versions WHERE id = ?`
    )
    .get(newId) as SoulVersionMeta;

  return saved;
}

export function deleteVersion(filename: string, id: number): boolean {
  const d = getSoulVersionsDb();
  const result = d
    .prepare(`DELETE FROM soul_versions WHERE id = ? AND filename = ?`)
    .run(id, filename);
  return result.changes > 0;
}

export function closeSoulVersionsDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
