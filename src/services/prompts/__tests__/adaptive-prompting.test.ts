import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { PromptABTesting } from "../ab-testing.js";
import { PromptContextAdapter } from "../context-adapter.js";
import { PromptOptimizer } from "../optimizer.js";
import { PromptVariantManager } from "../variant-manager.js";

describe("adaptive prompting services", () => {
  let db: Database.Database;
  let variants: PromptVariantManager;

  beforeEach(() => {
    db = new Database(":memory:");
    variants = new PromptVariantManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it("keeps exactly one active variant per prompt section", () => {
    const first = variants.createVariant({
      section: "persona",
      content: "You are direct.",
      activate: true,
    });
    const second = variants.createVariant({
      section: "persona",
      content: "You are concise.",
      activate: true,
    });

    expect(variants.getVariant(first.id)?.active).toBe(false);
    expect(variants.getVariant(second.id)?.active).toBe(true);
    expect(variants.getActiveVariant("persona")?.id).toBe(second.id);
  });

  it("assigns A/B experiment traffic deterministically and records outcomes", () => {
    const control = variants.createVariant({
      section: "response_format",
      content: "Keep replies short.",
      activate: true,
    });
    const candidate = variants.createVariant({
      section: "response_format",
      content: "Use concise, actionable replies.",
    });
    const testing = new PromptABTesting(db, variants);
    const experiment = testing.createExperiment({
      section: "response_format",
      name: "Response format copy",
      controlVariantId: control.id,
      candidateVariantId: candidate.id,
      trafficPercentage: 50,
      minSamples: 2,
      autoPromote: true,
    });
    testing.startExperiment(experiment.id);

    const first = testing.selectVariant({
      section: "response_format",
      subjectKey: "chat-1",
    });
    const second = testing.selectVariant({
      section: "response_format",
      subjectKey: "chat-1",
    });

    expect(first.variant.id).toBe(second.variant.id);
    expect(first.experiment?.id).toBe(experiment.id);

    testing.recordOutcome({
      experimentId: experiment.id,
      variantId: control.id,
      rating: 2,
      taskSuccess: false,
      responseQualityScore: 0.3,
      error: true,
      inputTokens: 900,
      outputTokens: 200,
    });
    testing.recordOutcome({
      experimentId: experiment.id,
      variantId: control.id,
      rating: 2,
      taskSuccess: false,
      responseQualityScore: 0.35,
      error: false,
      inputTokens: 850,
      outputTokens: 220,
    });
    testing.recordOutcome({
      experimentId: experiment.id,
      variantId: candidate.id,
      rating: 5,
      taskSuccess: true,
      responseQualityScore: 0.9,
      error: false,
      inputTokens: 600,
      outputTokens: 120,
    });
    const updated = testing.recordOutcome({
      experimentId: experiment.id,
      variantId: candidate.id,
      rating: 5,
      taskSuccess: true,
      responseQualityScore: 0.95,
      error: false,
      inputTokens: 580,
      outputTokens: 110,
    });

    expect(updated.status).toBe("completed");
    expect(updated.winnerVariantId).toBe(candidate.id);
    expect(variants.getActiveVariant("response_format")?.id).toBe(candidate.id);
  });

  it("renders context-adaptive template variables without replacing unknown tokens", () => {
    const adapter = new PromptContextAdapter({
      userPreferenceStyle: "direct",
      currentContext: "debugging a failed job",
      activeTools: ["memory_read", "workspace_read"],
      timeOfDay: "morning",
      feedbackPreferences: "Keep answers concise.",
    });

    expect(
      adapter.render(
        "Style: {user_preference_style}. Context: {current_context}. Tools: {active_tools}. Keep {unknown_token}."
      )
    ).toBe(
      "Style: direct. Context: debugging a failed job. Tools: memory_read, workspace_read. Keep {unknown_token}."
    );
  });

  it("builds a conservative optimization suggestion from weak metrics and feedback themes", () => {
    const current = variants.createVariant({
      section: "instructions",
      content: "Answer the user.",
      activate: true,
    });
    variants.recordMetrics(current.id, {
      rating: 2,
      taskSuccess: false,
      responseQualityScore: 0.4,
      error: true,
      inputTokens: 1000,
      outputTokens: 500,
    });

    const suggestion = new PromptOptimizer(variants).suggestImprovement({
      section: "instructions",
      feedbackThemes: [
        {
          theme: "tool_selection",
          label: "Tool selection",
          count: 3,
          positive: 0,
          negative: 3,
          neutral: 0,
          averageRating: 1.5,
          lastSeen: 1,
        },
      ],
    });

    expect(suggestion.content).toContain("Prefer the most specific available tool");
    expect(suggestion.validation.passed).toBe(true);
  });
});
