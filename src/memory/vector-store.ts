import { Index } from "@upstash/vector";
import type { InfoResult, QueryResult } from "@upstash/vector";
import type { VectorMemoryConfig } from "../config/schema.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Memory");

export interface SemanticMemoryStatus {
  mode: "online" | "standby" | "fallback";
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
  configure?(config: UpstashVectorStoreConfig): void;
  healthCheck(): Promise<SemanticMemoryStatus>;
  logStatus(): Promise<SemanticMemoryStatus>;
  searchKnowledge(embedding: number[], limit: number): Promise<SemanticMemorySearchResult[]>;
  upsertKnowledge(vectors: SemanticMemoryVector[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

export interface UpstashVectorStoreConfig {
  url?: string;
  token?: string;
  namespace?: string;
  requestTimeoutMs?: number;
}

const DEFAULT_NAMESPACE = "teleton-memory";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function numberFromMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resultText(result: QueryResult<SemanticMemoryMetadata>): string {
  if (typeof result.data === "string") return result.data;
  if (typeof result.metadata?.text === "string") return result.metadata.text;
  return "";
}

function withRequestTimeout<T>(
  promise: Promise<T>,
  operation: string,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class UpstashSemanticVectorStore implements SemanticVectorStore {
  private currentNamespace = DEFAULT_NAMESPACE;
  private index: Index<SemanticMemoryMetadata> | null = null;
  private lastLoggedMode: SemanticMemoryStatus["mode"] | null = null;
  private requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;

  constructor(config: UpstashVectorStoreConfig = {}) {
    this.configure(config);
  }

  get namespace(): string {
    return this.currentNamespace;
  }

  configure(config: UpstashVectorStoreConfig = {}): void {
    this.currentNamespace = config.namespace || DEFAULT_NAMESPACE;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (config.url && config.token) {
      this.index = new Index<SemanticMemoryMetadata>({
        url: config.url,
        token: config.token,
        retry: { retries: 1 },
      });
    } else {
      this.index = null;
    }
    this.lastLoggedMode = null;
  }

  get isConfigured(): boolean {
    return this.index !== null;
  }

  async healthCheck(): Promise<SemanticMemoryStatus> {
    if (!this.index) {
      return {
        mode: "standby",
        reason: "UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN are not configured",
      };
    }

    try {
      const info: InfoResult = await withRequestTimeout(
        this.index.info(),
        "Upstash Vector info",
        this.requestTimeoutMs
      );
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
      } else if (status.mode === "standby") {
        log.info(
          `Semantic Memory: Standby (${status.reason ?? "Upstash Vector is not configured"}; local memory remains active)`
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

    const results = await withRequestTimeout(
      this.index.query(
        {
          vector: embedding,
          topK: limit,
          includeMetadata: true,
          includeData: true,
        },
        { namespace: this.namespace }
      ),
      "Upstash Vector query",
      this.requestTimeoutMs
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
    await withRequestTimeout(
      this.index.upsert(payload, { namespace: this.namespace }),
      "Upstash Vector upsert",
      this.requestTimeoutMs
    );
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.index || ids.length === 0) return;
    await withRequestTimeout(
      this.index.delete(ids, { namespace: this.namespace }),
      "Upstash Vector delete",
      this.requestTimeoutMs
    );
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

export function createSemanticVectorStoreFromConfig(
  config?: VectorMemoryConfig,
  env: NodeJS.ProcessEnv = process.env
): SemanticVectorStore {
  return new UpstashSemanticVectorStore({
    url: env.UPSTASH_VECTOR_REST_URL || config?.upstash_rest_url,
    token: env.UPSTASH_VECTOR_REST_TOKEN || config?.upstash_rest_token,
    namespace: env.UPSTASH_VECTOR_NAMESPACE || config?.namespace,
  });
}
