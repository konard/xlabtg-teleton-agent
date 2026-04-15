import { describe, it, expect } from "vitest";
import { getProviderMetadata, validateApiKeyFormat } from "../../config/providers.js";
import { AgentConfigSchema } from "../../config/schema.js";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderModel } from "../../agent/client.js";

describe("NVIDIA provider registration", () => {
  it("is registered in the provider registry", () => {
    const meta = getProviderMetadata("nvidia");
    expect(meta.id).toBe("nvidia");
    expect(meta.displayName).toBe("NVIDIA NIM");
    expect(meta.envVar).toBe("NVIDIA_API_KEY");
    expect(meta.keyPrefix).toBe("nvapi-");
    expect(meta.piAiProvider).toBe("nvidia");
  });

  it("is accepted by AgentConfigSchema", () => {
    const result = AgentConfigSchema.safeParse({ provider: "nvidia" });
    expect(result.success).toBe(true);
  });

  it("validates nvapi- key prefix", () => {
    expect(validateApiKeyFormat("nvidia", "nvapi-valid-key-123")).toBeUndefined();
    const err = validateApiKeyFormat("nvidia", "invalid_key");
    expect(err).toBeDefined();
    expect(err).toContain("nvapi-");
  });
});

describe("NVIDIA model routing", () => {
  it("uses the /v1 NVIDIA base URL for OpenAI-compatible chat completions", () => {
    const model = getProviderModel("nvidia", "meta/llama-3.1-8b-instruct");

    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("nvidia");
    expect("baseUrl" in model && model.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("uses max_tokens compatibility for NVIDIA's OpenAI-compatible endpoint", () => {
    const model = getProviderModel("nvidia", "meta/llama-3.1-8b-instruct");

    expect("compat" in model && model.compat?.maxTokensField).toBe("max_tokens");
    expect("compat" in model && model.compat?.supportsStrictMode).toBe(false);
  });
});

describe("NVIDIA curated model catalog", () => {
  it("contains chat completion models", () => {
    const models = getModelsForProvider("nvidia");

    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value === "qwen/qwen3-coder-480b-a35b-instruct")).toBe(true);
    expect(models.some((m) => m.value === "deepseek-ai/deepseek-v3.1")).toBe(true);
  });

  it("does not expose embedding or reranking models in the chat provider dropdown", () => {
    const models = getModelsForProvider("nvidia");

    expect(models.some((m) => m.value === "baai/bge-m3")).toBe(false);
    expect(models.some((m) => m.value === "nvidia/embed-qa-4")).toBe(false);
    expect(models.some((m) => m.value === "nvidia/rerank-qa-mistral-4b")).toBe(false);
  });

  it("filters out stale preview models that were returning 404/410 errors", () => {
    const models = getModelsForProvider("nvidia");
    const values = models.map((m) => m.value);

    expect(values).not.toContain("qwen/qwen-2.5-72b-instruct");
    expect(values).not.toContain("mistralai/mistral-large-2411");
    expect(values).not.toContain("google/gemma-2-27b-it");
    expect(values).not.toContain("nvidia/llama-3.3-nemotron-super-49b-v1");
  });
});
