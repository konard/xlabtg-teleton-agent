import { complete, type Context, type Model, type Api } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../config/schema.js";
import type { SupportedProvider } from "../config/providers.js";
import { getUtilityModel, getEffectiveApiKey } from "../agent/client.js";
import { createLogger } from "../utils/logger.js";
import type {
  TaskStrategy,
  TaskPriority,
  TaskConstraints,
} from "../memory/agent/autonomous-tasks.js";

const log = createLogger("GoalParser");

const PARSE_GOAL_MAX_TOKENS = 1024;

export interface ParsedGoal {
  goal: string;
  successCriteria: string[];
  failureConditions: string[];
  constraints: TaskConstraints;
  suggestedStrategy: TaskStrategy;
  suggestedPriority: TaskPriority;
  confidence: number;
}

const VALID_STRATEGIES: TaskStrategy[] = ["conservative", "balanced", "aggressive"];
const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

const SYSTEM_PROMPT = `You are an expert assistant that converts free-form natural language descriptions into structured autonomous-task specifications for the Teleton Agent.

Your single job is to return a JSON object that matches exactly this TypeScript shape:

{
  "goal": string,                    // concise, actionable one-sentence goal (imperative form)
  "successCriteria": string[],       // measurable conditions that mark the task as successful
  "failureConditions": string[],     // conditions that should abort the task
  "constraints": {
    "maxIterations"?: number,        // 10–200, only if user implied a bound; default 50 if unsure
    "maxDurationHours"?: number,     // only when user mentions time windows
    "budgetTON"?: number             // only when user mentions on-chain transactions / TON
  },
  "suggestedStrategy": "conservative" | "balanced" | "aggressive",
  "suggestedPriority": "low" | "medium" | "high" | "critical",
  "confidence": number               // 0.0–1.0: how confident you are that the extraction is correct
}

Rules:
- Preserve the user's original language (if they wrote in Russian, keep criteria in Russian).
- "goal" must be specific and actionable, not a vague restatement.
- "successCriteria" must contain at least one measurable item.
- If the user did not specify a field, omit it from "constraints" rather than inventing numbers.
- Prefer "balanced" strategy and "medium" priority unless the user hints otherwise
  (e.g. "carefully" → conservative, "urgent" / "asap" → high priority).
- Return RAW JSON only. No markdown fences, no commentary, no trailing text.
- If the input is too short or ambiguous to parse confidently, still return best-effort
  JSON with confidence below 0.5.`;

function buildPrompt(naturalLanguage: string): string {
  return `Parse the following task description into the JSON schema described in the system prompt.

User description:
"""
${naturalLanguage.trim()}
"""

Return the JSON now:`;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }
  return candidate.slice(firstBrace, lastBrace + 1);
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function coerceConstraints(value: unknown): TaskConstraints {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const result: TaskConstraints = {};

  if (typeof raw.maxIterations === "number" && Number.isFinite(raw.maxIterations)) {
    result.maxIterations = Math.max(1, Math.round(raw.maxIterations));
  }
  if (typeof raw.maxDurationHours === "number" && Number.isFinite(raw.maxDurationHours)) {
    result.maxDurationHours = Math.max(0, raw.maxDurationHours);
  }
  if (typeof raw.budgetTON === "number" && Number.isFinite(raw.budgetTON)) {
    result.budgetTON = Math.max(0, raw.budgetTON);
  }
  const allowed = coerceStringArray(raw.allowedTools);
  if (allowed.length > 0) result.allowedTools = allowed;
  const restricted = coerceStringArray(raw.restrictedTools);
  if (restricted.length > 0) result.restrictedTools = restricted;

  return result;
}

function coerceStrategy(value: unknown): TaskStrategy {
  if (typeof value === "string") {
    const lower = value.toLowerCase() as TaskStrategy;
    if (VALID_STRATEGIES.includes(lower)) return lower;
  }
  return "balanced";
}

function coercePriority(value: unknown): TaskPriority {
  if (typeof value === "string") {
    const lower = value.toLowerCase() as TaskPriority;
    if (VALID_PRIORITIES.includes(lower)) return lower;
  }
  return "medium";
}

function coerceConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function parseLLMResponse(raw: string, fallbackGoal: string): ParsedGoal {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error("AI did not return a JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI returned invalid JSON: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  const goal =
    typeof obj.goal === "string" && obj.goal.trim().length > 0
      ? obj.goal.trim()
      : fallbackGoal.trim();

  return {
    goal,
    successCriteria: coerceStringArray(obj.successCriteria),
    failureConditions: coerceStringArray(obj.failureConditions),
    constraints: coerceConstraints(obj.constraints),
    suggestedStrategy: coerceStrategy(obj.suggestedStrategy),
    suggestedPriority: coercePriority(obj.suggestedPriority),
    confidence: coerceConfidence(obj.confidence),
  };
}

/**
 * Ask the configured utility LLM to turn free-form user input into a structured
 * autonomous-task spec. Throws if the provider has no usable credentials or the
 * model response cannot be parsed into JSON.
 */
export async function parseGoalFromNaturalLanguage(
  naturalLanguage: string,
  agentConfig: AgentConfig,
  overrides?: {
    complete?: typeof complete;
    getUtilityModel?: (provider: SupportedProvider, utilityModel?: string) => Model<Api>;
  }
): Promise<ParsedGoal> {
  const input = naturalLanguage.trim();
  if (!input) {
    throw new Error("naturalLanguage is required");
  }

  const provider = (agentConfig.provider || "anthropic") as SupportedProvider;
  const modelFactory = overrides?.getUtilityModel ?? getUtilityModel;
  const model = modelFactory(provider, agentConfig.utility_model);
  const apiKey = getEffectiveApiKey(provider, agentConfig.api_key);

  if (!apiKey && provider !== "local" && provider !== "cocoon") {
    throw new Error(
      `Cannot parse goal: no API key configured for provider "${provider}". Set it in Settings → LLM.`
    );
  }

  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildPrompt(input),
        timestamp: Date.now(),
      },
    ],
  };

  const completeFn = overrides?.complete ?? complete;

  let responseText = "";
  try {
    const response = await completeFn(model, context, {
      apiKey,
      maxTokens: PARSE_GOAL_MAX_TOKENS,
      temperature: 0,
    });
    const textBlock = response.content.find((block) => block.type === "text");
    responseText = textBlock?.type === "text" ? textBlock.text : "";
  } catch (err) {
    log.warn({ err }, "Goal parsing LLM call failed");
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM call failed: ${msg}`);
  }

  if (!responseText.trim()) {
    throw new Error("AI returned an empty response");
  }

  return parseLLMResponse(responseText, input);
}
