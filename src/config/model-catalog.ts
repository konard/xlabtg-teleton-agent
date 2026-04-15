/**
 * Shared model catalog used by WebUI setup, CLI onboard, and config routes.
 * To add a model, add it here — it will appear in all UIs automatically.
 * Models must exist in pi-ai's registry (or be entered as custom).
 */

export interface ModelOption {
  value: string;
  name: string;
  description: string;
}

/** Extended model option with modal type classification (for multi-modal providers) */
export interface GroqModelOption extends ModelOption {
  type: "text" | "stt" | "tts";
}

/** Groq text models for LLM chat completions */
export const GROQ_TEXT_MODELS: ModelOption[] = [
  // Production models
  {
    value: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    description: "General purpose, 131K ctx, $0.59/M",
  },
  {
    value: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B",
    description: "Fast & cheap, 131K ctx, $0.05/M",
  },
  {
    value: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "Fast reasoning, 131K ctx, $0.90/M",
  },
  {
    value: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    description: "Ultra-fast, 131K ctx, $0.10/M",
  },
  // Preview models (available but not for production)
  {
    value: "qwen/qwen3-32b",
    name: "Qwen3 32B (Preview)",
    description: "Reasoning, 131K ctx, $0.29/M",
  },
  {
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B (Preview)",
    description: "Fast, 131K ctx",
  },
  {
    value: "moonshotai/kimi-k2-instruct",
    name: "Kimi K2 (Preview)",
    description: "Long context, 262K ctx",
  },
];

/** Groq STT (Speech-to-Text) models — Whisper variants */
export const GROQ_STT_MODELS: ModelOption[] = [
  {
    value: "whisper-large-v3",
    name: "Whisper Large v3",
    description: "Best accuracy, multilingual, $0.111/hr",
  },
  {
    value: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    description: "Fast + accurate, multilingual, $0.04/hr",
  },
  {
    value: "distil-whisper-large-v3-en",
    name: "Distil Whisper v3 (EN)",
    description: "English-only, fastest, $0.02/hr",
  },
];

/** Groq TTS (Text-to-Speech) models — Orpheus variants */
export const GROQ_TTS_MODELS: ModelOption[] = [
  {
    value: "canopylabs/orpheus-v1-english",
    name: "Orpheus TTS English",
    description: "English TTS, Orpheus v1, multiple voices",
  },
  {
    value: "canopylabs/orpheus-arabic-saudi",
    name: "Orpheus TTS Arabic (Saudi)",
    description: "Arabic (Saudi) TTS, Orpheus model",
  },
];

