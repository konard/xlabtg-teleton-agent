import type { Database } from "better-sqlite3";
import {
  PROMPT_SECTIONS,
  assertPromptSection,
  emptyMetrics,
  parsePromptMetrics,
  scorePromptMetrics,
  updatePromptMetrics,
  type PromptMetricInput,
  type PromptMetrics,
  type PromptSectionId,
  type PromptSectionState,
  type PromptVariant,
  type PromptVariantSource,
} from "./types.js";

const MAX_PROMPT_VARIANT_SIZE = 1024 * 1024;

interface PromptVariantRow {
  id: number;
  section: string;
  version: number;
  content: string;
  active: number;
  source: string;
  metrics_json: string;
  created_at: number;
  updated_at: number;
}

interface CountRow {
  count: number;
}

interface MaxVersionRow {
  version: number | null;
}

export function ensurePromptSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_variants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      section      TEXT NOT NULL,
      version      INTEGER NOT NULL,
      content      TEXT NOT NULL,
      active       INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
      source       TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'optimizer')),
      metrics_json TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(section, version)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_variants_one_active
      ON prompt_variants(section)
      WHERE active = 1;

    CREATE INDEX IF NOT EXISTS idx_prompt_variants_section
      ON prompt_variants(section, created_at DESC, id DESC);
  `);
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Prompt variant content is required");
  if (Buffer.byteLength(trimmed, "utf-8") > MAX_PROMPT_VARIANT_SIZE) {
    throw new Error("Prompt variant content exceeds 1MB limit");
  }
  return trimmed;
}

function normalizeSource(source: PromptVariantSource | undefined): PromptVariantSource {
  return source === "optimizer" ? "optimizer" : "manual";
}

export class PromptVariantManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    ensurePromptSchema(db);
  }

  listSections(): PromptSectionState[] {
    return PROMPT_SECTIONS.map((section) => ({
      ...section,
      activeVariant: this.getActiveVariant(section.id),
      variantCount: this.countVariants(section.id),
    }));
  }

  listVariants(section: PromptSectionId): PromptVariant[] {
    assertPromptSection(section);
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_variants
         WHERE section = ?
         ORDER BY active DESC, version DESC, id DESC`
      )
      .all(section) as PromptVariantRow[];
    return rows.map((row) => this.rowToVariant(row));
  }

  getVariant(id: number): PromptVariant | null {
    const row = this.db.prepare(`SELECT * FROM prompt_variants WHERE id = ?`).get(id) as
      | PromptVariantRow
      | undefined;
    return row ? this.rowToVariant(row) : null;
  }

  getActiveVariant(section: PromptSectionId): PromptVariant | null {
    assertPromptSection(section);
    const row = this.db
      .prepare(`SELECT * FROM prompt_variants WHERE section = ? AND active = 1 LIMIT 1`)
      .get(section) as PromptVariantRow | undefined;
    return row ? this.rowToVariant(row) : null;
  }

  createVariant(input: {
    section: PromptSectionId;
    content: string;
    activate?: boolean;
    source?: PromptVariantSource;
    metrics?: PromptMetrics;
  }): PromptVariant {
    assertPromptSection(input.section);
    const content = normalizeContent(input.content);
    const source = normalizeSource(input.source);
    const metrics = input.metrics ?? emptyMetrics();
    const timestamp = nowUnix();

    const create = this.db.transaction(() => {
      const nextVersion = this.nextVersion(input.section);
      if (input.activate === true) {
        this.db
          .prepare(
            `UPDATE prompt_variants SET active = 0, updated_at = ? WHERE section = ? AND active = 1`
          )
          .run(timestamp, input.section);
      }

      const result = this.db
        .prepare(
          `INSERT INTO prompt_variants
             (section, version, content, active, source, metrics_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.section,
          nextVersion,
          content,
          input.activate === true ? 1 : 0,
          source,
          JSON.stringify(metrics),
          timestamp,
          timestamp
        );
      return Number(result.lastInsertRowid);
    });

    const id = create();
    const variant = this.getVariant(id);
    if (!variant) throw new Error(`Prompt variant not found after create: ${id}`);
    return variant;
  }

  activateVariant(section: PromptSectionId, id: number): PromptVariant {
    assertPromptSection(section);
    const variant = this.getVariant(id);
    if (!variant || variant.section !== section) {
      throw new Error("Prompt variant not found for section");
    }

    const activate = this.db.transaction(() => {
      const timestamp = nowUnix();
      this.db
        .prepare(`UPDATE prompt_variants SET active = 0, updated_at = ? WHERE section = ?`)
        .run(timestamp, section);
      this.db
        .prepare(`UPDATE prompt_variants SET active = 1, updated_at = ? WHERE id = ?`)
        .run(timestamp, id);
    });
    activate();

    const active = this.getVariant(id);
    if (!active) throw new Error(`Prompt variant not found after activation: ${id}`);
    return active;
  }

  recordMetrics(id: number, input: PromptMetricInput): PromptVariant {
    const variant = this.getVariant(id);
    if (!variant) throw new Error("Prompt variant not found");

    const updated = updatePromptMetrics(variant.metrics, input);
    this.db
      .prepare(`UPDATE prompt_variants SET metrics_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(updated), updated.lastUpdated ?? nowUnix(), id);

    const row = this.getVariant(id);
    if (!row) throw new Error(`Prompt variant not found after metrics update: ${id}`);
    return row;
  }

  getPerformance(): {
    sections: PromptSectionState[];
    totalVariants: number;
    bestVariants: PromptVariant[];
  } {
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM prompt_variants`)
      .get() as CountRow;
    const variants = PROMPT_SECTIONS.flatMap((section) => this.listVariants(section.id));
    const bestVariants = [...variants]
      .sort(
        (a, b) =>
          scorePromptMetrics(b.metrics) - scorePromptMetrics(a.metrics) ||
          b.metrics.interactions - a.metrics.interactions ||
          a.section.localeCompare(b.section)
      )
      .slice(0, 10);
    return {
      sections: this.listSections(),
      totalVariants: total.count,
      bestVariants,
    };
  }

  private countVariants(section: PromptSectionId): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM prompt_variants WHERE section = ?`)
      .get(section) as CountRow;
    return row.count;
  }

  private nextVersion(section: PromptSectionId): number {
    const row = this.db
      .prepare(`SELECT MAX(version) AS version FROM prompt_variants WHERE section = ?`)
      .get(section) as MaxVersionRow;
    return (row.version ?? 0) + 1;
  }

  private rowToVariant(row: PromptVariantRow): PromptVariant {
    assertPromptSection(row.section);
    return {
      id: row.id,
      section: row.section,
      version: row.version,
      content: row.content,
      active: row.active === 1,
      source: row.source === "optimizer" ? "optimizer" : "manual",
      metrics: parsePromptMetrics(row.metrics_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
