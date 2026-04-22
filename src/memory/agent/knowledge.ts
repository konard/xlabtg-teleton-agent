import type Database from "better-sqlite3";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_CHUNK_SIZE } from "../../constants/limits.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { hashText, serializeEmbedding } from "../embeddings/index.js";
import type { SemanticMemoryVector, SemanticVectorStore } from "../vector-store.js";

const log = createLogger("Memory");
const SEMANTIC_MIGRATION_META_PREFIX = "semantic_vector_migrated:";

export interface KnowledgeChunk {
  id: string;
  source: "memory" | "session" | "learned";
  path: string | null;
  text: string;
  startLine?: number;
  endLine?: number;
  hash: string;
}

export interface SemanticVectorIndexStats {
  upserted: number;
  deleted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface KnowledgeIndexResult {
  indexed: number;
  skipped: number;
  semantic: SemanticVectorIndexStats;
}

export interface KnowledgeFileIndexResult {
  indexed: boolean;
  semantic: SemanticVectorIndexStats;
}

function emptySemanticStats(): SemanticVectorIndexStats {
  return {
    upserted: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function addSemanticStats(
  target: SemanticVectorIndexStats,
  source: SemanticVectorIndexStats
): void {
  target.upserted += source.upserted;
  target.deleted += source.deleted;
  target.skipped += source.skipped;
  target.failed += source.failed;
  target.errors.push(...source.errors);
}

export class KnowledgeIndexer {
  constructor(
    private db: Database.Database,
    private workspaceDir: string,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean,
    private semanticVectorStore?: SemanticVectorStore
  ) {}

  async indexAll(options?: { force?: boolean }): Promise<KnowledgeIndexResult> {
    const files = this.listMemoryFiles();
    let indexed = 0;
    let skipped = 0;
    const semantic = emptySemanticStats();

    const indexDimension = await this.resolveIndexDimension();

    for (const file of files) {
      const result = await this.indexFile(file, options?.force, indexDimension);
      addSemanticStats(semantic, result.semantic);
      if (result.indexed) {
        indexed++;
      } else {
        skipped++;
      }
    }

    return { indexed, skipped, semantic };
  }

  async indexFile(
    absPath: string,
    force?: boolean,
    indexDimension?: number
  ): Promise<KnowledgeFileIndexResult> {
    if (!existsSync(absPath) || !absPath.endsWith(".md")) {
      return { indexed: false, semantic: emptySemanticStats() };
    }

    const content = readFileSync(absPath, "utf-8");
    const relPath = absPath.replace(this.workspaceDir + "/", "");
    const fileHash = hashText(content);
    const existingIds = this.getExistingChunkIds(relPath);
    const needsSemanticSync =
      this.semanticVectorStore?.isConfigured === true &&
      this.getSemanticMigrationHash(relPath) !== fileHash;

    if (!force) {
      const existing = this.db
        .prepare(`SELECT hash FROM knowledge WHERE path = ? AND source = 'memory' LIMIT 1`)
        .get(relPath) as { hash: string } | undefined;

      if (existing?.hash === fileHash && !needsSemanticSync) {
        return { indexed: false, semantic: emptySemanticStats() };
      }
    }

    const chunks = this.chunkMarkdown(content, relPath);
    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder.embedBatch(texts);

    this.db.transaction(() => {
      if (this.vectorEnabled) {
        this.db
          .prepare(
            `DELETE FROM knowledge_vec WHERE id IN (
              SELECT id FROM knowledge WHERE path = ? AND source = 'memory'
            )`
          )
          .run(relPath);
      }
      this.db.prepare(`DELETE FROM knowledge WHERE path = ? AND source = 'memory'`).run(relPath);

      const insert = this.db.prepare(`
        INSERT INTO knowledge (id, source, path, text, embedding, start_line, end_line, hash)
        VALUES (?, 'memory', ?, ?, ?, ?, ?, ?)
      `);

      const insertVec = this.vectorEnabled
        ? this.db.prepare(`INSERT INTO knowledge_vec (id, embedding) VALUES (?, ?)`)
        : null;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i] ?? [];

        insert.run(
          chunk.id,
          chunk.path,
          chunk.text,
          serializeEmbedding(embedding),
          chunk.startLine,
          chunk.endLine,
          fileHash
        );

        if (insertVec && embedding.length > 0) {
          insertVec.run(chunk.id, serializeEmbedding(embedding));
        }
      }
    })();

    const resolvedIndexDimension = indexDimension ?? (await this.resolveIndexDimension());

    const semantic = await this.syncSemanticVectorStore(
      relPath,
      fileHash,
      existingIds,
      chunks,
      embeddings,
      resolvedIndexDimension
    );

    return { indexed: true, semantic };
  }

  /**
   * Ask Upstash Vector for the index's configured dimension so we can
   * short-circuit upserts that would be rejected with a 400 dimension error.
   * Returns undefined if the store is absent, misconfigured, or unreachable
   * (the upsert path still catches the real error in that case).
   */
  private async resolveIndexDimension(): Promise<number | undefined> {
    const store = this.semanticVectorStore;
    if (!store?.isConfigured) return undefined;
    try {
      const status = await store.healthCheck();
      return status.indexDimension;
    } catch {
      return undefined;
    }
  }

  private getExistingChunkIds(relPath: string): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM knowledge WHERE path = ? AND source = 'memory'`)
      .all(relPath) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private getSemanticMigrationHash(relPath: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM meta WHERE key = ?`)
      .get(SEMANTIC_MIGRATION_META_PREFIX + relPath) as { value: string } | undefined;
    return row?.value;
  }

  private setSemanticMigrationHash(relPath: string, fileHash: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value, updated_at)
         VALUES (?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(SEMANTIC_MIGRATION_META_PREFIX + relPath, fileHash);
  }

  private async syncSemanticVectorStore(
    relPath: string,
    fileHash: string,
    oldIds: string[],
    chunks: KnowledgeChunk[],
    embeddings: number[][],
    indexDimension?: number
  ): Promise<SemanticVectorIndexStats> {
    const stats = emptySemanticStats();
    const store = this.semanticVectorStore;
    if (!store?.isConfigured) {
      stats.skipped = chunks.length;
      return stats;
    }

    const vectors: SemanticMemoryVector[] = chunks
      .map((chunk, index) => ({
        id: chunk.id,
        text: chunk.text,
        vector: embeddings[index] ?? [],
        metadata: {
          source: chunk.source,
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          hash: fileHash,
          chunkHash: chunk.hash,
        },
      }))
      .filter((item) => item.vector.length > 0);

    const missingVectorCount = chunks.length - vectors.length;
    if (missingVectorCount > 0) {
      stats.skipped = missingVectorCount;
      stats.failed = 1;
      stats.errors.push(
        `${relPath}: Embedding provider returned no vectors for ${missingVectorCount} chunk(s)`
      );
    }

    if (vectors.length === 0) {
      return stats;
    }

    // Upstash rejects an upsert when the vector length does not match the
    // dimension the index was provisioned with. Detect the mismatch here
    // so the error points at the configuration instead of a cryptic 400
    // buried inside the SDK.
    const embeddingDimension = vectors[0]?.vector.length ?? this.embedder.dimensions;
    if (
      typeof indexDimension === "number" &&
      indexDimension > 0 &&
      embeddingDimension > 0 &&
      embeddingDimension !== indexDimension
    ) {
      stats.failed = 1;
      stats.skipped += vectors.length;
      const message =
        `${relPath}: Embedding dimension ${embeddingDimension} (${this.embedder.id}/${this.embedder.model}) ` +
        `does not match Upstash Vector index dimension ${indexDimension}. ` +
        `Reprovision the index with dimension ${embeddingDimension}, or switch the embedding ` +
        `provider/model so it produces ${indexDimension}-dim vectors.`;
      stats.errors.push(message);
      log.warn(
        {
          path: relPath,
          embeddingDimension,
          indexDimension,
          provider: this.embedder.id,
          model: this.embedder.model,
        },
        "Semantic memory sync aborted: embedding/index dimension mismatch"
      );
      return stats;
    }

    try {
      await store.upsertKnowledge(vectors);
      stats.upserted = vectors.length;
      const newIds = new Set(vectors.map((vector) => vector.id));
      const staleIds = oldIds.filter((id) => !newIds.has(id));
      if (staleIds.length > 0) {
        try {
          await store.delete(staleIds);
          stats.deleted = staleIds.length;
        } catch (error) {
          stats.failed++;
          stats.errors.push(`${relPath}: stale vector cleanup failed: ${getErrorMessage(error)}`);
          log.warn({ err: error, path: relPath }, "Semantic memory cleanup failed; continuing");
        }
      }
      this.setSemanticMigrationHash(relPath, fileHash);
    } catch (error) {
      stats.failed++;
      const baseMessage = getErrorMessage(error);
      const hint = /dimension/i.test(baseMessage)
        ? ` Embedding provider ${this.embedder.id}/${this.embedder.model} produces ${embeddingDimension}-dim vectors; reprovision the Upstash index with a matching dimension or switch providers.`
        : "";
      stats.errors.push(`${relPath}: ${baseMessage}${hint}`);
      log.warn({ err: error, path: relPath }, "Semantic memory sync failed; local fallback ready");
    }

    return stats;
  }

  private listMemoryFiles(): string[] {
    const files: string[] = [];

    const memoryMd = join(this.workspaceDir, "MEMORY.md");
    if (existsSync(memoryMd)) {
      files.push(memoryMd);
    }

    const memoryDir = join(this.workspaceDir, "memory");
    if (existsSync(memoryDir)) {
      const entries = readdirSync(memoryDir);
      for (const entry of entries) {
        const absPath = join(memoryDir, entry);
        if (statSync(absPath).isFile() && entry.endsWith(".md")) {
          files.push(absPath);
        }
      }
    }

    return files;
  }

  /**
   * Chunk markdown content with structure awareness.
   * Respects heading boundaries, code blocks, and list groups.
   * Target: KNOWLEDGE_CHUNK_SIZE chars, hard max: 2x target.
   */
  private chunkMarkdown(content: string, path: string): KnowledgeChunk[] {
    const lines = content.split("\n");
    const chunks: KnowledgeChunk[] = [];
    const targetSize = KNOWLEDGE_CHUNK_SIZE;
    const hardMax = targetSize * 2;

    let currentChunk = "";
    let startLine = 1;
    let currentLine = 1;
    let inCodeBlock = false;
    let overlapPrefix = "";

    const flushChunk = () => {
      const text = currentChunk.trim();
      if (text.length > 0) {
        chunks.push({
          id: hashText(`${path}:${startLine}:${currentLine - 1}`),
          source: "memory",
          path,
          text,
          startLine,
          endLine: currentLine - 1,
          hash: hashText(text),
        });
        const nonEmpty = text.split("\n").filter((l) => l.trim());
        overlapPrefix = nonEmpty.length > 0 ? nonEmpty.slice(-2).join("\n") + "\n" : "";
      }
      currentChunk = overlapPrefix;
      startLine = currentLine;
    };

    for (const line of lines) {
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
      }

      if (!inCodeBlock && currentChunk.length >= targetSize) {
        const isHeading = /^#{1,6}\s/.test(line);
        const isBlankLine = line.trim() === "";
        const isHorizontalRule = /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());

        if (isHeading) {
          flushChunk();
        } else if ((isBlankLine || isHorizontalRule) && currentChunk.length >= targetSize) {
          currentChunk += line + "\n";
          currentLine++;
          flushChunk();
          continue;
        } else if (currentChunk.length >= hardMax) {
          flushChunk();
        }
      }

      currentChunk += line + "\n";
      currentLine++;
    }

    flushChunk();
    return chunks;
  }
}
