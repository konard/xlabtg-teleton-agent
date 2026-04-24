import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { BehaviorTracker } from "../behavior-tracker.js";
import {
  TemporalContextService,
  applyTemporalSearchWeights,
  deriveTemporalMetadata,
  upsertTemporalMetadata,
} from "../temporal-context.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

describe("temporal context service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it("derives local temporal metadata from a timestamp and timezone", () => {
    const metadata = deriveTemporalMetadata({
      timestamp: "2026-04-24T13:30:00Z",
      timezone: "UTC",
      sessionIndex: 1,
    });

    expect(metadata).toMatchObject({
      localDate: "2026-04-24",
      localTime: "13:30:00",
      dayOfWeek: 5,
      dayName: "Friday",
      hourOfDay: 13,
      timeOfDay: "afternoon",
      relativePeriod: "weekday",
      sessionPhase: "beginning",
    });
    expect(metadata.relativeMarkers).toEqual(["afternoon", "weekday", "friday"]);
  });

  it("stores temporal metadata overlay rows for indexed entities", () => {
    upsertTemporalMetadata(db, "knowledge", "k1", "2026-04-24T09:00:00Z", {
      timezone: "UTC",
      metadata: { source: "memory" },
    });

    const row = db
      .prepare("SELECT entity_type, entity_id, day_of_week, hour_of_day FROM temporal_metadata")
      .get() as {
      entity_type: string;
      entity_id: string;
      day_of_week: number;
      hour_of_day: number;
    };

    expect(row).toEqual({
      entity_type: "knowledge",
      entity_id: "k1",
      day_of_week: 5,
      hour_of_day: 9,
    });
  });

  it("detects recurring time patterns and surfaces active patterns", () => {
    const tracker = new BehaviorTracker(db);
    const fridayNine = Date.parse("2026-04-24T09:00:00Z") / 1000;
    const nextFridayNine = Date.parse("2026-05-01T09:00:00Z") / 1000;
    const fridayTen = Date.parse("2026-05-01T10:00:00Z") / 1000;

    tracker.recordMessage({
      sessionId: "s1",
      chatId: "chat-1",
      text: "check status",
      timestamp: fridayNine,
    });
    tracker.recordMessage({
      sessionId: "s2",
      chatId: "chat-1",
      text: "check status",
      timestamp: nextFridayNine,
    });
    tracker.recordMessage({
      sessionId: "s3",
      chatId: "chat-1",
      text: "check status",
      timestamp: fridayTen,
    });

    const service = new TemporalContextService(db, {
      timezone: "UTC",
      pattern_min_frequency: 2,
      pattern_confidence_threshold: 0.5,
    });
    const result = service.analyzeAndStorePatterns();
    const patterns = service.listPatterns({ includeDisabled: true });
    const context = service.getCurrentTemporalContext({
      time: "2026-05-08T09:00:00Z",
    });

    expect(result.upserted).toBeGreaterThan(0);
    expect(patterns.some((pattern) => pattern.patternType === "recurring")).toBe(true);
    expect(context.activePatterns.length).toBeGreaterThan(0);
    expect(context.activePatterns[0].description).toContain("check status");
  });

  it("updates stored pattern enablement", () => {
    const tracker = new BehaviorTracker(db);
    const fridayNine = Date.parse("2026-04-24T09:00:00Z") / 1000;
    tracker.recordMessage({
      sessionId: "s1",
      chatId: "chat-1",
      text: "daily report",
      timestamp: fridayNine,
    });
    tracker.recordMessage({
      sessionId: "s2",
      chatId: "chat-1",
      text: "daily report",
      timestamp: fridayNine + 7 * 24 * 60 * 60,
    });

    const service = new TemporalContextService(db, { timezone: "UTC" });
    service.analyzeAndStorePatterns();
    const pattern = service.listPatterns()[0];
    expect(pattern).toBeDefined();

    const updated = service.updatePattern(pattern!.id, { enabled: false });
    expect(updated?.enabled).toBe(false);
  });

  it("blends temporal relevance into search scores", () => {
    const current = Date.parse("2026-04-24T09:00:00Z") / 1000;
    const sameSlot = Date.parse("2026-04-17T09:00:00Z") / 1000;
    const differentSlot = Date.parse("2026-04-19T22:00:00Z") / 1000;
    const results = applyTemporalSearchWeights(
      [
        { score: 0.5, createdAt: differentSlot },
        { score: 0.5, createdAt: sameSlot },
      ],
      {
        enabled: true,
        timezone: "UTC",
        now: current,
        temporal_relevance_weight: 0.8,
        recency_half_life_days: 30,
      }
    );

    expect(results[1].temporalScore).toBeGreaterThan(results[0].temporalScore ?? 0);
    expect(results[1].score).toBeGreaterThan(results[0].score);
  });
});
