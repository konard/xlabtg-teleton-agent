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
      value: "meta/llama-3.1-8b-instruct",
      name: "Llama 3.1 8B Instruct",
      description: "128K ctx, chat + tools + vision, FREE preview",
    },
    {
      value: "meta/llama-3.1-70b-instruct",
      name: "Llama 3.1 70B Instruct",
      description: "128K ctx, chat + tools, FREE preview",
    },
    {
      value: "meta/llama-3.1-405b-instruct",
      name: "Llama 3.1 405B Instruct",
      description: "128K ctx, frontier quality, FREE preview",
    },
    {
      value: "qwen/qwen-2.5-72b-instruct",
      name: "Qwen 2.5 72B Instruct",
      description: "128K ctx, chat + code + tools, FREE preview",
    },
    {
      value: "qwen/qwen-3-32b-instruct",
      name: "Qwen 3 32B Instruct",
      description: "256K ctx, chat + code + vision, FREE preview",
    },
    {
      value: "nvidia/nemotron-4-340b-instruct",
      name: "Nemotron 4 340B Instruct",
      description: "128K ctx, chat + reasoning, FREE preview",
    },
    {
      value: "mistralai/mistral-large-2411",
      name: "Mistral Large 2411",
      description: "128K ctx, chat + tools, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-v3",
      name: "DeepSeek V3",
      description: "128K ctx, chat + code + math, FREE preview",
    },
    {
      value: "google/gemma-2-27b-it",
      name: "Gemma 2 27B IT",
      description: "8K ctx, lightweight chat, FREE preview",
    },
    {
      value: "minimax/minimax-01",
      name: "MiniMax-01",
      description: "256K ctx, long-context chat, FREE preview",
    },
    {
      value: "meta/llama-3.1-405b-instruct-fp8",
      name: "Llama 3.1 405B Instruct FP8",
      description: "128K ctx, optimized frontier inference, FREE preview",
    },
    {
      value: "meta/llama-3.2-1b-instruct",
      name: "Llama 3.2 1B Instruct",
      description: "8K ctx, ultra-lightweight chat, FREE preview",
    },
    {
      value: "meta/llama-3.2-3b-instruct",
      name: "Llama 3.2 3B Instruct",
      description: "8K ctx, compact multilingual chat, FREE preview",
    },
    {
      value: "meta/llama-3.2-11b-vision-instruct",
      name: "Llama 3.2 11B Vision Instruct",
      description: "128K ctx, multimodal vision + chat, FREE preview",
    },
    {
      value: "meta/llama-3.2-90b-vision-instruct",
      name: "Llama 3.2 90B Vision Instruct",
      description: "128K ctx, large multimodal vision + chat, FREE preview",
    },
    {
      value: "meta/llama-3.3-70b-instruct",
      name: "Llama 3.3 70B Instruct",
      description: "128K ctx, updated general-purpose instruct, FREE preview",
    },
    {
      value: "meta/llama-3.3-70b-instruct-hf",
      name: "Llama 3.3 70B Instruct HF",
      description: "128K ctx, Hugging Face-compatible variant, FREE preview",
    },
    {
      value: "meta/llama-4-maverick-17b-128e-instruct",
      name: "Llama 4 Maverick 17B",
      description: "Large MoE reasoning/chat model, FREE preview",
    },
    {
      value: "meta/llama-4-scout-17b-16e-instruct",
      name: "Llama 4 Scout 17B",
      description: "Fast MoE general model, FREE preview",
    },
    {
      value: "microsoft/phi-3-mini-128k-instruct",
      name: "Phi-3 Mini 128K Instruct",
      description: "128K ctx, compact reasoning/chat, FREE preview",
    },
    {
      value: "microsoft/phi-3-medium-128k-instruct",
      name: "Phi-3 Medium 128K Instruct",
      description: "128K ctx, balanced reasoning/chat, FREE preview",
    },
    {
      value: "microsoft/phi-3.5-mini-instruct",
      name: "Phi-3.5 Mini Instruct",
      description: "Compact high-quality instruction model, FREE preview",
    },
    {
      value: "microsoft/phi-3.5-vision-instruct",
      name: "Phi-3.5 Vision Instruct",
      description: "Multimodal Phi model for text + images, FREE preview",
    },
    {
      value: "nvidia/llama-3.1-nemotron-51b-instruct",
      name: "Llama 3.1 Nemotron 51B",
      description: "NVIDIA-tuned reasoning/chat model, FREE preview",
    },
    {
      value: "nvidia/llama-3.3-nemotron-super-49b-v1",
      name: "Nemotron Super 49B",
      description: "High-quality NVIDIA instruct model, FREE preview",
    },
    {
      value: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      name: "Nemotron Super 49B v1.5",
      description: "Refined NVIDIA instruct model, FREE preview",
    },
    {
      value: "nvidia/llama-3.3-nemotron-super-49b-v1.5-fp8",
      name: "Nemotron Super 49B v1.5 FP8",
      description: "Optimized FP8 deployment variant, FREE preview",
    },
    {
      value: "nvidia/llama-3.3-nemotron-super-49b-v1.5-reasoning",
      name: "Nemotron Super 49B Reasoning",
      description: "Reasoning-optimized NVIDIA model, FREE preview",
    },
    {
      value: "nvidia/nemotron-3-super-49b-v1",
      name: "Nemotron 3 Super 49B",
      description: "Efficient large instruct model, FREE preview",
    },
    {
      value: "nvidia/nemotron-3-super-49b-v1.5",
      name: "Nemotron 3 Super 49B v1.5",
      description: "Improved efficiency/quality release, FREE preview",
    },
    {
      value: "nvidia/nemotron-3-super-120b-v1",
      name: "Nemotron 3 Super 120B",
      description: "Large-scale NVIDIA instruct model, FREE preview",
    },
    {
      value: "nvidia/nemotron-3-super-253b-v1",
      name: "Nemotron 3 Super 253B",
      description: "Top-tier NVIDIA MoE model, FREE preview",
    },
    {
      value: "nvidia/nemotron-nano-9b-v2",
      name: "Nemotron Nano 9B v2",
      description: "Fast lightweight agent model, FREE preview",
    },
    {
      value: "nvidia/nemotron-nano-12b-v2",
      name: "Nemotron Nano 12B v2",
      description: "Balanced compact chat model, FREE preview",
    },
    {
      value: "nvidia/nemotron-nano-12b-2-vl",
      name: "Nemotron Nano 12B VL",
      description: "Compact multimodal text+image model, FREE preview",
    },
    {
      value: "nvidia/nemotron-nano-30b-v1",
      name: "Nemotron Nano 30B",
      description: "Compact 30B instruct model, FREE preview",
    },
    {
      value: "nvidia/nemotron-nano-30b-a3b",
      name: "Nemotron Nano 30B A3B",
      description: "MoE compact agent model, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1",
      name: "DeepSeek R1",
      description: "Reasoning-focused open model, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1-distill-llama-70b",
      name: "DeepSeek R1 Distill Llama 70B",
      description: "Reasoning distilled into 70B class model, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1-distill-qwen-32b",
      name: "DeepSeek R1 Distill Qwen 32B",
      description: "Reasoning distilled into Qwen 32B, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1-distill-qwen-14b",
      name: "DeepSeek R1 Distill Qwen 14B",
      description: "Mid-size reasoning model, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1-distill-qwen-7b",
      name: "DeepSeek R1 Distill Qwen 7B",
      description: "Small reasoning model, FREE preview",
    },
    {
      value: "deepseek-ai/deepseek-r1-distill-qwen-1.5b",
      name: "DeepSeek R1 Distill Qwen 1.5B",
      description: "Tiny reasoning model for cheap experimentation, FREE preview",
    },
    {
      value: "google/codegemma-1.1-7b",
      name: "CodeGemma 1.1 7B",
      description: "Code-focused compact model, FREE preview",
    },
    {
      value: "google/gemma-2-2b-it",
      name: "Gemma 2 2B IT",
      description: "Small general-purpose instruct model, FREE preview",
    },
    {
      value: "google/gemma-2-9b-it",
      name: "Gemma 2 9B IT",
      description: "Balanced Gemma instruct model, FREE preview",
    },
    {
      value: "ibm/granite-3.0-8b-instruct",
      name: "Granite 3.0 8B Instruct",
      description: "IBM enterprise-focused instruct model, FREE preview",
    },
    {
      value: "ibm/granite-3.1-8b-instruct",
      name: "Granite 3.1 8B Instruct",
      description: "Updated Granite 8B release, FREE preview",
    },
    {
      value: "mistralai/codestral-22b-instruct-v0.1",
      name: "Codestral 22B Instruct",
      description: "Code generation and editing, FREE preview",
    },
    {
      value: "mistralai/mixtral-8x7b-instruct-v0.1",
      name: "Mixtral 8x7B Instruct",
      description: "MoE instruct classic, FREE preview",
    },
    {
      value: "mistralai/mistral-small-24b-instruct-2501",
      name: "Mistral Small 24B",
      description: "Balanced general-purpose chat model, FREE preview",
    },
    {
      value: "nv-mistralai/mistral-nemo-12b-instruct",
      name: "Mistral NeMo 12B Instruct",
      description: "Efficient multilingual/chat model, FREE preview",
    },
    {
      value: "qwen/qwen-2.5-7b-instruct",
      name: "Qwen 2.5 7B Instruct",
      description: "Compact Qwen instruct model, FREE preview",
    },
    {
      value: "qwen/qwen-2.5-coder-32b-instruct",
      name: "Qwen 2.5 Coder 32B",
      description: "Code-specialized Qwen model, FREE preview",
    },
    {
      value: "qwen/qwen-2.5-vl-72b-instruct",
      name: "Qwen 2.5 VL 72B Instruct",
      description: "Large multimodal text+vision model, FREE preview",
    },
    {
      value: "qwen/qwen-2.5-vl-7b-instruct",
      name: "Qwen 2.5 VL 7B Instruct",
      description: "Compact multimodal text+vision model, FREE preview",
    },
    {
      value: "qwen/qwen2.5-coder-7b-instruct",
      name: "Qwen 2.5 Coder 7B",
      description: "Fast compact coding model, FREE preview",
    },
    {
      value: "qwen/qwen3-235b-a22b-thinking-2507",
      name: "Qwen3 235B Thinking",
      description: "Large reasoning-oriented Qwen3 model, FREE preview",
    },
    {
      value: "qwen/qwen3-coder-480b-a35b-instruct",
      name: "Qwen3 Coder 480B",
      description: "Frontier coding model, FREE preview",
    },
    {
      value: "qwen/qwen3-next-80b-a3b-instruct",
      name: "Qwen3 Next 80B",
      description: "Large MoE chat model, FREE preview",
    },
    {
      value: "baai/bge-m3",
      name: "BGE-M3",
      description: "Embedding and retrieval model available on NIM",
    },
    {
      value: "nvidia/embed-qa-4",
      name: "NVIDIA Embed-QA-4",
      description: "Embedding model for retrieval and RAG workflows",
    },
    {
      value: "nvidia/rerank-qa-mistral-4b",
      name: "NVIDIA Rerank-QA Mistral 4B",
      description: "Reranker for retrieval pipelines",
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
