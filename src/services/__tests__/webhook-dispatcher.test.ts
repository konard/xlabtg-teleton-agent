import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { getEventBus, resetEventBusForTesting, type TeletonEvent } from "../event-bus.js";
import {
  WebhookDispatcher,
  getWebhookDispatcher,
  resetWebhookDispatcherForTesting,
} from "../webhook-dispatcher.js";

const WEBHOOK_TEST_KEY = "11".repeat(32);

function makeEvent(type = "agent.message.received"): TeletonEvent {
  return {
    id: "event-1",
    type,
    source: "test",
    correlationId: "corr-1",
    timestamp: new Date("2026-04-24T00:00:00.000Z").toISOString(),
    payload: { text: "hello", token: "should-redact" },
  };
}

describe("WebhookDispatcher", () => {
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;
  let previousWebhookKey: string | undefined;

  beforeEach(() => {
    previousWebhookKey = process.env.TELETON_WEBHOOK_KEY;
    process.env.TELETON_WEBHOOK_KEY = WEBHOOK_TEST_KEY;
    db = new Database(":memory:");
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, text: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    resetWebhookDispatcherForTesting(db);
    resetEventBusForTesting(db);
    vi.unstubAllGlobals();
    db.close();
    if (previousWebhookKey === undefined) {
      delete process.env.TELETON_WEBHOOK_KEY;
    } else {
      process.env.TELETON_WEBHOOK_KEY = previousWebhookKey;
    }
  });

  it("signs and delivers matching events to active webhooks", async () => {
    const dispatcher = getWebhookDispatcher(db);
    const webhook = dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["agent.message.received"],
      secret: "top-secret",
      maxRetries: 1,
    });

    const [delivery] = await dispatcher.dispatchEvent(makeEvent());

    expect(delivery.webhookId).toBe(webhook.id);
    expect(delivery.status).toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    const headers = init.headers as Record<string, string>;
    const expectedSignature = createHmac("sha256", "top-secret").update(body).digest("hex");

    expect(headers["X-Webhook-Event"]).toBe("agent.message.received");
    expect(headers["X-Webhook-Signature"]).toBe(`sha256=${expectedSignature}`);
    expect(body).not.toContain("should-redact");
  });

  it("stores webhook secrets encrypted at rest", () => {
    const dispatcher = getWebhookDispatcher(db);
    dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["agent.message.received"],
      secret: "top-secret",
      maxRetries: 1,
    });

    const row = db.prepare("SELECT secret FROM webhooks LIMIT 1").get() as { secret: string };
    const stored = JSON.parse(row.secret) as { encrypted?: boolean; ciphertext?: string };

    expect(row.secret).not.toContain("top-secret");
    expect(stored.encrypted).toBe(true);
    expect(stored.ciphertext).toMatch(/^[0-9a-f]+$/);
  });

  it("records failed deliveries after the configured max retry count", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: vi.fn() });
    const dispatcher = getWebhookDispatcher(db);
    dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["agent.message.received"],
      secret: "top-secret",
      maxRetries: 1,
    });

    const [delivery] = await dispatcher.dispatchEvent(makeEvent());

    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(1);
    expect(delivery.error).toContain("HTTP 503");
  });

  it("skips webhooks that are not subscribed to the event type", async () => {
    const dispatcher = getWebhookDispatcher(db);
    dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["tool.failed"],
      secret: "top-secret",
      maxRetries: 1,
    });

    const deliveries = await dispatcher.dispatchEvent(makeEvent());

    expect(deliveries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not double-deliver manual tests for wildcard webhooks", async () => {
    const dispatcher = getWebhookDispatcher(db);
    dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["*"],
      secret: "top-secret",
      maxRetries: 1,
    });

    const delivery = await dispatcher.testWebhook(dispatcher.listWebhooks()[0].id);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(delivery.status).toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe to event bus deliveries when disabled", async () => {
    const dispatcher = new WebhookDispatcher(db, { enabled: false });
    dispatcher.createWebhook({
      url: "https://hooks.example.com/teleton",
      events: ["config.changed"],
      secret: "top-secret",
      maxRetries: 1,
    });

    await getEventBus(db).publish({
      type: "config.changed",
      source: "test",
      payload: { key: "feature" },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(fetchMock).not.toHaveBeenCalled();
    dispatcher.stop();
  });
});
