import { describe, expect, it } from "vitest";
import { EntityExtractor } from "../entity-extractor.js";

describe("EntityExtractor", () => {
  it("extracts a structured graph from an agent turn with tools and common entities", async () => {
    const extractor = new EntityExtractor();

    const graph = await extractor.extractTurn({
      chatId: "42",
      sessionId: "session-1",
      userName: "Alex",
      userMessage:
        "Please review the TON wallet setup for @alice at https://example.com/docs by 2026-05-01.",
      assistantMessage: "I checked the docs and sent Alice the setup notes.",
      toolCalls: [
        {
          name: "telegram_send_message",
          input: { chatId: "@alice", message: "Wallet setup notes" },
        },
      ],
      timestamp: 1_774_116_800_000,
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "conversation", label: "Telegram chat 42" }),
        expect.objectContaining({ type: "task" }),
        expect.objectContaining({ type: "tool", label: "telegram_send_message" }),
        expect.objectContaining({ type: "entity", label: "https://example.com/docs" }),
        expect.objectContaining({ type: "entity", label: "@alice" }),
        expect.objectContaining({ type: "entity", label: "2026-05-01" }),
        expect.objectContaining({ type: "outcome" }),
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "USED_TOOL" }),
        expect.objectContaining({ relation: "PRODUCED" }),
        expect.objectContaining({ relation: "MENTIONED_IN" }),
      ])
    );
  });

  it("builds a structured prompt for optional LLM extraction", () => {
    const prompt = EntityExtractor.buildExtractionPrompt({
      chatId: "42",
      sessionId: "session-1",
      userMessage: "Plan vector memory rollout",
      assistantMessage: "Use staged tests and migration.",
      toolCalls: [],
      timestamp: 1,
    });

    expect(prompt).toContain("JSON");
    expect(prompt).toContain("entities");
    expect(prompt).toContain("relationships");
    expect(prompt).toContain("Plan vector memory rollout");
  });
});
