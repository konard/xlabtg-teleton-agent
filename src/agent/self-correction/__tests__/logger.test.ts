import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "../../../memory/schema.js";
import { CorrectionLogger } from "../logger.js";

describe("CorrectionLogger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and lists correction cycles by session and task", () => {
    const logger = new CorrectionLogger(db);

    logger.record({
      sessionId: "sess-1",
      taskId: "task-1",
      chatId: "telegram:1",
      iteration: 1,
      originalOutput: "incomplete",
      evaluation: {
        score: 0.4,
        feedback: "Missing the second requirement.",
        criteria: {
          completeness: 0.4,
          correctness: 0.8,
          toolUsage: 1,
          formatting: 0.9,
        },
        issues: ["Missing requirement"],
        needsCorrection: true,
      },
      reflection: {
        summary: "Add the missing requirement.",
        instructions: ["Address the second requirement"],
        focusAreas: ["completeness"],
      },
      correctedOutput: "complete",
      correctedScore: 0.9,
      threshold: 0.7,
      escalated: false,
      toolRecoveries: [],
    });

    const bySession = logger.listForSession("sess-1");
    expect(bySession).toHaveLength(1);
    expect(bySession[0].score).toBe(0.4);
    expect(bySession[0].correctedScore).toBe(0.9);
    expect(bySession[0].scoreDelta).toBeCloseTo(0.5);
    expect(bySession[0].evaluation.feedback).toContain("Missing");

    const byTask = logger.listForTask("task-1");
    expect(byTask).toHaveLength(1);
    expect(byTask[0].sessionId).toBe("sess-1");

    const patterns = logger.getRecurringPatterns();
    expect(patterns.map((pattern) => pattern.key)).toContain("criterion:completeness");
    expect(patterns.map((pattern) => pattern.key)).toContain("issue:missing requirement");
  });
});
