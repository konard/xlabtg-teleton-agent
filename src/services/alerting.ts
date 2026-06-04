import type { Database } from "better-sqlite3";
import type { AnomalyDetectionConfig, AnomalyEvent } from "./anomaly-detector.js";
import { validateOutboundUrl } from "./outbound-url-guard.js";
import { getNotificationService, notificationBus } from "./notifications.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Alerting");

const WEBHOOK_TIMEOUT_MS = 5_000;

const SECRET_FIELDS = new Set([
  "apikey",
  "authorization",
  "token",
  "mnemonic",
  "secret",
  "password",
]);

/**
 * Validates a webhook URL for SSRF safety.
 * Throws if the URL is not https: or targets a private/loopback/link-local address.
 */
export function validateWebhookUrl(raw: string): void {
  validateOutboundUrl(raw, { allowedProtocols: ["https:"], label: "Webhook URL" });
}

/**
 * Returns a shallow copy of obj with sensitive-looking fields replaced by "[redacted]".
 * Only top-level keys are inspected; nested objects are left opaque but recursed one level.
 */
export function redactSecrets<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (SECRET_FIELDS.has(key.toLowerCase())) {
      result[key] = "[redacted]";
    } else if (
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = redactSecrets(result[key] as Record<string, unknown>);
    }
  }
  return result as T;
}

export interface TelegramAlertChannel {
  chatIds: string[];
  sendMessage: (chatId: string, text: string) => Promise<void>;
}

export interface AlertingServiceOptions {
  config: AnomalyDetectionConfig;
  telegram?: TelegramAlertChannel;
}

export interface AlertDispatchResult {
  delivered: string[];
  skipped: boolean;
  errors: Array<{ channel: string; error: string }>;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatAlertMessage(event: AnomalyEvent): string {
  const expected = `${formatValue(event.expectedMin)}-${formatValue(event.expectedMax)}`;
  return [
    `[${event.severity.toUpperCase()}] ${event.type.replace(/_/g, " ")}`,
    `Metric: ${event.metric}`,
    `Current: ${formatValue(event.currentValue)}`,
    `Expected: ${expected}`,
    `Detected: ${new Date(event.createdAt * 1000).toISOString()}`,
    event.description,
  ].join("\n");
}

export class AlertingService {
  private db: Database;
  private options: AlertingServiceOptions;

  constructor(db: Database, options: AlertingServiceOptions) {
    this.db = db;
    this.options = options;
    this.migrate();
  }

  updateOptions(options: AlertingServiceOptions): void {
    this.options = {
      ...this.options,
      ...options,
      telegram: options.telegram ?? this.options.telegram,
    };
  }

  async dispatchAnomaly(event: AnomalyEvent): Promise<AlertDispatchResult> {
    const result: AlertDispatchResult = { delivered: [], skipped: false, errors: [] };
    const key = `${event.type}:${event.metric}`;
    const cooldownSeconds = this.options.config.cooldown_minutes * 60;

    if (this.isCoolingDown(key, cooldownSeconds)) {
      return { ...result, skipped: true };
    }

    const alerting = this.options.config.alerting;
    const message = formatAlertMessage(event);

    if (alerting.in_app) {
      try {
        const svc = getNotificationService(this.db);
        svc.add(
          event.severity === "critical" ? "error" : "warning",
          `Anomaly: ${event.metric}`,
          event.description
        );
        notificationBus.emit("update", svc.unreadCount());
        result.delivered.push("in_app");
      } catch (error) {
        result.errors.push({ channel: "in_app", error: getErrorText(error) });
      }
    }

    if (alerting.telegram) {
      const telegram = this.options.telegram;
      const chatIds =
        alerting.telegram_chat_ids.length > 0
          ? alerting.telegram_chat_ids
          : (telegram?.chatIds ?? []);
      if (telegram && chatIds.length > 0) {
        const deliveries = await Promise.allSettled(
          chatIds.map((chatId) => telegram.sendMessage(chatId, message))
        );
        deliveries.forEach((delivery, index) => {
          if (delivery.status === "fulfilled") {
            result.delivered.push(`telegram:${chatIds[index]}`);
          } else {
            result.errors.push({
              channel: `telegram:${chatIds[index]}`,
              error: getErrorText(delivery.reason),
            });
          }
        });
      }
    }

    if (alerting.webhook_url) {
      try {
        validateWebhookUrl(alerting.webhook_url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        try {
          const payload = {
            type: "teleton.anomaly",
            anomaly: redactSecrets(event as unknown as Record<string, unknown>),
            message,
          };
          const response = await fetch(alerting.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Webhook returned HTTP ${response.status}`);
          }
          result.delivered.push("webhook");
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        result.errors.push({ channel: "webhook", error: getErrorText(error) });
      }
    }

    this.markAlerted(key);

    if (result.errors.length > 0) {
      log.warn({ errors: result.errors, anomalyId: event.id }, "Anomaly alert dispatch failed");
    }

    return result;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS anomaly_alert_cooldowns (
        key             TEXT PRIMARY KEY,
        last_alerted_at INTEGER NOT NULL
      );
    `);
  }

  private isCoolingDown(key: string, cooldownSeconds: number): boolean {
    const row = this.db
      .prepare("SELECT last_alerted_at FROM anomaly_alert_cooldowns WHERE key = ?")
      .get(key) as { last_alerted_at: number } | undefined;
    return !!row && nowUnix() - row.last_alerted_at < cooldownSeconds;
  }

  private markAlerted(key: string): void {
    this.db
      .prepare(
        `INSERT INTO anomaly_alert_cooldowns (key, last_alerted_at)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET last_alerted_at = excluded.last_alerted_at`
      )
      .run(key, nowUnix());
  }
}

function getErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let _instance: AlertingService | null = null;

export function initAlerting(db: Database, options: AlertingServiceOptions): AlertingService {
  if (_instance) {
    _instance.updateOptions(options);
    return _instance;
  }
  _instance = new AlertingService(db, options);
  return _instance;
}

export function getAlerting(): AlertingService | null {
  return _instance;
}
