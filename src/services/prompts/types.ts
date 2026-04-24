export type PromptSectionId =
  | "persona"
  | "instructions"
  | "tool_usage"
  | "response_format"
  | "safety";

export interface PromptSectionDefinition {
  id: PromptSectionId;
  label: string;
  description: string;
  defaultHeading: string;
}

export const PROMPT_SECTIONS: PromptSectionDefinition[] = [
  {
    id: "persona",
    label: "Persona / role",
    description: "Base identity and behavioral stance, usually sourced from SOUL.md.",
    defaultHeading: "Persona",
  },
  {
    id: "instructions",
    label: "Instructions / guidelines",
    description: "General operating guidance injected after owner-configured files.",
    defaultHeading: "Instructions",
  },
  {
    id: "tool_usage",
    label: "Tool usage guidance",
    description: "Workspace and tool-selection rules.",
    defaultHeading: "Tool Usage",
  },
  {
    id: "response_format",
    label: "Response format rules",
    description: "Formatting, length, and final-response requirements.",
    defaultHeading: "Response Format",
  },
  {
    id: "safety",
    label: "Safety guardrails",
    description: "Confirmation, privacy, and irreversible-action rules.",
    defaultHeading: "Safety",
  },
];

export const PROMPT_SECTION_IDS = PROMPT_SECTIONS.map((section) => section.id);

export type PromptVariantSource = "manual" | "optimizer";

export interface PromptMetrics {
  interactions: number;
  positive: number;
  negative: number;
  averageRating: number | null;
  taskSuccessRate: number | null;
  responseQualityScore: number | null;
  averageTokenUsage: number | null;
  errorRate: number | null;
  lastUpdated: number | null;
}

export interface PromptMetricInput {
  rating?: number | null;
  taskSuccess?: boolean | null;
  responseQualityScore?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: boolean | null;
}

export interface PromptVariant {
  id: number;
  section: PromptSectionId;
  version: number;
  content: string;
  active: boolean;
  source: PromptVariantSource;
  metrics: PromptMetrics;
  createdAt: number;
  updatedAt: number;
}

export interface PromptSectionState extends PromptSectionDefinition {
  activeVariant: PromptVariant | null;
  variantCount: number;
}

export type PromptExperimentStatus = "draft" | "running" | "completed" | "cancelled";

export interface PromptExperimentMetrics {
  variants: Record<string, PromptMetrics>;
  scores: Record<string, number>;
  sampleCounts: Record<string, number>;
  significance: number | null;
  lastUpdated: number | null;
}

