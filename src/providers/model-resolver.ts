import { getModel, type Model, type Api } from "@mariozechner/pi-ai";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const log = createLogger("LLM");

const modelCache = new Map<string, Model<Api>>();

const COCOON_MODELS: Record<string, Model<"openai-completions">> = {};

/** Register models discovered from a running Cocoon client */
export async function registerCocoonModels(httpPort: number): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`http://localhost:${httpPort}/v1/models`, {
      timeoutMs: 3000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; name?: string }[];
      models?: { id?: string; name?: string }[];
    };
    const models = body.data || body.models || [];
    if (!Array.isArray(models)) return [];
    const ids: string[] = [];
    for (const m of models) {
      const id = m.id || m.name || String(m);
      COCOON_MODELS[id] = {
        id,
        name: id,
        api: "openai-completions",
        provider: "cocoon",
        baseUrl: `http://localhost:${httpPort}/v1`,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      };
      ids.push(id);
    }
    return ids;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      log.warn({ port: httpPort }, "Cocoon /v1/models timed out after 3s, returning empty list");
    }
    return [];
  }
}

const LOCAL_MODELS: Record<string, Model<"openai-completions">> = {};

/** Register models discovered from a local OpenAI-compatible server */
export async function registerLocalModels(baseUrl: string): Promise<string[]> {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      log.warn(`Local LLM base_url must use http or https (got ${parsed.protocol})`);
      return [];
    }
    const url = baseUrl.replace(/\/+$/, "");
    const res = await fetchWithTimeout(`${url}/models`, { timeoutMs: 10_000 });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; name?: string }[];
      models?: { id?: string; name?: string }[];
    };
    const rawModels = body.data || body.models || [];
    if (!Array.isArray(rawModels)) return [];
    const models = rawModels.slice(0, 500);
    const ids: string[] = [];
    for (const m of models) {
      const id = m.id || m.name || String(m);
      LOCAL_MODELS[id] = {
        id,
        name: id,
        api: "openai-completions",
        provider: "local",
        baseUrl: url,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      };
      ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/** Moonshot backward-compat: old model IDs → kimi-coding IDs */
const MOONSHOT_MODEL_ALIASES: Record<string, string> = {
  "kimi-k2.5": "kimi-for-coding",
  k2p6: "kimi-for-coding",
};

export function getProviderModel(provider: SupportedProvider, modelId: string): Model<Api> {
  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const meta = getProviderMetadata(provider);

  if (meta.piAiProvider === "cocoon") {
    let model = COCOON_MODELS[modelId];
    if (!model) {
      model = Object.values(COCOON_MODELS)[0];
      if (model) log.warn(`Cocoon model "${modelId}" not found, using "${model.id}"`);
    }
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error("No Cocoon models available. Is the cocoon client running?");
  }

  if (meta.piAiProvider === "local") {
    let model = LOCAL_MODELS[modelId];
    if (!model) {
      model = Object.values(LOCAL_MODELS)[0];
      if (model) log.warn(`Local model "${modelId}" not found, using "${model.id}"`);
    }
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error("No local models available. Is the LLM server running?");
  }

  // Moonshot backward-compat: remap old model IDs to kimi-coding IDs
  if (provider === "moonshot" && MOONSHOT_MODEL_ALIASES[modelId]) {
    modelId = MOONSHOT_MODEL_ALIASES[modelId];
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getModel requires literal provider+model types; dynamic strings need casts
    const model = getModel(meta.piAiProvider as any, modelId as any);
    if (!model) {
      throw new Error(`getModel returned undefined for ${provider}/${modelId}`);
    }
    modelCache.set(cacheKey, model);
    return model;
  } catch {
    log.warn(`Model ${modelId} not found for ${provider}, falling back to ${meta.defaultModel}`);
    const fallbackKey = `${provider}:${meta.defaultModel}`;
    const fallbackCached = modelCache.get(fallbackKey);
    if (fallbackCached) return fallbackCached;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as above: dynamic strings
      const model = getModel(meta.piAiProvider as any, meta.defaultModel as any);
      if (!model) {
        throw new Error(
          `Fallback model ${meta.defaultModel} also returned undefined for ${provider}`
        );
      }
      modelCache.set(fallbackKey, model);
      return model;
    } catch {
      throw new Error(
        `Could not find model ${modelId} or fallback ${meta.defaultModel} for ${provider}`
      );
    }
  }
}

export function getUtilityModel(provider: SupportedProvider, overrideModel?: string): Model<Api> {
  const meta = getProviderMetadata(provider);
  const modelId = overrideModel || meta.utilityModel;
  return getProviderModel(provider, modelId);
}
