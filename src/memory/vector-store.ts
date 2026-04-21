import { Index } from "@upstash/vector";
import type { InfoResult, QueryResult } from "@upstash/vector";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Memory");

export interface SemanticMemoryStatus {
  mode: "online" | "fallback";
  reason?: string;
  vectorCount?: number;
  pendingVectorCount?: number;
}

export type SemanticMemoryMetadata = Record<string, unknown> & {
  source?: string;
  path?: string | null;
  startLine?: number;
  endLine?: number;
  hash?: string;
  chunkHash?: string;
  createdAt?: number;
  updatedAt?: number;
};

export interface SemanticMemoryVector {
  id: string;
  text: string;
  vector: number[];
  metadata: SemanticMemoryMetadata;
}

export interface SemanticMemorySearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  createdAt?: number;
}

export interface SemanticVectorStore {
  readonly isConfigured: boolean;
  readonly namespace: string;
  healthCheck(): Promise<SemanticMemoryStatus>;
  logStatus(): Promise<SemanticMemoryStatus>;
  searchKnowledge(embedding: number[], limit: number): Promise<SemanticMemorySearchResult[]>;
  upsertKnowledge(vectors: SemanticMemoryVector[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

interface UpstashVectorStoreConfig {
  url?: string;
  token?: string;
  namespace?: string;
}

const DEFAULT_NAMESPACE = "teleton-memory";

function numberFromMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resultText(result: QueryResult<SemanticMemoryMetadata>): string {
  if (typeof result.data === "string") return result.data;
  if (typeof result.metadata?.text === "string") return result.metadata.text;
  return "";
}

export class UpstashSemanticVectorStore implements SemanticVectorStore {
  readonly namespace: string;
  private readonly index: Index<SemanticMemoryMetadata> | null;
  private lastLoggedMode: SemanticMemoryStatus["mode"] | null = null;

  constructor(config: UpstashVectorStoreConfig = {}) {
    this.namespace = config.namespace || DEFAULT_NAMESPACE;
    if (config.url && config.token) {
      this.index = new Index<SemanticMemoryMetadata>({
        url: config.url,
        token: config.token,
        retry: { retries: 1 },
      });
    } else {
      this.index = null;
    }
  }

  get isConfigured(): boolean {
    return this.index !== null;
  }

  async healthCheck(): Promise<SemanticMemoryStatus> {
    if (!this.index) {
      return {
        mode: "fallback",
        reason: "UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN are not configured",
      };
    }

    try {
      const info: InfoResult = await this.index.info();
      return {
        mode: "online",
        vectorCount: info.vectorCount,
        pendingVectorCount: info.pendingVectorCount,
      };
    } catch (error) {
      return {
        mode: "fallback",
        reason: getErrorMessage(error),
      };
    }
  }

  async logStatus(): Promise<SemanticMemoryStatus> {
    const status = await this.healthCheck();
    if (status.mode !== this.lastLoggedMode) {
      this.lastLoggedMode = status.mode;
      if (status.mode === "online") {
        log.info(
          `Semantic Memory: Online (Upstash Vector, namespace=${this.namespace}, vectors=${status.vectorCount ?? 0})`
        );
      } else {
        log.warn(
          `Semantic Memory: Fallback Mode (${status.reason ?? "Upstash Vector unavailable"})`
        );
      }
    }
    return status;
  }

  async searchKnowledge(embedding: number[], limit: number): Promise<SemanticMemorySearchResult[]> {
    if (!this.index || embedding.length === 0 || limit <= 0) return [];

    const results = await this.index.query(
      {
        vector: embedding,
        topK: limit,
        includeMetadata: true,
        includeData: true,
      },
      { namespace: this.namespace }
    );

    return results
      .map((result) => {
        const text = resultText(result);
        const source =
          typeof result.metadata?.path === "string"
            ? result.metadata.path
            : typeof result.metadata?.source === "string"
              ? result.metadata.source
              : "memory";
        const createdAt =
          numberFromMetadata(result.metadata?.createdAt) ??
          numberFromMetadata(result.metadata?.created_at);
        return {
          id: String(result.id),
          text,
          source,
          score: result.score,
          vectorScore: result.score,
          createdAt,
        };
      })
      .filter((result) => result.text.length > 0);
  }

  async upsertKnowledge(vectors: SemanticMemoryVector[]): Promise<void> {
    if (!this.index) return;

    const payload = vectors
      .filter((item) => item.vector.length > 0 && item.text.length > 0)
      .map((item) => ({
        id: item.id,
        vector: item.vector,
        metadata: {
          ...item.metadata,
          text: item.text,
        },
      }));

    if (payload.length === 0) return;
    await this.index.upsert(payload, { namespace: this.namespace });
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.index || ids.length === 0) return;
    await this.index.delete(ids, { namespace: this.namespace });
  }
}

export function createSemanticVectorStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SemanticVectorStore {
  return new UpstashSemanticVectorStore({
    url: env.UPSTASH_VECTOR_REST_URL,
    token: env.UPSTASH_VECTOR_REST_TOKEN,
    namespace: env.UPSTASH_VECTOR_NAMESPACE,
  });
}
