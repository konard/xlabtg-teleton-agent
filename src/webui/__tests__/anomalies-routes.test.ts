import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import {
  DEFAULT_ANOMALY_DETECTION_CONFIG,
  initAnomalyDetector,
} from "../../services/anomaly-detector.js";
import { createAnomaliesRoutes } from "../routes/anomalies.js";
import type { WebUIServerDeps } from "../types.js";

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

function buildApp(db: Database.Database) {
  const config = {
    ...DEFAULT_ANOMALY_DETECTION_CONFIG,
    enabled: true,
    sensitivity: 2,
    min_samples: 2,
  };
  initAnomalyDetector(db, config);

  const deps = {
    memory: { db },
    agent: {
      getConfig: () => ({ anomaly_detection: config }),
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/anomalies", createAnomaliesRoutes(deps));
  return app;
}

function currentHour(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 3600);
}

function insertRequests(db: Database.Database, bucket: number, count: number): void {
  const stmt = db.prepare(
    `INSERT INTO request_metrics (tokens_used, duration_ms, success, created_at)
     VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < count; i++) {
    stmt.run(100, 250, 1, bucket + 60);
  }
}

describe("Anomaly WebUI routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
  });

  it("GET /anomalies returns detected anomaly events", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 10);
    insertRequests(db, now, 50);
    await initAnomalyDetector(db, {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG,
      enabled: true,
      sensitivity: 2,
      min_samples: 2,
    }).detectNow();

    const res = await app.request("/anomalies?period=24h");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0]).toHaveProperty("type");
  });

  it("GET /anomalies/baselines returns current baselines", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 12);
    await initAnomalyDetector(db, {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG,
      enabled: true,
      sensitivity: 2,
      min_samples: 2,
    }).refreshBaselines();

    const res = await app.request("/anomalies/baselines");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.some((row: { metric: string }) => row.metric === "requests_per_hour")).toBe(
      true
    );
  });

  it("POST /anomalies/:id/acknowledge marks an anomaly reviewed", async () => {
    const now = currentHour();
    insertRequests(db, now - 3 * 3600, 10);
    insertRequests(db, now - 2 * 3600, 10);
    insertRequests(db, now, 50);
    const [event] = await initAnomalyDetector(db, {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG,
      enabled: true,
      sensitivity: 2,
      min_samples: 2,
    }).detectNow();

    const res = await app.request(`/anomalies/${event.id}/acknowledge`, { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.acknowledged).toBe(true);
  });

  it("GET /anomalies/stats returns aggregate detection counts", async () => {
    const res = await app.request("/anomalies/stats");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("total");
    expect(json.data).toHaveProperty("unacknowledged");
  });
});
