import { describe, it, expect } from "vitest";
import {
  GROQ_MODEL_REGISTRY,
  getGroqModelsByType,
  getGroqModelById,
  getGroqTextModelIds,
  getGroqSttModelIds,
  getGroqTtsModelIds,
} from "../groq/modelRegistry.js";

describe("Groq Model Registry", () => {
  it("has entries in the model registry", () => {
    expect(GROQ_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has text, stt, and tts models", () => {
    const types = new Set(GROQ_MODEL_REGISTRY.map((m) => m.type));
    expect(types).toContain("text");
    expect(types).toContain("stt");
    expect(types).toContain("tts");
  });

  it("getGroqModelsByType returns only text models", () => {
    const textModels = getGroqModelsByType("text");
    expect(textModels.length).toBeGreaterThan(0);
    expect(textModels.every((m) => m.type === "text")).toBe(true);
  });

  it("getGroqModelsByType returns only stt models", () => {
    const sttModels = getGroqModelsByType("stt");
    expect(sttModels.length).toBeGreaterThan(0);
    expect(sttModels.every((m) => m.type === "stt")).toBe(true);
  });

  it("getGroqModelsByType returns only tts models", () => {
    const ttsModels = getGroqModelsByType("tts");
    expect(ttsModels.length).toBeGreaterThan(0);
    expect(ttsModels.every((m) => m.type === "tts")).toBe(true);
  });

  it("getGroqModelById finds a known model", () => {
    const model = getGroqModelById("whisper-large-v3-turbo");
    expect(model).toBeDefined();
    expect(model?.type).toBe("stt");
    expect(model?.displayName).toContain("Whisper");
  });

  it("getGroqModelById returns undefined for unknown model", () => {
    expect(getGroqModelById("not-a-real-model")).toBeUndefined();
  });

  it("all text models have rpm, tpm, and tpd > 0", () => {
    const textModels = getGroqModelsByType("text");
    for (const m of textModels) {
      expect(m.rpm).toBeGreaterThan(0);
      expect(m.tpm).toBeGreaterThan(0);
      expect(m.tpd).toBeGreaterThan(0);
    }
  });

  it("all STT models have asph defined", () => {
    const sttModels = getGroqModelsByType("stt");
    for (const m of sttModels) {
      expect(m.asph).toBeDefined();
      expect(m.asph).toBeGreaterThan(0);
    }
  });

  it("all TTS models have asph defined", () => {
    const ttsModels = getGroqModelsByType("tts");
    for (const m of ttsModels) {
      expect(m.asph).toBeDefined();
      expect(m.asph).toBeGreaterThan(0);
    }
  });

  it("getGroqTextModelIds returns an array of strings", () => {
    const ids = getGroqTextModelIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("getGroqSttModelIds includes whisper models", () => {
    const ids = getGroqSttModelIds();
    expect(ids.some((id) => id.includes("whisper"))).toBe(true);
  });

  it("getGroqTtsModelIds includes orpheus models", () => {
    const ids = getGroqTtsModelIds();
    expect(ids.some((id) => id.includes("orpheus"))).toBe(true);
  });

  it("all models have required fields", () => {
    for (const model of GROQ_MODEL_REGISTRY) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
      expect(["text", "stt", "tts"]).toContain(model.type);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
      expect(typeof model.rpm).toBe("number");
      expect(model.rpm).toBeGreaterThan(0);
    }
  });

  it("does not contain deprecated models that have been shut down", () => {
    const ids = GROQ_MODEL_REGISTRY.map((m) => m.id);
    // These models were deprecated and removed from Groq
    expect(ids).not.toContain("mixtral-8x7b-32768"); // shutdown 2025-03-20
    expect(ids).not.toContain("llama3-70b-8192"); // shutdown 2025-08-30
    expect(ids).not.toContain("llama3-8b-8192"); // shutdown 2025-08-30
    expect(ids).not.toContain("deepseek-r1-distill-llama-70b"); // shutdown 2025-10-02
    expect(ids).not.toContain("gemma2-9b-it"); // shutdown 2025-10-08
    // This model was never available on Groq
    expect(ids).not.toContain("meta-llama/llama-4-maverick-17b-128e-instruct");
  });

  it("contains current production text models", () => {
    const ids = GROQ_MODEL_REGISTRY.map((m) => m.id);
    expect(ids).toContain("llama-3.3-70b-versatile");
    expect(ids).toContain("llama-3.1-8b-instant");
    expect(ids).toContain("openai/gpt-oss-120b");
    expect(ids).toContain("openai/gpt-oss-20b");
  });
});
