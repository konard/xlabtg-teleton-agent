export * from "./database.js";
export * from "./schema.js";
export * from "./embeddings/index.js";
export * from "./agent/index.js";
export * from "./feed/index.js";
export * from "./search/hybrid.js";
export * from "./search/context.js";
export * from "./vector-store.js";
export * from "./graph-store.js";
export * from "./graph-query.js";
export * from "./entity-extractor.js";
export * from "./scoring.js";
export * from "./retention.js";
export * from "./scheduler.js";

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
import { MemoryScorer } from "./scoring.js";
import { MemoryRetentionService } from "./retention.js";
import { MemoryPrioritizationScheduler } from "./scheduler.js";
import type { MemoryConfig, VectorMemoryConfig } from "../config/schema.js";

export interface MemorySystem {
  db: Database.Database;
  embedder: ReturnType<typeof createEmbeddingProvider>;
  knowledge: KnowledgeIndexer;
  messages: MessageStore;
  context: ContextBuilder;
  vectorStore: SemanticVectorStore;
  scorer: MemoryScorer;
  retention: MemoryRetentionService;
  scheduler: MemoryPrioritizationScheduler;
}

export function initializeMemory(config: {
  database: DatabaseConfig;
  embeddings: EmbeddingProviderConfig;
  vectorMemory?: VectorMemoryConfig;
  memory?: MemoryConfig;
  workspaceDir: string;
}): MemorySystem {
  const db = getDatabase(config.database);
  const rawEmbedder = createEmbeddingProvider(config.embeddings);
  const vectorEnabled = db.isVectorSearchReady();
  const database: Database.Database = db.getDb();
  const vectorStore = createSemanticVectorStoreFromConfig(config.vectorMemory);
  const embedder =
    rawEmbedder.id === "noop" ? rawEmbedder : new CachedEmbeddingProvider(rawEmbedder, database);
  const scorer = new MemoryScorer(database, {
    weights: config.memory?.prioritization.weights,
    recency_half_life_days: config.memory?.prioritization.recency_half_life_days,
  });
  const retention = new MemoryRetentionService(
    database,
    config.memory?.retention,
    scorer,
    vectorStore
  );
  const scheduler = new MemoryPrioritizationScheduler(
    database,
    {
      enabled: config.memory?.prioritization.enabled,
      interval_minutes: config.memory?.prioritization.interval_minutes,
      scoring: {
        weights: config.memory?.prioritization.weights,
        recency_half_life_days: config.memory?.prioritization.recency_half_life_days,
      },
      retention: config.memory?.retention,
    },
    vectorStore
  );
  scheduler.start();

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
    scorer,
    retention,
    scheduler,
  };
}
