export type SupportedProvider =
  | "anthropic"
  | "codex"
  | "openai"
  | "google"
  | "xai"
  | "groq"
  | "openrouter"
  | "moonshot"
  | "mistral"
  | "cerebras"
  | "zai"
  | "minimax"
  | "huggingface"
  | "gocoon"
  | "local";

export interface ProviderMetadata {
  id: SupportedProvider;
  displayName: string;
  envVar: string;
  keyPrefix: string | null;
  keyHint: string;
  consoleUrl: string;
  defaultModel: string;
  utilityModel: string;
  toolLimit: number | null;
  piAiProvider: string;
}

const PROVIDER_REGISTRY: Record<SupportedProvider, ProviderMetadata> = {
  codex: {
    id: "codex",
    displayName: "Codex (Auto)",
    envVar: "OPENAI_API_KEY",
    keyPrefix: null,
    keyHint: "Auto-detected from Codex CLI",
    consoleUrl: "https://platform.openai.com/",
    defaultModel: "gpt-5.5",
    utilityModel: "gpt-5.4-mini",
    toolLimit: 128,
    piAiProvider: "openai-codex",
  },
  zai: {
    id: "zai",
    displayName: "ZAI (Zhipu)",
    envVar: "ZAI_API_KEY",
    keyPrefix: null,
    keyHint: "...",
    consoleUrl: "https://z.ai/manage-apikey/apikey-list",
    defaultModel: "glm-5.1",
    utilityModel: "glm-5-turbo",
    toolLimit: 128,
    piAiProvider: "zai",
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    keyHint: "sk-ant-api03-...",
    consoleUrl: "https://console.anthropic.com/",
    defaultModel: "claude-haiku-4-5-20251001",
    utilityModel: "claude-haiku-4-5-20251001",
    toolLimit: null,
    piAiProvider: "anthropic",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI (GPT-5.5)",
    envVar: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-proj-...",
    consoleUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5.5",
    utilityModel: "gpt-4o-mini",
    toolLimit: 128,
    piAiProvider: "openai",
  },
  google: {
    id: "google",
    displayName: "Google (Gemini)",
    envVar: "GOOGLE_API_KEY",
    keyPrefix: null,
    keyHint: "AIza...",
    consoleUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-flash",
    utilityModel: "gemini-2.5-flash-lite",
    toolLimit: 128,
    piAiProvider: "google",
  },
  xai: {
    id: "xai",
    displayName: "xAI (Grok)",
    envVar: "XAI_API_KEY",
    keyPrefix: "xai-",
    keyHint: "xai-...",
    consoleUrl: "https://console.x.ai/",
    defaultModel: "grok-4.3",
    utilityModel: "grok-4.20-0309-non-reasoning",
    toolLimit: 128,
    piAiProvider: "xai",
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    envVar: "GROQ_API_KEY",
    keyPrefix: "gsk_",
    keyHint: "gsk_...",
    consoleUrl: "https://console.groq.com/keys",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
    utilityModel: "llama-3.1-8b-instant",
    toolLimit: 128,
    piAiProvider: "groq",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    keyHint: "sk-or-v1-...",
    consoleUrl: "https://openrouter.ai/keys",
    defaultModel: "anthropic/claude-opus-4.7",
    utilityModel: "google/gemini-2.5-flash-lite",
    toolLimit: 128,
    piAiProvider: "openrouter",
  },
  moonshot: {
    id: "moonshot",
    displayName: "Moonshot (Kimi)",
    envVar: "MOONSHOT_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-...",
    consoleUrl: "https://platform.moonshot.ai/",
    defaultModel: "kimi-for-coding",
    utilityModel: "kimi-for-coding",
    toolLimit: 128,
    piAiProvider: "kimi-coding",
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral AI",
    envVar: "MISTRAL_API_KEY",
    keyPrefix: null,
    keyHint: "...",
    consoleUrl: "https://console.mistral.ai/api-keys",
    defaultModel: "devstral-2512",
    utilityModel: "ministral-8b-latest",
    toolLimit: 128,
    piAiProvider: "mistral",
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    envVar: "CEREBRAS_API_KEY",
    keyPrefix: "csk-",
    keyHint: "csk-...",
    consoleUrl: "https://cloud.cerebras.ai/",
    defaultModel: "qwen-3-235b-a22b-instruct-2507",
    utilityModel: "llama3.1-8b",
    toolLimit: 128,
    piAiProvider: "cerebras",
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax",
    envVar: "MINIMAX_API_KEY",
    keyPrefix: null,
    keyHint: "Save your key — shown only once!",
    consoleUrl: "https://platform.minimax.io/",
    defaultModel: "MiniMax-M2.7",
    utilityModel: "MiniMax-M2.7",
    toolLimit: 128,
    piAiProvider: "minimax",
  },
  huggingface: {
    id: "huggingface",
    displayName: "HuggingFace",
    envVar: "HF_TOKEN",
    keyPrefix: "hf_",
    keyHint: "hf_...",
    consoleUrl: "https://huggingface.co/settings/tokens",
    defaultModel: "deepseek-ai/DeepSeek-V4-Pro",
    utilityModel: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    toolLimit: 128,
    piAiProvider: "huggingface",
  },
  gocoon: {
    id: "gocoon",
    displayName: "Gocoon (Decentralized, TON)",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key needed — pays in TON",
    consoleUrl: "https://github.com/TONresistor/gocoon",
    defaultModel: "Qwen/Qwen3-32B",
    utilityModel: "Qwen/Qwen3-32B",
    toolLimit: 128,
    piAiProvider: "gocoon",
  },
  local: {
    id: "local",
    displayName: "Local (Ollama, vLLM, LM Studio...)",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key needed",
    consoleUrl: "",
    defaultModel: "auto",
    utilityModel: "auto",
    toolLimit: 128,
    piAiProvider: "local",
  },
};

export function getProviderMetadata(provider: SupportedProvider): ProviderMetadata {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return meta;
}

export function getSupportedProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_REGISTRY);
}

/**
 * Provider ids as a non-empty tuple, derived from the single registry so the
 * Zod `agent.provider` enum stays in sync with PROVIDER_REGISTRY (no 3rd copy).
 */
export const SUPPORTED_PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY) as [
  SupportedProvider,
  ...SupportedProvider[],
];

export function validateApiKeyFormat(provider: SupportedProvider, key: string): string | undefined {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) return `Unknown provider: ${provider}`;
  if (provider === "gocoon" || provider === "local" || provider === "codex") return undefined;
  if (!key || key.trim().length === 0) return "API key is required";
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return `Invalid format (should start with ${meta.keyPrefix})`;
  }
  return undefined;
}

export { PROVIDER_REGISTRY };
