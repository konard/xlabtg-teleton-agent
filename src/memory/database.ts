import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import * as sqliteVec from "sqlite-vec";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Memory");
import {
  ensureSchema,
  ensureVectorTables,
  getSchemaVersion,
  runMigrations,
  CURRENT_SCHEMA_VERSION,
} from "./schema.js";
import { SQLITE_CACHE_SIZE_KB, SQLITE_MMAP_SIZE } from "../constants/limits.js";

export interface DatabaseConfig {
  path: string;
  vectorExtensionPath?: string;
  enableVectorSearch: boolean;
  vectorDimensions?: number;
  /**
   * Invoked once when an on-disk schema version mismatch is detected, just
   * before migrations run. Used to create an automatic pre-upgrade backup.
   * If it throws, initialization is aborted and migrations do NOT run
   * (safety first — never migrate without a recoverable backup).
   */
  onBeforeMigrate?: (from: string, to: string) => void;
}

export class MemoryDatabase {
  private db: Database.Database;
  private config: DatabaseConfig;
  private vectorReady = false;
  private _dimensionsChanged = false;

  constructor(config: DatabaseConfig) {
    this.config = config;

    const dir = dirname(config.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.path, {
      verbose: process.env.DEBUG_SQL ? (msg: unknown) => log.debug(String(msg)) : undefined,
    });
    try {
      chmodSync(config.path, 0o600);
    } catch (error) {
      log.warn({ err: error, path: config.path }, "Failed to set DB file permissions to 0o600");
    }

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma(`cache_size = -${SQLITE_CACHE_SIZE_KB}`);
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma(`mmap_size = ${SQLITE_MMAP_SIZE}`);
    this.db.pragma("foreign_keys = ON");

    this.initialize();
  }

  private initialize(): void {
    let currentVersion: string | null = null;
    try {
      currentVersion = getSchemaVersion(this.db);
    } catch (error) {
      log.warn({ err: error }, "Could not read schema version, assuming fresh database");
      currentVersion = null;
    }

    if (!currentVersion) {
      ensureSchema(this.db);
      runMigrations(this.db);
    } else if (currentVersion !== CURRENT_SCHEMA_VERSION) {
      this.migrate(currentVersion, CURRENT_SCHEMA_VERSION);
    }

    if (this.config.enableVectorSearch) {
      this.loadVectorExtension();
    }

    this.db.exec("ANALYZE");
  }

  private loadVectorExtension(): void {
    try {
      sqliteVec.load(this.db);
      this.db.prepare("SELECT vec_version() as vec_version").get();
      const dims = this.config.vectorDimensions ?? 512;
      this._dimensionsChanged = ensureVectorTables(this.db, dims);
      this.vectorReady = true;
    } catch (error) {
      log.warn(`sqlite-vec not available, vector search disabled: ${(error as Error).message}`);
      log.warn("Falling back to keyword-only search");
      this.config.enableVectorSearch = false;
    }
  }

  private migrate(from: string, to: string): void {
    if (this.config.onBeforeMigrate) {
      // Create a pre-upgrade backup before mutating the schema. A throw here
      // aborts startup so we never migrate without a recoverable backup.
      this.config.onBeforeMigrate(from, to);
    }
    log.info(`Migrating database from ${from} to ${to}...`);
    runMigrations(this.db);
    ensureSchema(this.db);
    log.info("Migration complete");
  }

  getDb(): Database.Database {
    return this.db;
  }

  isVectorSearchReady(): boolean {
    return this.vectorReady;
  }

  didDimensionsChange(): boolean {
    return this._dimensionsChanged;
  }

  getVectorDimensions(): number | undefined {
    return this.config.vectorDimensions;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getStats(): {
    knowledge: number;
    sessions: number;
    tasks: number;
    tgChats: number;
    tgUsers: number;
    tgMessages: number;
    embeddingCache: number;
    vectorSearchEnabled: boolean;
  } {
    const counts = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM knowledge)       as knowledge,
          (SELECT COUNT(*) FROM sessions)        as sessions,
          (SELECT COUNT(*) FROM tasks)           as tasks,
          (SELECT COUNT(*) FROM tg_chats)        as tg_chats,
          (SELECT COUNT(*) FROM tg_users)        as tg_users,
          (SELECT COUNT(*) FROM tg_messages)     as tg_messages,
          (SELECT COUNT(*) FROM embedding_cache) as embedding_cache`
      )
      .get() as {
      knowledge: number;
      sessions: number;
      tasks: number;
      tg_chats: number;
      tg_users: number;
      tg_messages: number;
      embedding_cache: number;
    };

    return {
      knowledge: counts.knowledge,
      sessions: counts.sessions,
      tasks: counts.tasks,
      tgChats: counts.tg_chats,
      tgUsers: counts.tg_users,
      tgMessages: counts.tg_messages,
      embeddingCache: counts.embedding_cache,
      vectorSearchEnabled: this.vectorReady,
    };
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  optimize(): void {
    this.db.exec("ANALYZE");
  }

  /**
   * Rebuild FTS indexes from existing data.
   * Call this if FTS triggers didn't fire correctly.
   */
  rebuildFtsIndexes(): { knowledge: number; messages: number } {
    const knowledgeCount = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM knowledge`).get() as { count: number }
    ).count;
    const messageCount = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM tg_messages WHERE text IS NOT NULL`).get() as {
        count: number;
      }
    ).count;

    this.db.exec(`
      INSERT INTO knowledge_fts(knowledge_fts) VALUES ('rebuild');
      INSERT INTO tg_messages_fts(tg_messages_fts) VALUES ('rebuild');
    `);

    return { knowledge: knowledgeCount, messages: messageCount };
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}

let instance: MemoryDatabase | null = null;

export function getDatabase(config?: DatabaseConfig): MemoryDatabase {
  if (!instance && !config) {
    throw new Error("Database not initialized. Provide config on first call.");
  }

  if (!instance && config) {
    instance = new MemoryDatabase(config);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by throw above
  return instance!;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
