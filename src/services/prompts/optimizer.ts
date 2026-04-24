import type { FeedbackTheme } from "../feedback/analyzer.js";
import { scorePromptMetrics, type PromptSectionId, type PromptVariant } from "./types.js";
import type { PromptVariantManager } from "./variant-manager.js";

export interface PromptOptimizationValidation {
  passed: boolean;
  issues: string[];
}

export interface PromptOptimizationSuggestion {
  section: PromptSectionId;
  baseVariant: PromptVariant | null;
  content: string;
  rationale: string[];
  validation: PromptOptimizationValidation;
  createdVariant: PromptVariant | null;
}

const THEME_GUIDANCE: Record<string, string> = {
  too_verbose: "Keep responses concise and remove details that do not change the user's next step.",
  too_brief: "Include enough context, assumptions, and verification detail for non-trivial tasks.",
  incorrect: "Double-check factual claims and reconcile conflicting evidence before answering.",
  unclear: "State assumptions explicitly and separate conclusions from uncertainty.",
  code_quality:
    "For code work, prefer runnable examples and include relevant verification commands.",
  tool_selection:
    "Prefer the most specific available tool and verify tool results before relying on them.",
  tone: "Match the user's communication style while staying direct and precise.",
};

const SECTION_BASELINE: Record<PromptSectionId, string> = {
  persona: "Preserve the agent's identity while making expectations measurable and easy to follow.",
  instructions:
    "Clarify the operating procedure for planning, tool use, verification, and concise reporting.",
  tool_usage:
    "Choose tools by task fit, check outputs before acting on them, and avoid unnecessary calls.",
  response_format:
    "Keep responses readable, concise, and explicit about results, assumptions, and next steps.",
  safety:
    "Preserve owner privacy and require confirmation before external or irreversible actions.",
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function validateContent(section: PromptSectionId, content: string): PromptOptimizationValidation {
  const issues: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) issues.push("Generated content is empty");
  if (Buffer.byteLength(trimmed, "utf-8") > 1024 * 1024) {
    issues.push("Generated content exceeds 1MB limit");
  }
  if (section === "safety") {
    const lowered = trimmed.toLowerCase();
    if (!lowered.includes("confirm") && !lowered.includes("permission")) {
      issues.push("Safety variants must preserve confirmation or permission language");
    }
    if (!lowered.includes("private") && !lowered.includes("privacy")) {
      issues.push("Safety variants must preserve privacy language");
    }
  }
  return { passed: issues.length === 0, issues };
}

export class PromptOptimizer {
  private variants: PromptVariantManager;

  constructor(variants: PromptVariantManager) {
    this.variants = variants;
  }

  suggestImprovement(input: {
    section: PromptSectionId;
    baseVariantId?: number;
    feedbackThemes?: FeedbackTheme[];
    evaluationIssues?: string[];
    createVariant?: boolean;
  }): PromptOptimizationSuggestion {
    const baseVariant =
      input.baseVariantId !== undefined
        ? this.variants.getVariant(input.baseVariantId)
        : this.variants.getActiveVariant(input.section);
    if (input.baseVariantId !== undefined && !baseVariant) {
      throw new Error("Base prompt variant not found");
    }

    const baseContent = baseVariant?.content.trim() || SECTION_BASELINE[input.section];
    const rationale: string[] = [];
    const guidance: string[] = [];
    const metrics = baseVariant?.metrics;

    if (metrics) {
      const score = scorePromptMetrics(metrics);
      if (score < 0.7) {
        rationale.push(`Current variant score is ${Math.round(score * 100)}%.`);
      }
      if (metrics.averageRating !== null && metrics.averageRating < 3.5) {
        guidance.push("Address low satisfaction by making success criteria explicit.");
      }
      if (metrics.taskSuccessRate !== null && metrics.taskSuccessRate < 0.75) {
        guidance.push(
          "Before answering, verify that the response fully resolves the user's request."
        );
      }
      if (metrics.errorRate !== null && metrics.errorRate > 0.1) {
        guidance.push(
          "Treat tool errors and uncertainty as first-class signals to explain or recover from."
        );
      }
      if (metrics.averageTokenUsage !== null && metrics.averageTokenUsage > 2500) {
        guidance.push("Prefer the shortest complete answer that preserves correctness.");
      }
    }

    for (const theme of input.feedbackThemes ?? []) {
      if (theme.negative <= theme.positive) continue;
      const line = THEME_GUIDANCE[theme.theme];
      if (line) {
        rationale.push(`${theme.label} has ${theme.negative} negative signal(s).`);
        guidance.push(line);
      }
    }

    for (const issue of input.evaluationIssues ?? []) {
      const trimmed = issue.trim();
      if (!trimmed) continue;
      rationale.push(`Evaluation issue: ${trimmed}`);
      guidance.push(`Avoid recurring issue: ${trimmed}`);
    }

    const uniqueGuidance = unique(guidance);
    if (uniqueGuidance.length === 0) {
      uniqueGuidance.push(SECTION_BASELINE[input.section]);
      rationale.push(
        "No recurring negative signal was found; suggested variant makes intent explicit."
      );
    }

    const content = [
      baseContent,
      "",
      "## Adaptive Improvement Notes",
      ...uniqueGuidance.map((line) => `- ${line}`),
    ].join("\n");
    const validation = validateContent(input.section, content);
    const createdVariant =
      input.createVariant === true && validation.passed
        ? this.variants.createVariant({
            section: input.section,
            content,
            source: "optimizer",
          })
        : null;

    return {
      section: input.section,
      baseVariant,
      content,
      rationale: unique(rationale),
      validation,
      createdVariant,
    };
  }
}
