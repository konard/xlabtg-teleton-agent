import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AlertingService, validateWebhookUrl, redactSecrets } from "../alerting.js";
import type { AnomalyEvent } from "../anomaly-detector.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../notifications.js", () => ({
  getNotificationService: vi.fn(() => ({
    add: vi.fn(),
    unreadCount: vi.fn(() => 0),
  })),
  notificationBus: { emit: vi.fn() },
}));

// ── validateWebhookUrl ─────────────────────────────────────────────────────────

describe("validateWebhookUrl", () => {
  it("accepts a valid https URL with a public hostname", () => {
    expect(() => validateWebhookUrl("https://hooks.example.com/notify")).not.toThrow();
  });

  it("rejects http:// URLs", () => {
    expect(() => validateWebhookUrl("http://hooks.example.com/notify")).toThrow(/https:/);
  });

  it("rejects link-local 169.254.0.0/16 (IMDS)", () => {
    expect(() => validateWebhookUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /private\/loopback/
    );
  });

  it("rejects loopback 127.0.0.1", () => {
    expect(() => validateWebhookUrl("https://127.0.0.1:7778/v1/agent/stop")).toThrow(
      /private\/loopback/
    );
  });

  it("rejects RFC-1918 10.0.0.0/8", () => {
    expect(() => validateWebhookUrl("https://10.1.2.3/hook")).toThrow(/private\/loopback/);
  });

  it("rejects RFC-1918 172.16.0.0/12 low end", () => {
    expect(() => validateWebhookUrl("https://172.16.0.1/hook")).toThrow(/private\/loopback/);
  });

  it("rejects RFC-1918 172.31.255.255 high end", () => {
    expect(() => validateWebhookUrl("https://172.31.255.255/hook")).toThrow(/private\/loopback/);
  });

  it("accepts 172.32.0.1 (outside RFC-1918 range)", () => {
    expect(() => validateWebhookUrl("https://172.32.0.1/hook")).not.toThrow();
  });

  it("rejects RFC-1918 192.168.0.0/16", () => {
    expect(() => validateWebhookUrl("https://192.168.1.1/hook")).toThrow(/private\/loopback/);
  });

  it("rejects IPv6 loopback ::1", () => {
    expect(() => validateWebhookUrl("https://[::1]/hook")).toThrow(/private\/loopback/);
  });

  it("rejects localhost hostname", () => {
    expect(() => validateWebhookUrl("https://localhost/hook")).toThrow(/loopback hostname/);
  });

  it("rejects .localhost subdomains", () => {
    expect(() => validateWebhookUrl("https://internal.localhost/hook")).toThrow(/loopback hostname/);
  });
});

// ── redactSecrets ──────────────────────────────────────────────────────────────

describe("redactSecrets", () => {
  it("redacts apiKey field", () => {
    const result = redactSecrets({ apiKey: "sk-secret-12345", metric: "requests" });
    expect(result.apiKey).toBe("[redacted]");
    expect(result.metric).toBe("requests");
  });

  it("redacts token field (case-insensitive key match)", () => {
    const result = redactSecrets({ Token: "bearer-abc", other: 42 });
    expect(result.Token).toBe("[redacted]");
  });

  it("redacts authorization field", () => {
    const result = redactSecrets({ authorization: "Basic xyz==", safe: true });
    expect(result.authorization).toBe("[redacted]");
    expect(result.safe).toBe(true);
  });

  it("redacts mnemonic field", () => {
    const result = redactSecrets({ mnemonic: "word1 word2 word3", id: "abc" });
    expect(result.mnemonic).toBe("[redacted]");
    expect(result.id).toBe("abc");
  });

  it("preserves normal metric fields", () => {
    const event = { type: "volume_spike", metric: "requests_per_hour", currentValue: 500 };
    const result = redactSecrets(event);
    expect(result).toEqual(event);
  });

  it("redacts secrets in nested objects", () => {
    const result = redactSecrets({ meta: { apiKey: "should-redact", name: "keep" } });
    expect((result.meta as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((result.meta as Record<string, unknown>).name).toBe("keep");
  });
});

// ── AlertingService webhook ────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AnomalyEvent> = {}): AnomalyEvent {
  return {
    id: "test-id",
    type: "volume_spike",
    severity: "warning",
    metric: "requests_per_hour",
    period: "hour",
    currentValue: 1000,
    expectedMin: 10,
    expectedMax: 100,
    baselineMean: 50,
    baselineStddev: 10,
    zScore: 5,
    description: "Spike detected",
    acknowledged: false,
    createdAt: Math.floor(Date.now() / 1000),
    acknowledgedAt: null,
    ...overrides,
  };
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS anomaly_alert_cooldowns (
      key             TEXT PRIMARY KEY,
      last_alerted_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe("AlertingService webhook dispatch", () => {
  let db: Database.Database;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    db = createTestDb();
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("rejects http:// webhook URL and records an error", async () => {
    const svc = new AlertingService(db, {
      config: {
        enabled: true,
        sensitivity: 2.5,
        baseline_days: 7,
        min_samples: 24,
        cooldown_minutes: 0,
        alerting: {
          in_app: false,
          telegram: false,
          telegram_chat_ids: [],
          webhook_url: "http://169.254.169.254/latest/meta-data/",
        },
      },
    });

    const result = await svc.dispatchAnomaly(makeEvent());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].channel).toBe("webhook");
    expect(result.errors[0].error).toMatch(/https:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not call fetch for private-IP webhook URL", async () => {
    const svc = new AlertingService(db, {
      config: {
        enabled: true,
        sensitivity: 2.5,
        baseline_days: 7,
        min_samples: 24,
        cooldown_minutes: 0,
        alerting: {
          in_app: false,
          telegram: false,
          telegram_chat_ids: [],
          webhook_url: "https://10.0.0.1/hook",
        },
      },
    });

    const result = await svc.dispatchAnomaly(makeEvent());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.errors[0].error).toMatch(/private\/loopback/);
  });

  it("calls fetch with AbortSignal for valid https URL", async () => {
    const svc = new AlertingService(db, {
      config: {
        enabled: true,
        sensitivity: 2.5,
        baseline_days: 7,
        min_samples: 24,
        cooldown_minutes: 0,
        alerting: {
          in_app: false,
          telegram: false,
          telegram_chat_ids: [],
          webhook_url: "https://hooks.example.com/notify",
        },
      },
    });

    const result = await svc.dispatchAnomaly(makeEvent());
    expect(result.delivered).toContain("webhook");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not include sensitive fields in posted body", async () => {
    const svc = new AlertingService(db, {
      config: {
        enabled: true,
        sensitivity: 2.5,
        baseline_days: 7,
        min_samples: 24,
        cooldown_minutes: 0,
        alerting: {
          in_app: false,
          telegram: false,
          telegram_chat_ids: [],
          webhook_url: "https://hooks.example.com/notify",
        },
      },
    });

    const eventWithSecret = makeEvent({ description: "test" } as Partial<AnomalyEvent>);
    // Inject a secret-like field via type cast to simulate contaminated event data
    (eventWithSecret as unknown as Record<string, unknown>)["apiKey"] = "sk-should-not-appear";

    await svc.dispatchAnomaly(eventWithSecret);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.anomaly.apiKey).toBe("[redacted]");
  });
});
