import { complete, type Context } from "@mariozechner/pi-ai";
import type { Config } from "../../config/schema.js";
import type { SupportedProvider } from "../../config/providers.js";
import { LLM_REQUEST_TIMEOUT_MS } from "../../constants/timeouts.js";
import { getEffectiveApiKey, getUtilityModel } from "../client.js";
import type { OutputEvaluation, ReflectionPlan, ReflectionResult } from "./types.js";

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function parseReflectionPlan(raw: string, evaluation: OutputEvaluation): ReflectionPlan {
  const payload = extractJson(raw);
  if (!payload) {
    return {
      summary: evaluation.feedback,
      instructions: evaluation.issues.length > 0 ? evaluation.issues : [evaluation.feedback],
      focusAreas: Object.entries(evaluation.criteria)
        .filter(([, score]) => score < 0.7)
        .map(([key]) => key),
    };
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : evaluation.feedback,
      instructions: parseStringArray(parsed.instructions),
      focusAreas: parseStringArray(parsed.focusAreas ?? parsed.focus_areas),
    };
  } catch {
    return {
      summary: evaluation.feedback,
      instructions: evaluation.issues.length > 0 ? evaluation.issues : [evaluation.feedback],
      focusAreas: [],
    };
  }
}

export async function reflectOnOutput(params: {
  config: Config;
  userMessage: string;
  output: string;
  evaluation: OutputEvaluation;
}): Promise<ReflectionResult> {
  const provider = (params.config.agent.provider || "anthropic") as SupportedProvider;
  const model = getUtilityModel(
    provider,
    params.config.self_correction.model ?? params.config.agent.utility_model
  );
  const context: Context = {
    messages: [
      {
        role: "user",
        content: `Create a correction plan for improving the assistant response.

Return JSON only:
{
  "summary": string,
  "instructions": string[],
  "focusAreas": string[]
}

User request:
${params.userMessage}

Assistant response:
${params.output}

Evaluation:
${JSON.stringify(params.evaluation, null, 2)}`,
        timestamp: Date.now(),
      },
    ],
  };

  const response = await complete(model, context, {
    apiKey: getEffectiveApiKey(provider, params.config.agent.api_key),
    maxTokens: 700,
    temperature: 0,
    signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
  });
  const text = response.content.find((block) => block.type === "text");
  const rawText = text?.type === "text" ? text.text : "";

  return {
    reflection: parseReflectionPlan(rawText, params.evaluation),
    rawText,
    usage: response.usage,
  };
}

export function buildCorrectionPrompt(params: {
  userMessage: string;
  originalOutput: string;
  evaluation: OutputEvaluation;
  reflection: ReflectionPlan;
}): string {
  const instructions =
    params.reflection.instructions.length > 0
      ? params.reflection.instructions.map((item) => `- ${item}`).join("\n")
      : `- ${params.evaluation.feedback}`;

  return `Self-correction required before responding to the user.

Original user request:
${params.userMessage}

Previous assistant response:
${params.originalOutput}

Evaluation feedback:
${params.evaluation.feedback}

Correction plan:
${params.reflection.summary}

Instructions:
${instructions}

Write the corrected final response only. Do not mention this evaluation step unless the user explicitly asked about it.`;
}