export interface PromptExperiment {
  id: number;
  section: PromptSectionId;
  name: string;
  controlVariantId: number;
  candidateVariantId: number;
  trafficPercentage: number;
  minSamples: number;
  autoPromote: boolean;
  status: PromptExperimentStatus;
  winnerVariantId: number | null;
  metrics: PromptExperimentMetrics;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface PromptVariantSelection {
  section: PromptSectionId;
  variant: PromptVariant;
  experiment: PromptExperiment | null;
}

export const EMPTY_PROMPT_METRICS: PromptMetrics = {
  interactions: 0,
  positive: 0,
  negative: 0,
  averageRating: null,
  taskSuccessRate: null,
  responseQualityScore: null,
  averageTokenUsage: null,
  errorRate: null,
  lastUpdated: null,
};

export function assertPromptSection(section: string): asserts section is PromptSectionId {
  if (!PROMPT_SECTION_IDS.includes(section as PromptSectionId)) {
    throw new Error(`Invalid prompt section: ${section}`);
  }
}

export function emptyMetrics(): PromptMetrics {
  return { ...EMPTY_PROMPT_METRICS };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(current: number | null, countBefore: number, value: number): number {
  if (current === null || countBefore <= 0) return value;
  return (current * countBefore + value) / (countBefore + 1);
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parsePromptMetrics(raw: string | null | undefined): PromptMetrics {
  const parsed = parseJsonObject(raw);
  return {
    interactions:
      typeof parsed.interactions === "number" && Number.isFinite(parsed.interactions)
        ? Math.max(0, Math.floor(parsed.interactions))
        : 0,
    positive:
      typeof parsed.positive === "number" && Number.isFinite(parsed.positive)
        ? Math.max(0, Math.floor(parsed.positive))
        : 0,
    negative:
      typeof parsed.negative === "number" && Number.isFinite(parsed.negative)
        ? Math.max(0, Math.floor(parsed.negative))
        : 0,
    averageRating: numberOrNull(parsed.averageRating),
    taskSuccessRate: numberOrNull(parsed.taskSuccessRate),
    responseQualityScore: numberOrNull(parsed.responseQualityScore),
    averageTokenUsage: numberOrNull(parsed.averageTokenUsage),
    errorRate: numberOrNull(parsed.errorRate),
    lastUpdated: numberOrNull(parsed.lastUpdated),
  };
}

export function updatePromptMetrics(
  metrics: PromptMetrics,
  input: PromptMetricInput,
  timestamp = Math.floor(Date.now() / 1000)
): PromptMetrics {
  const countBefore = metrics.interactions;
  const countAfter = countBefore + 1;
  const rating =
    input.rating !== null && input.rating !== undefined && Number.isFinite(input.rating)
      ? Math.max(1, Math.min(5, input.rating))
      : null;
  const tokenUsage =
    (input.inputTokens ?? null) !== null || (input.outputTokens ?? null) !== null
      ? Math.max(0, input.inputTokens ?? 0) + Math.max(0, input.outputTokens ?? 0)
      : null;

  return {
    interactions: countAfter,
    positive: metrics.positive + (rating !== null && rating >= 4 ? 1 : 0),
    negative:
      metrics.negative + (rating !== null && rating <= 2 ? 1 : 0) + (input.error === true ? 1 : 0),
    averageRating:
      rating === null ? metrics.averageRating : average(metrics.averageRating, countBefore, rating),
    taskSuccessRate:
      input.taskSuccess === null || input.taskSuccess === undefined
        ? metrics.taskSuccessRate
        : average(metrics.taskSuccessRate, countBefore, input.taskSuccess ? 1 : 0),
    responseQualityScore:
      input.responseQualityScore === null || input.responseQualityScore === undefined
        ? metrics.responseQualityScore
        : average(metrics.responseQualityScore, countBefore, clamp01(input.responseQualityScore)),
    averageTokenUsage:
      tokenUsage === null
        ? metrics.averageTokenUsage
        : average(metrics.averageTokenUsage, countBefore, tokenUsage),
    errorRate:
      input.error === null || input.error === undefined
        ? metrics.errorRate
        : average(metrics.errorRate, countBefore, input.error ? 1 : 0),
    lastUpdated: timestamp,
  };
}

export function scorePromptMetrics(metrics: PromptMetrics): number {
  if (metrics.interactions <= 0) return 0.5;

  const parts = [
    metrics.averageRating === null ? null : clamp01(metrics.averageRating / 5),
    metrics.taskSuccessRate,
    metrics.responseQualityScore,
    metrics.averageTokenUsage === null ? null : 1 / (1 + metrics.averageTokenUsage / 1000),
    metrics.errorRate === null ? null : 1 - clamp01(metrics.errorRate),
  ].filter((value): value is number => value !== null);

  if (parts.length === 0) return 0.5;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

export function emptyExperimentMetrics(): PromptExperimentMetrics {
  return {
    variants: {},
    scores: {},
    sampleCounts: {},
    significance: null,
    lastUpdated: null,
  };
}

export function parseExperimentMetrics(raw: string | null | undefined): PromptExperimentMetrics {
  const parsed = parseJsonObject(raw);
  const variants: Record<string, PromptMetrics> = {};
  const rawVariants =
    parsed.variants && typeof parsed.variants === "object" && !Array.isArray(parsed.variants)
      ? (parsed.variants as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(rawVariants)) {
    variants[key] = parsePromptMetrics(JSON.stringify(value));
  }

  const scores =
    parsed.scores && typeof parsed.scores === "object" && !Array.isArray(parsed.scores)
      ? Object.fromEntries(
          Object.entries(parsed.scores as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1])
          )
        )
      : {};
  const sampleCounts =
    parsed.sampleCounts &&
    typeof parsed.sampleCounts === "object" &&
    !Array.isArray(parsed.sampleCounts)
      ? Object.fromEntries(
          Object.entries(parsed.sampleCounts as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1])
          )
        )
      : {};

  return {
    variants,
    scores,
    sampleCounts,
    significance: numberOrNull(parsed.significance),
    lastUpdated: numberOrNull(parsed.lastUpdated),
  };
}
