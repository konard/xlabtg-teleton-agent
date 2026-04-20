import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import type { Model, Api } from "@mariozechner/pi-ai";
import { parseGoalFromNaturalLanguage, parseLLMResponse } from "../goal-parser.js";
import type { AgentConfig } from "../../config/schema.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: "anthropic",
    api_key: "sk-ant-test",
    model: "claude-opus-4-6",
    utility_model: "claude-haiku-4-5-20251001",
    ...overrides,
  } as AgentConfig;
}

const fakeModel = {
  id: "claude-haiku-4-5-20251001",
  name: "haiku",
  api: "anthropic",
  provider: "anthropic",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
} as unknown as Model<Api>;

describe("parseLLMResponse", () => {
  it("parses a clean JSON response", () => {
    const raw = JSON.stringify({
      goal: "Monitor DeDust pools and report new ones",
      successCriteria: ["recorded ≥1 pool", "report sent to @channel"],
      failureConditions: ["3 consecutive errors"],
      constraints: { maxIterations: 60, maxDurationHours: 4 },
      suggestedStrategy: "balanced",
      suggestedPriority: "medium",
      confidence: 0.92,
    });

    const parsed = parseLLMResponse(raw, "fallback goal");

    expect(parsed.goal).toBe("Monitor DeDust pools and report new ones");
    expect(parsed.successCriteria).toEqual(["recorded ≥1 pool", "report sent to @channel"]);
    expect(parsed.failureConditions).toEqual(["3 consecutive errors"]);
    expect(parsed.constraints.maxIterations).toBe(60);
    expect(parsed.constraints.maxDurationHours).toBe(4);
    expect(parsed.suggestedStrategy).toBe("balanced");
    expect(parsed.suggestedPriority).toBe("medium");
    expect(parsed.confidence).toBe(0.92);
  });

  it("strips markdown fences around the JSON", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        goal: "Do the thing",
        successCriteria: ["done"],
        suggestedStrategy: "conservative",
        suggestedPriority: "high",
        confidence: 0.75,
      }) +
      "\n```";

    const parsed = parseLLMResponse(raw, "fallback");
    expect(parsed.goal).toBe("Do the thing");
    expect(parsed.suggestedStrategy).toBe("conservative");
    expect(parsed.suggestedPriority).toBe("high");
  });

  it("uses fallback goal when AI omits it", () => {
    const raw = JSON.stringify({
      successCriteria: ["a"],
      suggestedStrategy: "balanced",
      suggestedPriority: "medium",
      confidence: 0.5,
    });
    const parsed = parseLLMResponse(raw, "fallback goal");
    expect(parsed.goal).toBe("fallback goal");
  });

  it("normalises invalid strategy/priority to safe defaults", () => {
    const raw = JSON.stringify({
      goal: "x",
      successCriteria: ["y"],
      suggestedStrategy: "banana",
      suggestedPriority: "extreme",
      confidence: 2,
    });
    const parsed = parseLLMResponse(raw, "fb");
    expect(parsed.suggestedStrategy).toBe("balanced");
    expect(parsed.suggestedPriority).toBe("medium");
    expect(parsed.confidence).toBe(1); // clamped
  });

  it("drops invalid constraint values", () => {
    const raw = JSON.stringify({
      goal: "x",
      successCriteria: ["y"],
      constraints: {
        maxIterations: "lots",
        maxDurationHours: NaN,
        budgetTON: -5,
        allowedTools: ["a", 42, "b"],
      },
      suggestedStrategy: "balanced",
      suggestedPriority: "medium",
      confidence: 0.3,
    });
    const parsed = parseLLMResponse(raw, "fb");
    expect(parsed.constraints.maxIterations).toBeUndefined();
    expect(parsed.constraints.maxDurationHours).toBeUndefined();
    expect(parsed.constraints.budgetTON).toBe(0); // clamped from -5
    expect(parsed.constraints.allowedTools).toEqual(["a", "b"]);
  });

  it("throws when the response has no JSON object", () => {
    expect(() => parseLLMResponse("I cannot answer that.", "fb")).toThrow(
      /did not return a JSON object/
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLLMResponse("{ goal: unquoted }", "fb")).toThrow(/invalid JSON/);
  });
});

describe("parseGoalFromNaturalLanguage", () => {
  it("calls the LLM with the supplied input and returns parsed data", async () => {
    const mockComplete = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            goal: "Monitor DeDust pools every 5 minutes",
            successCriteria: ["at least one pool recorded"],
            failureConditions: [],
            constraints: { maxIterations: 80 },
            suggestedStrategy: "balanced",
            suggestedPriority: "medium",
            confidence: 0.88,
          }),
        },
      ],
    });

    const mockGetUtilityModel = vi.fn().mockReturnValue(fakeModel);

    const result = await parseGoalFromNaturalLanguage(
      "Следи за новыми пулами DeDust каждые 5 минут",
      makeConfig(),
      { complete: mockComplete, getUtilityModel: mockGetUtilityModel }
    );

    expect(mockGetUtilityModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5-20251001");
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [modelArg, contextArg, optionsArg] = mockComplete.mock.calls[0];
    expect(modelArg).toBe(fakeModel);
    expect(contextArg.messages[0].content).toContain("Следи за новыми пулами DeDust");
    expect(optionsArg.apiKey).toBe("sk-ant-test");
    expect(optionsArg.temperature).toBe(0);

    expect(result.goal).toBe("Monitor DeDust pools every 5 minutes");
    expect(result.confidence).toBe(0.88);
    expect(result.constraints.maxIterations).toBe(80);
  });

  it("throws when naturalLanguage is empty/whitespace", async () => {
    await expect(
      parseGoalFromNaturalLanguage("   ", makeConfig(), {
        complete: vi.fn(),
        getUtilityModel: vi.fn().mockReturnValue(fakeModel),
      })
    ).rejects.toThrow(/required/);
  });

  it("throws when provider has no API key", async () => {
    await expect(
      parseGoalFromNaturalLanguage("do something", makeConfig({ api_key: "" }), {
        complete: vi.fn(),
        getUtilityModel: vi.fn().mockReturnValue(fakeModel),
      })
    ).rejects.toThrow(/no API key/);
  });

  it("surfaces LLM call errors as descriptive messages", async () => {
    const mockComplete = vi.fn().mockRejectedValue(new Error("upstream 429"));
    await expect(
      parseGoalFromNaturalLanguage("goal", makeConfig(), {
        complete: mockComplete,
        getUtilityModel: vi.fn().mockReturnValue(fakeModel),
      })
    ).rejects.toThrow(/LLM call failed.*upstream 429/);
  });

  it("throws when the LLM returns an empty response", async () => {
    const mockComplete = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "   " }] });
    await expect(
      parseGoalFromNaturalLanguage("goal", makeConfig(), {
        complete: mockComplete,
        getUtilityModel: vi.fn().mockReturnValue(fakeModel),
      })
    ).rejects.toThrow(/empty response/);
  });
});
