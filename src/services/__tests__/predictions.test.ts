import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { BehaviorTracker, extractTopics } from "../behavior-tracker.js";
import { PredictionService } from "../predictions.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("Prediction engine", () => {
  let db: Database.Database;
  let tracker: BehaviorTracker;
  let predictions: PredictionService;

  beforeEach(() => {
    db = new Database(":memory:");
    tracker = new BehaviorTracker(db);
    predictions = new PredictionService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("extracts useful topics while dropping short words and stop words", () => {
    expect(extractTopics("Please run tests and check deploy status for the API", 4)).toEqual([
      "tests",
      "check",
      "deploy",
      "status",
    ]);
  });

  it("learns sequential next-action predictions from repeated transitions", () => {
    for (let i = 0; i < 3; i++) {
      tracker.recordMessage({
        sessionId: `session-${i}`,
        chatId: "chat-1",
        text: "check status",
      });
      tracker.recordMessage({
        sessionId: `session-${i}`,
        chatId: "chat-1",
        text: "run tests",
      });
    }

    tracker.recordMessage({
      sessionId: "session-outlier",
      chatId: "chat-1",
      text: "check status",
    });
    tracker.recordMessage({
      sessionId: "session-outlier",
      chatId: "chat-1",
      text: "deploy",
    });

    const next = predictions.getNextActions({
      currentAction: "check status",
      confidenceThreshold: 0.6,
    });

    expect(next).toHaveLength(1);
    expect(next[0].action).toBe("run tests");
    expect(next[0].confidence).toBeCloseTo(0.75);
    expect(next[0].reason).toContain("Usually follows");
  });

  it("learns contextual tool predictions from message topics", () => {
    for (let i = 0; i < 2; i++) {
      tracker.recordMessage({
        sessionId: `tool-session-${i}`,
        chatId: "chat-1",
        text: "search the deployment logs",
      });
      tracker.recordToolInvocation({
        sessionId: `tool-session-${i}`,
        chatId: "chat-1",
        toolName: "logs_search",
      });
    }

    const tools = predictions.getLikelyTools({
      context: "can you inspect deploy logs?",
      confidenceThreshold: 0.6,
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      action: "logs_search",
      confidence: 1,
    });
    expect(tools[0].reason).toContain("topic");
  });

  it("returns related topics through shared contextual tools", () => {
    tracker.recordMessage({
      sessionId: "topic-session-a",
      chatId: "chat-1",
      text: "deployment logs failed",
    });
    tracker.recordToolInvocation({
      sessionId: "topic-session-a",
      chatId: "chat-1",
      toolName: "logs_search",
    });
    tracker.recordMessage({
      sessionId: "topic-session-b",
      chatId: "chat-1",
      text: "release logs summary",
    });
    tracker.recordToolInvocation({
      sessionId: "topic-session-b",
      chatId: "chat-1",
      toolName: "logs_search",
    });

    const topics = predictions.getRelatedTopics({
      context: "deployment status",
      confidenceThreshold: 0.5,
    });

    expect(topics.some((topic) => topic.action === "release")).toBe(true);
  });

  it("stores prediction feedback for later tuning", () => {
    predictions.recordFeedback({
      endpoint: "tools",
      action: "logs_search",
      confidence: 0.8,
      reason: "Matched topic logs",
      helpful: false,
    });

    const row = db.prepare("SELECT endpoint, action, helpful FROM prediction_feedback").get() as {
      endpoint: string;
      action: string;
      helpful: number;
    };

    expect(row).toEqual({ endpoint: "tools", action: "logs_search", helpful: 0 });
  });
});
