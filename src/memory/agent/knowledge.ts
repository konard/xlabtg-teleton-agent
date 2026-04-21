import type Database from "better-sqlite3";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_CHUNK_SIZE } from "../../constants/limits.js";
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

export class KnowledgeIndexer {
  constructor(
    private db: Database.Database,
    private workspaceDir: string,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean,
    private semanticVectorStore?: SemanticVectorStore
  ) {}

  async indexAll(options?: { force?: boolean }): Promise<{ indexed: number; skipped: number }> {
    const files = this.listMemoryFiles();
    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      const wasIndexed = await this.indexFile(file, options?.force);
      if (wasIndexed) {
        indexed++;
      } else {
        skipped++;
      }
    }

    return { indexed, skipped };
  }

  async indexFile(absPath: string, force?: boolean): Promise<boolean> {
    if (!existsSync(absPath) || !absPath.endsWith(".md")) {
      return false;
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
        return false;
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

    await this.syncSemanticVectorStore(relPath, fileHash, existingIds, chunks, embeddings);

    return true;
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
    embeddings: number[][]
  ): Promise<void> {
    const store = this.semanticVectorStore;
    if (!store?.isConfigured) return;

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

    if (vectors.length === 0) return;

    try {
      await store.upsertKnowledge(vectors);
      const newIds = new Set(vectors.map((vector) => vector.id));
      const staleIds = oldIds.filter((id) => !newIds.has(id));
      if (staleIds.length > 0) {
        try {
          await store.delete(staleIds);
        } catch (error) {
          log.warn({ err: error, path: relPath }, "Semantic memory cleanup failed; continuing");
        }
      }
      this.setSemanticMigrationHash(relPath, fileHash);
    } catch (error) {
      log.warn({ err: error, path: relPath }, "Semantic memory sync failed; local fallback ready");
    }
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
