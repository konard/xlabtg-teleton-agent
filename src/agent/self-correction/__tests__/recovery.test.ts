import { describe, expect, it } from "vitest";
import { classifyToolError, createToolRecovery } from "../recovery.js";

describe("tool error recovery", () => {
  it("classifies common tool error categories", () => {
    expect(classifyToolError("401 unauthorized: invalid API key")).toBe("auth");
    expect(classifyToolError("Tool timed out after 120s")).toBe("timeout");
    expect(classifyToolError("Validation failed: missing required field url")).toBe(
      "invalid_input"
    );
    expect(classifyToolError("404 resource not found")).toBe("resource_not_found");
    expect(classifyToolError("Rate limit exceeded, retry-after: 30")).toBe("rate_limit");
  });

  it("builds recovery guidance with adapted parameters for retryable failures", () => {
    const recovery = createToolRecovery({
      toolName: "web_search",
      params: { query: "x".repeat(300), limit: 50 },
      error: "request timed out",
    });

    expect(recovery.kind).toBe("timeout");
    expect(recovery.retryable).toBe(true);
    expect(recovery.guidance).toContain("narrower");
    expect(recovery.adaptedParams).toEqual({ query: "x".repeat(200), limit: 10 });
  });
});
