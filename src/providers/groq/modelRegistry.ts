/**
 * Groq Model Registry
 *
 * Classifies Groq models by type (text, STT, TTS) with rate-limit metadata.
 * Rate limits are sourced from Groq's free-plan documentation (as of 2026).
 *
 * Models last verified: 2026-03-20 against https://console.groq.com/docs/models
 * Removed deprecated models (past shutdown dates):
 *   - mixtral-8x7b-32768 (shutdown 2025-03-20)
 *   - llama3-70b-8192 (shutdown 2025-08-30)
 *   - llama3-8b-8192 (shutdown 2025-08-30)
 *   - deepseek-r1-distill-llama-70b (shutdown 2025-10-02)
 *   - gemma2-9b-it (shutdown 2025-10-08)
 *   - meta-llama/llama-4-maverick-17b-128e-instruct (never available on Groq)
 */

export type GroqModelType = "text" | "stt" | "tts";

export interface GroqModelEntry {
  id: string;
  type: GroqModelType;
  displayName: string;
  /** Requests per minute (free plan) */
  rpm: number;
  /** Tokens per minute (text models only, 0 for STT/TTS) */
  tpm: number;
  /** Tokens per day (text models only, 0 for STT/TTS) */
  tpd: number;
  /** Audio seconds per hour (STT/TTS models only, 0 for text) */
  asph?: number;
  /** Whether the model is in preview/beta (not for production use) */
  preview?: boolean;
}

/**
 * Static model registry for Groq.
 * Update this list as Groq releases new models.
 * Source: https://console.groq.com/docs/models
 */
export const GROQ_MODEL_REGISTRY: GroqModelEntry[] = [
  // ─── Text Models (Production) ─────────────────────────────────────────────
  {
    id: "llama-3.3-70b-versatile",
    type: "text",
    displayName: "Llama 3.3 70B Versatile",
    rpm: 30,
    tpm: 6000,
    tpd: 500000,
  },
  {
    id: "llama-3.1-8b-instant",
    type: "text",
    displayName: "Llama 3.1 8B Instant",
    rpm: 30,
    tpm: 20000,
    tpd: 500000,
  },
  {
    id: "openai/gpt-oss-120b",
    type: "text",
    displayName: "GPT OSS 120B",
    rpm: 30,
    tpm: 6000,
    tpd: 500000,
  },
  {
    id: "openai/gpt-oss-20b",
    type: "text",
    displayName: "GPT OSS 20B",
    rpm: 30,
    tpm: 15000,
    tpd: 500000,
  },
  // ─── Text Models (Preview) ────────────────────────────────────────────────
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    type: "text",
    displayName: "Llama 4 Scout 17B (Preview)",
    rpm: 30,
    tpm: 8000,
    tpd: 500000,
    preview: true,
  },
  {
    id: "qwen/qwen3-32b",
    type: "text",
    displayName: "Qwen3 32B (Preview)",
    rpm: 30,
    tpm: 6000,
    tpd: 500000,
    preview: true,
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    type: "text",
    displayName: "Kimi K2 (Preview)",
    rpm: 30,
    tpm: 6000,
    tpd: 500000,
    preview: true,
  },

  // ─── STT Models ───────────────────────────────────────────────────────────
  {
    id: "whisper-large-v3",
    type: "stt",
    displayName: "Whisper Large v3",
    rpm: 20,
    tpm: 0,
    tpd: 0,
    asph: 7200,
  },
  {
    id: "whisper-large-v3-turbo",
    type: "stt",
    displayName: "Whisper Large v3 Turbo",
    rpm: 20,
    tpm: 0,
    tpd: 0,
    asph: 7200,
  },
  {
    id: "distil-whisper-large-v3-en",
    type: "stt",
    displayName: "Distil Whisper Large v3 (EN)",
    rpm: 20,
    tpm: 0,
    tpd: 0,
    asph: 7200,
  },

  // ─── TTS Models (Orpheus) ─────────────────────────────────────────────────
  {
    id: "canopylabs/orpheus-v1-english",
    type: "tts",
    displayName: "Orpheus TTS English",
    rpm: 10,
    tpm: 0,
    tpd: 0,
    asph: 3600,
  },
  {
    id: "canopylabs/orpheus-arabic-saudi",
    type: "tts",
    displayName: "Orpheus TTS Arabic (Saudi)",
    rpm: 10,
    tpm: 0,
    tpd: 0,
    asph: 3600,
  },
];

/** Get all models of a given type */
export function getGroqModelsByType(type: GroqModelType): GroqModelEntry[] {
  return GROQ_MODEL_REGISTRY.filter((m) => m.type === type);
}

/** Look up a model entry by ID */
export function getGroqModelById(id: string): GroqModelEntry | undefined {
  return GROQ_MODEL_REGISTRY.find((m) => m.id === id);
}

/** Get all text model IDs (for use in text-completion config) */
export function getGroqTextModelIds(): string[] {
  return getGroqModelsByType("text").map((m) => m.id);
}

/** Get all STT model IDs */
export function getGroqSttModelIds(): string[] {
  return getGroqModelsByType("stt").map((m) => m.id);
}

/** Get all TTS model IDs */
export function getGroqTtsModelIds(): string[] {
  return getGroqModelsByType("tts").map((m) => m.id);
}
