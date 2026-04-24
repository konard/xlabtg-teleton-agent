import { complete, type Context } from "@mariozechner/pi-ai";
import type { Config } from "../../config/schema.js";
import type { SupportedProvider } from "../../config/providers.js";
import { LLM_REQUEST_TIMEOUT_MS } from "../../constants/timeouts.js";
import { getEffectiveApiKey, getUtilityModel } from "../client.js";
import type { EvaluationResult, OutputEvaluation } from "./types.js";

const DEFAULT_CRITERIA = {
  completeness: 0.5,
  correctness: 0.5,
  toolUsage: 0.5,
  formatting: 0.5,
};

function clampScore(value: unknown, fallback = 0.5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function extractJsonPayload(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

export function parseEvaluationResult(raw: string): OutputEvaluation {
  const payload = extractJsonPayload(raw);
  if (!payload) {
    return {
      score: 0.5,
      feedback: raw.trim() || "Evaluator did not return structured feedback.",
      criteria: { ...DEFAULT_CRITERIA },
      issues: raw.trim() ? [raw.trim()] : ["Unstructured evaluator output"],
      needsCorrection: true,
    };
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const criteria = (parsed.criteria ?? {}) as Record<string, unknown>;
    const score = clampScore(parsed.score);
    return {
      score,
      feedback:
        typeof parsed.feedback === "string" && parsed.feedback.trim()
          ? parsed.feedback.trim()
          : "No feedback provided.",
      criteria: {
        completeness: clampScore(criteria.completeness),
        correctness: clampScore(criteria.correctness),
        toolUsage: clampScore(criteria.toolUsage ?? criteria.tool_usage),
        formatting: clampScore(criteria.formatting),
      },
      issues: normalizeStringArray(parsed.issues),
      needsCorrection:
        typeof parsed.needsCorrection === "boolean"
          ? parsed.needsCorrection
          : typeof parsed.needs_correction === "boolean"
            ? parsed.needs_correction
            : score < 0.7,
    };
  } catch {
    return {
      score: 0.5,
      feedback: raw.trim() || "Evaluator returned invalid JSON.",
      criteria: { ...DEFAULT_CRITERIA },
      issues: ["Invalid evaluator JSON"],
      needsCorrection: true,
    };
  }
}

function summarizeToolData(
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  toolResults: Array<{ toolName: string; result: { success: boolean; error?: string } }>
): string {
  if (toolCalls.length === 0 && toolResults.length === 0) return "No tools were used.";

  const calls = toolCalls.map((call) => `- ${call.name}: ${JSON.stringify(call.input)}`);
  const results = toolResults.map(
    (item) =>
      `- ${item.toolName}: ${item.result.success ? "success" : `failed (${item.result.error ?? "unknown error"})`}`
  );
  return [`Tool calls:`, ...calls, `Tool results:`, ...results].join("\n").slice(0, 6000);
}

export async function evaluateOutput(params: {
  config: Config;
  userMessage: string;
  output: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  toolResults: Array<{ toolName: string; result: { success: boolean; error?: string } }>;
}): Promise<EvaluationResult> {
  const provider = (params.config.agent.provider || "anthropic") as SupportedProvider;
  const model = getUtilityModel(
    provider,
    params.config.self_correction.model ?? params.config.agent.utility_model
  );
  const context: Context = {
    messages: [
      {
        role: "user",
        content: `Evaluate the assistant response for quality.

Return JSON only with this exact shape:
{
  "score": number,
  "feedback": string,
  "criteria": {
    "completeness": number,
    "correctness": number,
    "toolUsage": number,
    "formatting": number
  },
  "issues": string[],
  "needsCorrection": boolean
}

Score each field from 0.0 to 1.0. Be strict about missing requirements, fabricated facts, bad tool use, or broken formatting.

User request:
${params.userMessage}

${summarizeToolData(params.toolCalls, params.toolResults)}

Assistant response:
${params.output}`,
        timestamp: Date.now(),
      },
    ],
  };

  const response = await complete(model, context, {
    apiKey: getEffectiveApiKey(provider, params.config.agent.api_key),
    maxTokens: 900,
    temperature: 0,
    signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
  });
  const text = response.content.find((block) => block.type === "text");
  const rawText = text?.type === "text" ? text.text : "";

  return {
    evaluation: parseEvaluationResult(rawText),
    rawText,
    usage: response.usage,
  };
}
