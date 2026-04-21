import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  AnomalyDetectorService,
  DEFAULT_ANOMALY_DETECTION_CONFIG,
  type AnomalyDetectionConfig,
} from "../anomaly-detector.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE request_metrics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name     TEXT,
      tokens_used   INTEGER,
      duration_ms   INTEGER,
      success       INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE metric_tokens (
      bucket INTEGER NOT NULL PRIMARY KEY,
      tokens INTEGER NOT NULL DEFAULT 0,
      cost   REAL    NOT NULL DEFAULT 0
    );

    CREATE TABLE metric_tool_calls (
      bucket INTEGER NOT NULL,
      tool   TEXT    NOT NULL,
      count  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, tool)
    );
  `);
  return db;
}

function currentHour(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 3600);
}

function insertRequests(
  db: Database.Database,
  bucket: number,
  count: number,
  opts: { errors?: number; durationMs?: number; tokensUsed?: number } = {}
): void {
  const errors = opts.errors ?? 0;
  const stmt = db.prepare(
    `INSERT INTO request_metrics (tokens_used, duration_ms, success, created_at)
     VALUES (?, ?, ?, ?)`
  );

  for (let i = 0; i < count; i++) {
    stmt.run(opts.tokensUsed ?? 100, opts.durationMs ?? 250, i < errors ? 0 : 1, bucket + 60);
  }
}

function insertCost(db: Database.Database, bucket: number, cost: number): void {
  db.prepare("INSERT INTO metric_tokens (bucket, tokens, cost) VALUES (?, ?, ?)").run(
    bucket,
    1000,
    cost
  );
}

function insertToolCalls(db: Database.Database, bucket: number, tool: string, count: number): void {
  db.prepare("INSERT INTO metric_tool_calls (bucket, tool, count) VALUES (?, ?, ?)").run(
    bucket,
    tool,
    count
  );
}

function insertToolExecutions(
  db: Database.Database,
  bucket: number,
  count: number,
  failures: number
): void {
  const stmt = db.prepare(
    `INSERT INTO anomaly_tool_metrics (tool_name, duration_ms, success, created_at)
     VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < count; i++) {
    stmt.run("web_fetch", 100, i < failures ? 0 : 1, bucket + 120);
  }
}

function testConfig(overrides: Partial<AnomalyDetectionConfig> = {}): AnomalyDetectionConfig {
  return {
    ...DEFAULT_ANOMALY_DETECTION_CONFIG,
    enabled: true,
    sensitivity: 2,
    baseline_days: 7,
    min_samples: 2,
    cooldown_minutes: 15,
    alerting: {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG.alerting,
      in_app: false,
      telegram: false,
      webhook_url: null,
      telegram_chat_ids: [],
      ...overrides.alerting,
    },
    ...overrides,
  };
}

describe("AnomalyDetectorService", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("calculates rolling baselines and detects a request volume spike", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 10);
    insertRequests(db, now, 50);

    const service = new AnomalyDetectorService(db, testConfig());
    const events = await service.detectNow();

    expect(events.some((event) => event.type === "volume_spike")).toBe(true);
    const baseline = service.getBaselines().find((row) => row.metric === "requests_per_hour");
    expect(baseline?.mean).toBe(10);
    expect(baseline?.sampleCount).toBeGreaterThanOrEqual(2);
  });

  it("detects an error burst when current error rate exceeds the baseline", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10, { errors: 0 });
    insertRequests(db, now - 2 * 3600, 10, { errors: 0 });
    insertRequests(db, now, 10, { errors: 8 });

    const service = new AnomalyDetectorService(db, testConfig());
    const events = await service.detectNow();

    const errorBurst = events.find((event) => event.type === "error_burst");
    expect(errorBurst).toBeDefined();
    expect(errorBurst?.metric).toBe("error_rate");
    expect(errorBurst?.severity).toBe("critical");
  });

  it("detects failed tool execution bursts", async () => {
    const now = currentHour();
    const service = new AnomalyDetectorService(db, testConfig());
    insertToolExecutions(db, now - 3 * 3600, 10, 0);
    insertToolExecutions(db, now - 2 * 3600, 10, 0);
    insertToolExecutions(db, now, 10, 7);

    const events = await service.detectNow();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error_burst",
          metric: "tool_failure_rate",
          severity: "critical",
        }),
      ])
    );
  });

  it("detects unseen tool usage as a behavioral anomaly", async () => {
    const now = currentHour();
    insertToolCalls(db, now - 3 * 3600, "telegram_send_message", 5);
    insertToolCalls(db, now - 2 * 3600, "telegram_send_message", 5);
    insertToolCalls(db, now, "exec_run", 1);

    const service = new AnomalyDetectorService(db, testConfig());
    const events = await service.detectNow();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "behavioral_anomaly",
          metric: "new_tool:exec_run",
          severity: "warning",
        }),
      ])
    );
  });

  it("does not create duplicate events inside the cooldown window", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 10);
    insertRequests(db, now, 50);

    const dispatch = vi.fn().mockResolvedValue(undefined);
    const service = new AnomalyDetectorService(db, testConfig(), { dispatchAnomaly: dispatch });

    const first = await service.detectNow();
    const second = await service.detectNow();

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(first.length);
  });

  it("acknowledges anomaly events", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 10);
    insertRequests(db, now, 50);

    const service = new AnomalyDetectorService(db, testConfig());
    const [event] = await service.detectNow();

    expect(service.acknowledge(event.id)).toBe(true);
    const stored = service.listEvents({ periodHours: 24 })[0];
    expect(stored.acknowledged).toBe(true);
    expect(stored.acknowledgedAt).toBeTypeOf("number");
  });
});
