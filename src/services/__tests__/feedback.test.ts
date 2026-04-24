import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { FeedbackAnalyzer } from "../feedback/analyzer.js";
import { FeedbackCaptureService } from "../feedback/capture.js";
import { FeedbackLearner } from "../feedback/learner.js";

describe("FeedbackCaptureService", () => {
  let db: Database.Database;
  let service: FeedbackCaptureService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tg_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        is_from_agent INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `);
    service = new FeedbackCaptureService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores explicit feedback with rating, text, tags, and query filters", () => {
    const record = service.submitFeedback({
      sessionId: "session-1",
      messageId: "msg-1",
      type: "negative",
      rating: 2,
      text: "Too verbose and the code example did not work.",
      tags: ["too_long", "wrong"],
    });

    expect(record.id).toBeGreaterThan(0);
    expect(record.sessionId).toBe("session-1");
    expect(record.messageId).toBe("msg-1");
    expect(record.rating).toBe(2);

    const rows = service.listFeedback({ sessionId: "session-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].tags).toEqual(["too_long", "wrong"]);
  });

  it("captures implicit correction signals against the previous response once", () => {
    const now = Math.floor(Date.now() / 1000);
    const response = service.recordResponse({
      sessionId: "session-1",
      chatId: "chat-1",
      userMessage: "How do I run the test suite?",
      responseText: "Run npm test.",
      toolsUsed: [],
      timestamp: now - 30,
    });

    const signal = service.observeImplicitSignals({
      sessionId: "session-1",
      chatId: "chat-1",
      userMessage: "No, that is wrong. It should use the web package tests.",
      timestamp: now,
    });

    expect(signal?.messageId).toBe(response.messageId);
    expect(signal?.rating).toBe(2);
    expect(signal?.tags).toContain("follow_up_correction");

    const second = service.observeImplicitSignals({
      sessionId: "session-1",
      chatId: "chat-1",
      userMessage: "Actually, try another command.",
      timestamp: now + 10,
    });
    expect(second).toBeNull();
  });
});

describe("FeedbackAnalyzer and FeedbackLearner", () => {
  let db: Database.Database;
  let service: FeedbackCaptureService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tg_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        is_from_agent INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `);
    service = new FeedbackCaptureService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("aggregates satisfaction, coverage, and recurring themes", () => {
    const nowMs = Date.now();
    db.prepare(
      "INSERT INTO tg_messages (id, chat_id, is_from_agent, timestamp) VALUES (?, ?, ?, ?)"
    ).run("agent-1", "chat-1", 1, nowMs);

    service.submitFeedback({
      sessionId: "session-1",
      messageId: "agent-1",
      type: "positive",
      tags: ["helpful"],
    });
    service.submitFeedback({
      sessionId: "session-1",
      messageId: "agent-2",
      type: "negative",
      rating: 1,
      text: "Too long and confusing.",
      tags: ["too_long"],
    });

    const analyzer = new FeedbackAnalyzer(db);
    const analytics = analyzer.getAnalytics({ periodDays: 30 });
    const themes = analyzer.getThemes({ periodDays: 30 });

    expect(analytics.totalFeedback).toBe(2);
    expect(analytics.feedbackCoverage).toBeGreaterThan(0);
    expect(themes.some((theme) => theme.theme === "too_verbose")).toBe(true);
  });

  it("learns prompt preferences from repeated negative themes", () => {
    service.submitFeedback({
      sessionId: "session-1",
      messageId: "agent-1",
      type: "negative",
      text: "Too verbose.",
      tags: ["too_long"],
    });
    service.submitFeedback({
      sessionId: "session-2",
      messageId: "agent-2",
      type: "negative",
      text: "Still too long.",
      tags: ["too_long"],
    });

    const learner = new FeedbackLearner(db);
    const profile = learner.getPreferences();
    const prompt = learner.buildPromptAdjustment({ minThemeCount: 2 });

    expect(profile.responseLength.value).toBe("concise");
    expect(prompt).toContain("Keep responses concise");
  });
});
