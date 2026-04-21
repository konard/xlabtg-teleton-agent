import chokidar from "chokidar";
import type { Database } from "better-sqlite3";
import type { Config } from "../config/schema.js";
import { getPredictions, PredictionService } from "./predictions.js";
import { getCache } from "./cache.js";
import { loadPersistentMemory, loadSecurity, loadSoul, loadStrategy } from "../soul/loader.js";
import { WORKSPACE_PATHS } from "../workspace/index.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("CachePreloader");

export interface CacheWarmRequest {
  context?: string;
  sessionId?: string;
  chatId?: string;
  isGroup?: boolean;
  isAdmin?: boolean;
}

export interface CacheWarmResult {
  startedAt: number;
  durationMs: number;
  predictedTools: string[];
  warmed: {
    tools: string[];
    prompts: string[];
  };
}

interface PreloaderDeps {
  db: Database;
  config: Pick<Config, "predictions">;
  toolRegistry: ToolRegistry;
}

type WarmableRegistry = ToolRegistry & {
  warmTools?: (names: string[]) => string[];
};

export class PredictivePreloader {
  private db: Database;
  private config: Pick<Config, "predictions">;
  private toolRegistry: WarmableRegistry;

  constructor(deps: PreloaderDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.toolRegistry = deps.toolRegistry as WarmableRegistry;
  }

  async warm(request: CacheWarmRequest = {}): Promise<CacheWarmResult> {
    const startedAt = Date.now();
    const prompts = this.warmPrompts();
    const predictedTools = this.getPredictedTools(request);
    const tools = this.warmTools(predictedTools, request);

    return {
      startedAt,
      durationMs: Date.now() - startedAt,
      predictedTools,
      warmed: {
        tools,
        prompts,
      },
    };
  }

  warmInBackground(request: CacheWarmRequest = {}): void {
    this.warm(request).catch((error) => {
      log.warn({ err: error }, "Predictive cache warm failed");
    });
  }

  private warmPrompts(): string[] {
    const warmed: string[] = [];
    const promptLoaders: Array<[string, () => string | null]> = [
      ["soul", loadSoul],
      ["strategy", loadStrategy],
      ["security", loadSecurity],
      ["memory", loadPersistentMemory],
    ];

    for (const [name, loader] of promptLoaders) {
      try {
        loader();
        warmed.push(name);
      } catch (error) {
        log.debug({ err: error }, `Prompt warm failed: ${name}`);
      }
    }

    return warmed;
  }

  private getPredictedTools(request: CacheWarmRequest): string[] {
    if (this.config.predictions?.enabled !== true) return [];

    try {
      const predictions = getPredictions() ?? new PredictionService(this.db);
      return predictions
        .getLikelyTools({
          sessionId: request.sessionId,
          chatId: request.chatId,
          context: request.context,
          confidenceThreshold: this.config.predictions.confidence_threshold,
          limit: this.config.predictions.max_suggestions,
        })
        .map((prediction) => prediction.action);
    } catch (error) {
      log.debug({ err: error }, "Predicted tool lookup failed during cache warm");
      return [];
    }
  }

  private warmTools(predictedTools: string[], request: CacheWarmRequest): string[] {
    if (typeof this.toolRegistry.warmTools === "function") {
      return this.toolRegistry.warmTools(predictedTools);
    }

    try {
      this.toolRegistry.getForContext(
        request.isGroup ?? false,
        null,
        request.chatId,
        request.isAdmin
      );
      return predictedTools;
    } catch (error) {
      log.debug({ err: error }, "Tool cache warm failed");
      return [];
    }
  }
}

export class CacheInvalidationWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  start(): void {
    const watchedFiles = [
      this.configPath,
      WORKSPACE_PATHS.SOUL,
      WORKSPACE_PATHS.STRATEGY,
      WORKSPACE_PATHS.SECURITY,
      WORKSPACE_PATHS.MEMORY,
      WORKSPACE_PATHS.HEARTBEAT,
      WORKSPACE_PATHS.IDENTITY,
      WORKSPACE_PATHS.USER,
    ];

    this.watcher = chokidar.watch(watchedFiles, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      ignorePermissionErrors: true,
      usePolling: false,
    });

    this.watcher.on("change", (path: string) => this.invalidateForPath(path));
    this.watcher.on("add", (path: string) => this.invalidateForPath(path));
    this.watcher.on("unlink", (path: string) => this.invalidateForPath(path));
    this.watcher.on("error", (error: unknown) => {
      log.warn({ err: error }, "Cache invalidation watcher error");
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private invalidateForPath(path: string): void {
    const cache = getCache();
    if (!cache) return;

    if (path === this.configPath) {
      cache.invalidate({ type: "tools" });
      cache.invalidate({ type: "api_responses" });
    }
    cache.invalidate({ type: "prompts" });
  }
}

let preloader: PredictivePreloader | null = null;

export function initPreloader(deps: PreloaderDeps): PredictivePreloader {
  preloader = new PredictivePreloader(deps);
  return preloader;
}

export function getPreloader(): PredictivePreloader | null {
  return preloader;
}

export function resetPreloaderForTests(): void {
  preloader = null;
}
