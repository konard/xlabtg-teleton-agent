/**
 * Groq Text Provider — Direct Native Integration
 *
 * Provides direct access to Groq's chat completions API without
 * going through the @mariozechner/pi-ai abstraction layer.
 *
 * Used for:
 * - Testing API keys
 * - Fetching dynamic model lists from the Groq API
 * - Future: streaming support
 */

import { createLogger } from "../../utils/logger.js";
import { withGroqRateLimit, parseGroqErrorType } from "./rateLimiter.js";
import { GROQ_API_BASE } from "./GroqSTTProvider.js";

const log = createLogger("GroqText");

const SECRET_PATTERN = /(sk-|gsk_|Bearer )\S+/g;
const MAX_ERROR_BODY_LENGTH = 200;

function sanitizeErrorBody(body: string): string {
  const truncated =
    body.length > MAX_ERROR_BODY_LENGTH ? body.slice(0, MAX_ERROR_BODY_LENGTH) + "…" : body;
  return truncated.replace(SECRET_PATTERN, "[REDACTED]");
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqCompletionOptions {
  apiKey: string;
  model?: string;
  messages: GroqMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface GroqCompletionResult {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Call Groq chat completions endpoint directly (no pi-ai abstraction).
 */
export async function groqComplete(options: GroqCompletionOptions): Promise<GroqCompletionResult> {
  const { apiKey, model = "llama-3.3-70b-versatile", messages, maxTokens, temperature } = options;

  if (!apiKey) {
    throw new Error("Groq API key is required");
  }

  return withGroqRateLimit(async () => {
    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (maxTokens != null) body.max_tokens = maxTokens;
    if (temperature != null) body.temperature = temperature;

    const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorType = parseGroqErrorType(response.status);
      const rawBody = await response.text().catch(() => "");
      const msg = `Groq API error (${response.status} ${errorType}): ${sanitizeErrorBody(rawBody)}`;
      log.error(msg);
      throw new Error(msg);
    }

    const result = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = result.choices[0];
    return {
      id: result.id,
      model: result.model,
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? "stop",
      usage: {
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      },
    };
  });
}

export interface GroqModelListEntry {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  active: boolean;
  context_window: number;
}

/**
 * List available models from the Groq API dynamically.
 */
export async function groqListModels(apiKey: string): Promise<GroqModelListEntry[]> {
  if (!apiKey) {
    throw new Error("Groq API key is required");
  }

  const response = await fetch(`${GROQ_API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorType = parseGroqErrorType(response.status);
    const rawBody = await response.text().catch(() => "");
    throw new Error(
      `Groq models list error (${response.status} ${errorType}): ${sanitizeErrorBody(rawBody)}`
    );
  }

  const result = (await response.json()) as { data: GroqModelListEntry[] };
  log.debug(`Fetched ${result.data.length} models from Groq API`);
  return result.data;
}

/**
 * Structured result from API key test, including HTTP status and user hint.
 */
export interface GroqKeyTestResult {
  /** true if key is valid */
  valid: boolean;
  /** Error message on failure, null on success */
  error: string | null;
  /** HTTP status code from Groq API (null on success) */
  statusCode: number | null;
  /** Human-readable hint for the specific error type */
  hint: string | null;
}

/**
 * Test a Groq API key by calling GET /models.
 * Returns a structured result with HTTP status and hint for error differentiation.
 * Using /models avoids 422 errors caused by invalid model or body schema issues.
 *
 * Error differentiation:
 * - 401: Invalid API key
 * - 403: Access denied — geo-restriction, plan limitation, or preview model access
 * - 429: Rate limit exceeded
 * - 422: Bad request schema (should not happen with GET /models)
 * - 5xx: Groq server error
 */
export async function testGroqApiKey(apiKey: string): Promise<GroqKeyTestResult> {
  if (!apiKey) {
    return {
      valid: false,
      error: "No API key provided",
      statusCode: null,
      hint: "Provide a Groq API key (starts with gsk_)",
    };
  }

  const response = await fetch(`${GROQ_API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }).catch((err: unknown) => {
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  });

  if (response.ok) {
    return { valid: true, error: null, statusCode: null, hint: null };
  }

  const statusCode = response.status;
  const rawBody = await response.text().catch(() => "");
  const errorType = parseGroqErrorType(statusCode);

  const hints: Record<number, string> = {
    401: "Invalid API key. Check that your key starts with gsk_ and is correct.",
    403: "Access denied. This may be due to geo-restrictions in your region, a plan limitation, or a preview/beta model. Try a production model like llama-3.3-70b-versatile. If geo-restrictions apply, consider using the groq-mcp-server via MCP (see mcp.servers.groq in config.example.yaml). See https://console.groq.com/docs/models for available models.",
    422: "Request schema error. This should not occur with GET /models — please report this.",
    429: "Rate limit exceeded. Wait a moment and try again. Free plan has limited quotas.",
  };
  const hint =
    hints[statusCode] ?? (statusCode >= 500 ? "Groq server error. Try again later." : null);

  const msg = `Groq API error (${statusCode} ${errorType}): ${sanitizeErrorBody(rawBody)}`;
  log.warn(`Key test failed: ${msg}`);

  return { valid: false, error: msg, statusCode, hint };
}
