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
  /** Dimension the Upstash index was provisioned with (reported by /info). */
  indexDimension?: number;
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
  /** Message-specific metadata (mirrors the local tg_messages columns). */
  chatId?: string;
  senderId?: string | null;
  timestamp?: number;
  isFromAgent?: boolean;
};

/** Optional metadata filters applied to a semantic message search. */
export interface SemanticMessageSearchOptions {
  chatId?: string;
  afterTimestamp?: number;
}

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
  searchMessages(
    embedding: number[],
    limit: number,
    options?: SemanticMessageSearchOptions
  ): Promise<SemanticMemorySearchResult[]>;
  upsertKnowledge(vectors: SemanticMemoryVector[]): Promise<void>;
  upsertMessages(vectors: SemanticMemoryVector[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  deleteMessages(ids: string[]): Promise<void>;
}

export interface UpstashVectorStoreConfig {
  url?: string;
  token?: string;
  namespace?: string;
  requestTimeoutMs?: number;
}

const DEFAULT_NAMESPACE = "teleton-memory";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
// Messages live in a sibling namespace so knowledge search and message search
// never cross-contaminate, even though they share a single Upstash index.
const MESSAGE_NAMESPACE_SUFFIX = "-messages";

function escapeFilterValue(value: string): string {
  // Escape backslashes first so an existing "\" cannot combine with the quote
  // we add and break out of the quoted filter literal, then escape quotes.
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildMessageFilter(options: SemanticMessageSearchOptions): string | undefined {
  const clauses: string[] = [];
  if (options.chatId) {
    clauses.push(`chatId = '${escapeFilterValue(options.chatId)}'`);
  }
  if (typeof options.afterTimestamp === "number" && Number.isFinite(options.afterTimestamp)) {
    clauses.push(`timestamp >= ${Math.floor(options.afterTimestamp)}`);
  }
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

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
  private circuitOpenUntil = 0;

  constructor(config: UpstashVectorStoreConfig = {}) {
    this.configure(config);
  }

  get namespace(): string {
    return this.currentNamespace;
  }

  private get messageNamespace(): string {
    return `${this.currentNamespace}${MESSAGE_NAMESPACE_SUFFIX}`;
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
    this.circuitOpenUntil = 0;
  }

  get isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
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
        indexDimension: typeof info.dimension === "number" ? info.dimension : undefined,
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
        const dim = status.indexDimension ? `, dimension=${status.indexDimension}` : "";
        log.info(
          `Semantic Memory: Online (Upstash Vector, namespace=${this.namespace}, vectors=${status.vectorCount ?? 0}${dim})`
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

  /**
   * Run a vector query against a namespace, tripping the circuit breaker on
   * failure. The caller maps the raw Upstash results into search results.
   */
  private async queryNamespace(
    namespace: string,
    embedding: number[],
    limit: number,
    operation: string,
    filter?: string
  ): Promise<QueryResult<SemanticMemoryMetadata>[]> {
    if (!this.index || embedding.length === 0 || limit <= 0) return [];
    if (this.isCircuitOpen) return [];

    try {
      const results = await withRequestTimeout(
        this.index.query(
          {
            vector: embedding,
            topK: limit,
            includeMetadata: true,
            includeData: true,
            ...(filter ? { filter } : {}),
          },
          { namespace }
        ),
        operation,
        this.requestTimeoutMs
      );

      this.circuitOpenUntil = 0;
      return results;
    } catch (error) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      throw error;
    }
  }

  async searchKnowledge(embedding: number[], limit: number): Promise<SemanticMemorySearchResult[]> {
    const results = await this.queryNamespace(
      this.namespace,
      embedding,
      limit,
      "Upstash Vector query"
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

  async searchMessages(
    embedding: number[],
    limit: number,
    options: SemanticMessageSearchOptions = {}
  ): Promise<SemanticMemorySearchResult[]> {
    const results = await this.queryNamespace(
      this.messageNamespace,
      embedding,
      limit,
      "Upstash Vector message query",
      buildMessageFilter(options)
    );

    return results
      .map((result) => {
        const text = resultText(result);
        const source =
          typeof result.metadata?.chatId === "string"
            ? result.metadata.chatId
            : typeof result.metadata?.source === "string"
              ? result.metadata.source
              : "message";
        const createdAt =
          numberFromMetadata(result.metadata?.timestamp) ??
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
    await this.upsertToNamespace(this.namespace, vectors, "Upstash Vector upsert");
  }

  async upsertMessages(vectors: SemanticMemoryVector[]): Promise<void> {
    await this.upsertToNamespace(this.messageNamespace, vectors, "Upstash Vector message upsert");
  }

  private async upsertToNamespace(
    namespace: string,
    vectors: SemanticMemoryVector[],
    operation: string
  ): Promise<void> {
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
      this.index.upsert(payload, { namespace }),
      operation,
      this.requestTimeoutMs
    );
  }

  async delete(ids: string[]): Promise<void> {
    await this.deleteFromNamespace(this.namespace, ids, "Upstash Vector delete");
  }

  async deleteMessages(ids: string[]): Promise<void> {
    await this.deleteFromNamespace(this.messageNamespace, ids, "Upstash Vector message delete");
  }

  private async deleteFromNamespace(
    namespace: string,
    ids: string[],
    operation: string
  ): Promise<void> {
    if (!this.index || ids.length === 0) return;
    await withRequestTimeout(
      this.index.delete(ids, { namespace }),
      operation,
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
