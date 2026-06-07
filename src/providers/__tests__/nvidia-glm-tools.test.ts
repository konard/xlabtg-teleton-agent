import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../../config/schema.js";

const mockComplete = vi.fn();

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    complete: (...args: unknown[]) => mockComplete(...args),
  };
});

function agentConfig(model: string): AgentConfig {
  return {
    provider: "nvidia",
    api_key: "nvapi-test-key",
    model,
    max_tokens: 1024,
    temperature: 0.7,
    system_prompt: null,
    max_agentic_iterations: 5,
    session_reset_policy: {
      daily_reset_enabled: false,
      daily_reset_hour: 4,
      idle_expiry_enabled: false,
      idle_expiry_minutes: 1440,
    },
  };
}

const sampleTool = {
  name: "test_lookup",
  description: "Lookup test data",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as unknown as Tool;

function makeAssistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "nvidia",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeAssistantToolCallMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call_lookup",
        name: "test_lookup",
        arguments: { query: "status" },
      },
    ],
    api: "openai-completions",
    provider: "nvidia",
    model: "meta/llama-3.1-8b-instruct",
    usage: {
      input: 10,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 13,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function makeToolResultMessage(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_lookup",
    toolName: "test_lookup",
    content: [{ type: "text", text: JSON.stringify({ success: true, data: { answer: "ok" } }) }],
    isError: false,
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete.mockResolvedValue(makeAssistantMessage("ok"));
});

describe("NVIDIA GLM-5.1 tool compatibility", () => {
  it("omits native tools for z-ai/glm-5.1 text-only chat requests", async () => {
    const { chatWithContext } = await import("../../agent/client.js");

    await chatWithContext(agentConfig("z-ai/glm-5.1"), {
      context: { messages: [], systemPrompt: "test" },
      tools: [sampleTool],
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [, context] = mockComplete.mock.calls[0] as [unknown, { tools?: Tool[] }];
    expect(context.tools).toBeUndefined();
  });

  it("converts old native tool history into alternating text-only GLM-5.1 messages", async () => {
    const { chatWithContext } = await import("../../agent/client.js");
    const history: Message[] = [
      { role: "user", content: "Check status", timestamp: Date.now() },
      makeAssistantToolCallMessage(),
      makeToolResultMessage(),
      { role: "user", content: "Explain the result", timestamp: Date.now() },
    ];

    await chatWithContext(agentConfig("z-ai/glm-5.1"), {
      context: { messages: history, systemPrompt: "test" },
      tools: [sampleTool],
    });

    const [, context] = mockComplete.mock.calls[0] as [
      unknown,
      { messages: Message[]; tools?: Tool[] },
    ];
    expect(context.tools).toBeUndefined();
    expect(context.messages.every((message) => message.role !== "toolResult")).toBe(true);
    expect(
      context.messages.every(
        (message) =>
          message.role !== "assistant" ||
          message.content.every((block) => block.type !== "toolCall")
      )
    ).toBe(true);
    expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(context.messages)).toContain("[Tool result: test_lookup - OK]");
  });

  it("keeps native tools for NVIDIA models with tool-calling parameters", async () => {
    const { chatWithContext } = await import("../../agent/client.js");

    await chatWithContext(agentConfig("meta/llama-3.1-8b-instruct"), {
      context: { messages: [], systemPrompt: "test" },
      tools: [sampleTool],
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [, context] = mockComplete.mock.calls[0] as [unknown, { tools?: Tool[] }];
    expect(context.tools).toEqual([sampleTool]);
  });
});