export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  anthropic: [
    {
      value: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      description: "Most capable, 1M ctx, $5/M",
    },
    {
      value: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      description: "Previous gen, 200K ctx, $5/M",
    },
    {
      value: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "Balanced, 200K ctx, $3/M",
    },
    {
      value: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fast & cheap, $1/M",
    },
  ],
  openai: [
    { value: "gpt-5", name: "GPT-5", description: "Most capable, 400K ctx, $1.25/M" },
    { value: "gpt-5-pro", name: "GPT-5 Pro", description: "Extended thinking, 400K ctx" },
    { value: "gpt-5-mini", name: "GPT-5 Mini", description: "Fast & cheap, 400K ctx" },
    {
      value: "gpt-5.4",
      name: "GPT-5.4",
      description: "Latest frontier, reasoning, openai-responses API",
    },
    {
      value: "gpt-5.4-pro",
      name: "GPT-5.4 Pro",
      description: "Extended thinking, openai-responses API",
    },
    { value: "gpt-5.1", name: "GPT-5.1", description: "Latest gen, 400K ctx" },
    { value: "gpt-4o", name: "GPT-4o", description: "Balanced, 128K ctx, $2.50/M" },
    { value: "gpt-4.1", name: "GPT-4.1", description: "1M ctx, $2/M" },
    { value: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "1M ctx, cheap, $0.40/M" },
    { value: "o4-mini", name: "o4 Mini", description: "Reasoning, fast, 200K ctx" },
    { value: "o3", name: "o3", description: "Reasoning, 200K ctx, $2/M" },
    { value: "codex-mini-latest", name: "Codex Mini", description: "Coding specialist" },
  ],
  google: [
    { value: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Preview, latest gen" },
    {
      value: "gemini-3.1-flash-lite-preview",
      name: "Gemini 3.1 Flash Lite",
      description: "Preview, fast & cheap",
    },
    { value: "gemini-3-pro-preview", name: "Gemini 3 Pro", description: "Preview, most capable" },
    { value: "gemini-3-flash-preview", name: "Gemini 3 Flash", description: "Preview, fast" },
    { value: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Stable, 1M ctx, $1.25/M" },
    { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast, 1M ctx, $0.30/M" },
    {
      value: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash Lite",
      description: "Ultra cheap, 1M ctx",
    },
    { value: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Cheap, 1M ctx, $0.10/M" },
  ],
  xai: [
    { value: "grok-4-1-fast", name: "Grok 4.1 Fast", description: "Latest, vision, 2M ctx" },
    { value: "grok-4-fast", name: "Grok 4 Fast", description: "Vision, 2M ctx, $0.20/M" },
    { value: "grok-4", name: "Grok 4", description: "Reasoning, 256K ctx, $3/M" },
    { value: "grok-code-fast-1", name: "Grok Code", description: "Coding specialist, fast" },
    { value: "grok-3", name: "Grok 3", description: "Stable, 131K ctx, $3/M" },
  ],
  groq: GROQ_TEXT_MODELS,
  openrouter: [
    { value: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", description: "200K ctx, $5/M" },
    {
      value: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "200K ctx, $3/M",
    },
    { value: "openai/gpt-5", name: "GPT-5", description: "400K ctx, $1.25/M" },
    { value: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "1M ctx, $0.30/M" },
    {
      value: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      description: "Reasoning, 64K ctx, $0.70/M",
    },
    {
      value: "deepseek/deepseek-r1-0528",
      name: "DeepSeek R1 0528",
      description: "Reasoning improved, 64K ctx",
    },
    {
      value: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      description: "Latest, general, 64K ctx",
    },
    { value: "deepseek/deepseek-v3.1", name: "DeepSeek V3.1", description: "General, 64K ctx" },
    {
      value: "deepseek/deepseek-v3-0324",
      name: "DeepSeek V3",
      description: "General, 64K ctx, $0.30/M",
    },
    { value: "qwen/qwen3-coder", name: "Qwen3 Coder", description: "Coding specialist" },
    { value: "qwen/qwen3-max", name: "Qwen3 Max", description: "Most capable Qwen" },
    { value: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", description: "235B params, MoE" },
    {
      value: "nvidia/nemotron-nano-9b-v2",
      name: "Nemotron Nano 9B",
      description: "Small & fast, Nvidia",
    },
    {
      value: "perplexity/sonar-pro",
      name: "Perplexity Sonar Pro",
      description: "Web search integrated",
    },
    { value: "minimax/minimax-m2.5", name: "MiniMax M2.5", description: "Latest MiniMax" },
    { value: "x-ai/grok-4", name: "Grok 4", description: "256K ctx, $3/M" },
    // Free models (no cost, rate-limited ~20 RPM)
    {
      value: "openrouter/free",
      name: "Free Models Router",
      description: "Auto-selects available free model, 200K ctx, FREE",
    },
    {
      value: "qwen/qwen3.6-plus:free",
      name: "Qwen3.6 Plus (free)",
      description: "1M ctx, MoE, SWE-bench 78.8, FREE",
    },
    {
      value: "stepfun/step-3.5-flash:free",
      name: "Step 3.5 Flash (free)",
      description: "256K ctx, MoE 196B/11B, high-speed, FREE",
    },
    {
      value: "nvidia/nemotron-3-super-120b-a12b:free",
      name: "Nemotron 3 Super 120B (free)",
      description: "262K ctx, Mamba-Transformer hybrid, FREE",
    },
    {
      value: "arcee-ai/trinity-large-preview:free",
      name: "Trinity Large Preview (free)",
      description: "131K ctx, 400B/13B MoE, FREE",
    },
    {
      value: "z-ai/glm-4.5-air:free",
      name: "GLM 4.5 Air (free)",
      description: "131K ctx, lightweight MoE, FREE",
    },
    {
      value: "nvidia/nemotron-nano-30b-a3b:free",
      name: "Nemotron Nano 30B A3B (free)",
      description: "256K ctx, compact MoE for agents, FREE",
    },
    {
      value: "nvidia/nemotron-nano-12b-2-vl:free",
      name: "Nemotron Nano 12B VL (free)",
      description: "128K ctx, multimodal text+images, FREE",
    },
    {
      value: "minimax/minimax-m2.5:free",
      name: "MiniMax M2.5 (free)",
      description: "197K ctx, SWE-Bench 80.2%, FREE",
    },
    {
      value: "nvidia/nemotron-nano-9b-v2:free",
      name: "Nemotron Nano 9B V2 (free)",
      description: "128K ctx, reasoning + non-reasoning, FREE",
    },
    {
      value: "openai/gpt-oss-120b:free",
      name: "GPT OSS 120B (free)",
      description: "131K ctx, MoE 117B/5.1B, Apache 2.0, FREE",
    },
    {
      value: "qwen/qwen3-coder-480b-a35b:free",
      name: "Qwen3 Coder 480B A35B (free)",
      description: "262K ctx, coding specialist 480B/35B MoE, FREE",
    },
    {
      value: "openai/gpt-oss-20b:free",
      name: "GPT OSS 20B (free)",
      description: "131K ctx, MoE 21B/3.6B, low-latency, FREE",
    },
    {
      value: "qwen/qwen3-next-80b-a3b-instruct:free",
      name: "Qwen3 Next 80B A3B (free)",
      description: "262K ctx, stable without thinking mode, FREE",
    },
    {
      value: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B Instruct (free)",
      description: "66K ctx, multilingual 8 languages, FREE",
    },
    {
      value: "liquidai/lfm2.5-1.2b-thinking:free",
      name: "LFM2.5 1.2B Thinking (free)",
      description: "33K ctx, edge-optimized reasoning, FREE",
    },
    {
      value: "liquidai/lfm2.5-1.2b-instruct:free",
      name: "LFM2.5 1.2B Instruct (free)",
      description: "33K ctx, compact chat for edge, FREE",
    },
    {
      value: "venice/uncensored:free",
      name: "Venice Uncensored (free)",
      description: "33K ctx, uncensored, FREE",
    },
    {
      value: "nousresearch/hermes-3-405b-instruct:free",
      name: "Hermes 3 405B Instruct (free)",
      description: "131K ctx, frontier-level Llama-3.1 405B fine-tune, FREE",
    },
    {
      value: "meta-llama/llama-3.2-3b-instruct:free",
      name: "Llama 3.2 3B Instruct (free)",
      description: "131K ctx, lightweight multilingual, FREE",
    },
    {
      value: "google/gemma-3-27b:free",
      name: "Gemma 3 27B (free)",
      description: "131K ctx, multimodal 140+ languages, FREE",
    },
    {
      value: "google/gemma-3-4b:free",
      name: "Gemma 3 4B (free)",
      description: "33K ctx, compact multimodal, FREE",
    },
    {
      value: "google/gemma-3n-4b:free",
      name: "Gemma 3n 4B (free)",
      description: "8K ctx, optimized for mobile, FREE",
    },
    {
      value: "google/gemma-3n-2b:free",
      name: "Gemma 3n 2B (free)",
      description: "8K ctx, ultra-lightweight edge model, FREE",
    },
    {
      value: "google/gemma-3-12b:free",
      name: "Gemma 3 12B (free)",
      description: "33K ctx, balanced quality/speed, FREE",
    },
  ],
  moonshot: [
    { value: "k2p5", name: "Kimi K2.5", description: "Free, 262K ctx, multimodal" },
    {
      value: "kimi-k2-thinking",
      name: "Kimi K2 Thinking",
      description: "Free, 262K ctx, reasoning",
    },
  ],
  mistral: [
    {
      value: "devstral-small-2507",
      name: "Devstral Small",
      description: "Coding, 128K ctx, $0.10/M",
    },
    {
      value: "devstral-medium-latest",
      name: "Devstral Medium",
      description: "Coding, 262K ctx, $0.40/M",
    },
    {
      value: "mistral-large-latest",
      name: "Mistral Large",
      description: "General, 128K ctx, $2/M",
    },
    {
      value: "magistral-small",
      name: "Magistral Small",
      description: "Reasoning, 128K ctx, $0.50/M",
    },
  ],
  cerebras: [
    {
      value: "qwen-3-235b-a22b-instruct-2507",
      name: "Qwen 3 235B",
      description: "131K ctx, $0.60/$1.20",
    },
    { value: "gpt-oss-120b", name: "GPT OSS 120B", description: "Reasoning, 131K ctx, $0.25/M" },
    { value: "zai-glm-4.7", name: "ZAI GLM-4.7", description: "131K ctx, $2.25/M" },
    { value: "llama3.1-8b", name: "Llama 3.1 8B", description: "Fast & cheap, 32K ctx, $0.10/M" },
  ],
  zai: [
    { value: "glm-4.7", name: "GLM-4.7", description: "204K ctx, $0.60/$2.20" },
    { value: "glm-5", name: "GLM-5", description: "Best quality, 204K ctx, $1.00/$3.20" },
    { value: "glm-4.6", name: "GLM-4.6", description: "204K ctx, $0.60/$2.20" },
    { value: "glm-4.7-flash", name: "GLM-4.7 Flash", description: "FREE, 200K ctx" },
    { value: "glm-4.5-flash", name: "GLM-4.5 Flash", description: "FREE, 131K ctx" },
    { value: "glm-4.5v", name: "GLM-4.5V", description: "Vision, 64K ctx, $0.60/$1.80" },
  ],
  minimax: [
    { value: "MiniMax-M2.5", name: "MiniMax M2.5", description: "204K ctx, $0.30/$1.20" },
    {
      value: "MiniMax-M2.5-highspeed",
      name: "MiniMax M2.5 Fast",
      description: "204K ctx, $0.60/$2.40",
    },
    { value: "MiniMax-M2.1", name: "MiniMax M2.1", description: "204K ctx, $0.30/$1.20" },
    { value: "MiniMax-M2", name: "MiniMax M2", description: "196K ctx, $0.30/$1.20" },
  ],
  huggingface: [
    {
      value: "deepseek-ai/DeepSeek-V3.2",
      name: "DeepSeek V3.2",
      description: "163K ctx, $0.28/$0.40",
    },
    {
      value: "deepseek-ai/DeepSeek-R1-0528",
      name: "DeepSeek R1",
      description: "Reasoning, 163K ctx, $3/$5",
    },
    {
      value: "Qwen/Qwen3-235B-A22B-Thinking-2507",
      name: "Qwen3 235B",
      description: "Reasoning, 262K ctx, $0.30/$3",
    },
    {
      value: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
      name: "Qwen3 Coder 480B",
      description: "Coding, 262K ctx, $2/$2",
    },
    {
      value: "Qwen/Qwen3-Next-80B-A3B-Instruct",
      name: "Qwen3 Next 80B",
      description: "262K ctx, $0.25/$1",
    },
    {
      value: "moonshotai/Kimi-K2.5",
      name: "Kimi K2.5",
      description: "262K ctx, $0.60/$3",
    },
    {
      value: "zai-org/GLM-4.7-Flash",
      name: "GLM-4.7 Flash",
      description: "FREE, 200K ctx",
    },
    { value: "zai-org/GLM-5", name: "GLM-5", description: "202K ctx, $1/$3.20" },
  ],
  nvidia: [
    {
      value: "minimax/minimax-m2.7",
      name: "MiniMax M2.7",
      description: "Current NVIDIA preview chat model",
    },
    {
      value: "qwen/qwen3-coder-480b-a35b-instruct",
      name: "Qwen3 Coder 480B",
      description: "Current NVIDIA preview coding model",
    },
    {
      value: "zai/glm-4.7",
      name: "GLM 4.7",
      description: "Current NVIDIA preview general-purpose model",
    },
    {
      value: "deepseek-ai/deepseek-v3.2",
      name: "DeepSeek V3.2",
      description: "Current NVIDIA preview reasoning/chat model",
    },
    {
      value: "mistralai/devstral-2-123b-instruct-2512",
      name: "Devstral 2 123B",
      description: "Current NVIDIA preview large instruct model",
    },
    {
      value: "moonshotai/kimi-k2-thinking",
      name: "Kimi K2 Thinking",
      description: "Current NVIDIA preview reasoning model",
    },
    {
      value: "mistralai/mistral-large-3-675b-instruct-2512",
      name: "Mistral Large 3 675B",
      description: "Current NVIDIA preview frontier instruct model",
    },
    {
      value: "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
      name: "Llama 3.1 Nemotron Safety Guard 8B v3",
      description: "Current NVIDIA preview safety model",
    },
    {
      value: "deepseek-ai/deepseek-v3.1-terminus",
      name: "DeepSeek V3.1 Terminus",
      description: "Current NVIDIA preview reasoning/chat model",
    },
    {
      value: "moonshotai/kimi-k2-instruct-0905",
      name: "Kimi K2 Instruct 0905",
      description: "Current NVIDIA preview instruct model",
    },
    {
      value: "speakleash/bielik-11b-v2.6-instruct",
      name: "Bielik 11B v2.6 Instruct",
      description: "Current NVIDIA preview instruct model",
    },
    {
      value: "bytedance/seed-oss-36b-instruct",
      name: "Seed OSS 36B Instruct",
      description: "Current NVIDIA preview instruct model",
    },
    {
      value: "deepseek-ai/deepseek-v3.1",
      name: "DeepSeek V3.1",
      description: "Current NVIDIA preview general-purpose model",
    },
  ],
};

/** Get models for a provider (claude-code maps to anthropic) */
export function getModelsForProvider(provider: string): ModelOption[] {
  const key = provider === "claude-code" ? "anthropic" : provider;
  return MODEL_OPTIONS[key] || [];
}

/** Get Groq STT models */
export function getGroqSttModels(): ModelOption[] {
  return GROQ_STT_MODELS;
}

/** Get Groq TTS models */
export function getGroqTtsModels(): ModelOption[] {
  return GROQ_TTS_MODELS;
}
