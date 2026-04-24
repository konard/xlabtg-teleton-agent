import { describe, expect, it } from "vitest";
import { normalizePipelineSteps } from "../definition.js";
import { resolvePipelineSteps } from "../resolver.js";

describe("Pipeline resolver", () => {
  it("topologically groups independent branches for parallel execution", () => {
    const steps = normalizePipelineSteps([
      { id: "search", agent: "primary", action: "search", output: "search_results" },
      { id: "classify", agent: "primary", action: "classify", output: "classification" },
      {
        id: "summarize",
        agent: "primary",
        action: "summarize {search_results} {classification}",
        depends_on: ["search", "classify"],
        output: "final_report",
      },
    ]);

    const resolved = resolvePipelineSteps(steps);

    expect(resolved.order.map((step) => step.id)).toEqual(["search", "classify", "summarize"]);
    expect(resolved.levels.map((level) => level.map((step) => step.id))).toEqual([
      ["search", "classify"],
      ["summarize"],
    ]);
  });

  it("rejects cyclic pipeline definitions", () => {
    const steps = [
      { id: "a", agent: "primary", action: "a", depends_on: ["b"] },
      { id: "b", agent: "primary", action: "b", depends_on: ["a"] },
    ];

    expect(() => normalizePipelineSteps(steps)).toThrow("cycle");
  });

  it("rejects dependencies that do not point at another step", () => {
    const steps = [{ id: "a", agent: "primary", action: "a", depends_on: ["missing"] }];

    expect(() => normalizePipelineSteps(steps)).toThrow('unknown step "missing"');
  });
});
