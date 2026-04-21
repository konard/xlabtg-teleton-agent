export * from "./database.js";
export * from "./schema.js";
export * from "./embeddings/index.js";
export * from "./agent/index.js";
export * from "./feed/index.js";
export * from "./search/hybrid.js";
export * from "./search/context.js";
export * from "./vector-store.js";

import type Database from "better-sqlite3";
import { getDatabase, type DatabaseConfig } from "./database.js";
import {
  createEmbeddingProvider,
  CachedEmbeddingProvider,
  type EmbeddingProviderConfig,
} from "./embeddings/index.js";
import { KnowledgeIndexer } from "./agent/knowledge.js";
import { MessageStore } from "./feed/messages.js";
import { ContextBuilder } from "./search/context.js";
import { createSemanticVectorStoreFromConfig, type SemanticVectorStore } from "./vector-store.js";
import type { VectorMemoryConfig } from "../config/schema.js";

export interface MemorySystem {
  db: Database.Database;
  embedder: ReturnType<typeof createEmbeddingProvider>;
  knowledge: KnowledgeIndexer;
  messages: MessageStore;
  context: ContextBuilder;
  vectorStore: SemanticVectorStore;
}

export function initializeMemory(config: {
  database: DatabaseConfig;
  embeddings: EmbeddingProviderConfig;
  vectorMemory?: VectorMemoryConfig;
  workspaceDir: string;
}): MemorySystem {
  const db = getDatabase(config.database);
  const rawEmbedder = createEmbeddingProvider(config.embeddings);
  const vectorEnabled = db.isVectorSearchReady();
  const database: Database.Database = db.getDb();
  const vectorStore = createSemanticVectorStoreFromConfig(config.vectorMemory);
  const embedder =
    rawEmbedder.id === "noop" ? rawEmbedder : new CachedEmbeddingProvider(rawEmbedder, database);

  return {
    db: database,
    embedder,
    knowledge: new KnowledgeIndexer(
      database,
      config.workspaceDir,
      embedder,
      vectorEnabled,
      vectorStore
    ),
    messages: new MessageStore(database, embedder, vectorEnabled),
    context: new ContextBuilder(database, embedder, vectorEnabled, vectorStore),
    vectorStore,
  };
}
