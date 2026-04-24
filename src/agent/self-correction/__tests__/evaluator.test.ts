import { describe, expect, it } from "vitest";
import { parseEvaluationResult } from "../evaluator.js";

describe("self-correction evaluator parsing", () => {
  it("parses fenced JSON and clamps scores into the valid range", () => {
    const parsed = parseEvaluationResult(`
\`\`\`json
{
  "score": 1.4,
  "feedback": "Mostly complete.",
  "criteria": {
    "completeness": 0.9,
    "correctness": -0.2,
    "toolUsage": 0.75,
    "formatting": 0.8
  },
  "issues": ["Missing one edge case"],
  "needsCorrection": false
}
\`\`\`
`);

    expect(parsed.score).toBe(1);
    expect(parsed.criteria.correctness).toBe(0);
    expect(parsed.feedback).toBe("Mostly complete.");
    expect(parsed.issues).toEqual(["Missing one edge case"]);
    expect(parsed.needsCorrection).toBe(false);
  });

  it("returns a conservative fallback for non-JSON evaluator output", () => {
    const parsed = parseEvaluationResult("Looks incomplete because it skipped the formatting.");

    expect(parsed.score).toBe(0.5);
    expect(parsed.feedback).toContain("Looks incomplete");
    expect(parsed.needsCorrection).toBe(true);
  });
});
