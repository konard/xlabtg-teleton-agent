import { randomUUID, sign, verify, type KeyLike } from "node:crypto";
import type { AuditTrailService } from "../audit-trail.js";
import type { AgentNetworkStore } from "./discovery.js";
import { NetworkTrustService } from "./trust.js";
import type {
  NetworkAgentRecord,
  NetworkMessageEnvelope,
  NetworkMessageRecord,
  NetworkMessageType,
} from "./types.js";

export interface NetworkMessengerOptions {
  store: AgentNetworkStore;
  localAgentId?: string;
  privateKey?: KeyLike | string | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxClockSkewSeconds?: number;
  auditTrail?: AuditTrailService | null;
  trustService?: NetworkTrustService;
}

export interface SendNetworkMessageOptions {
  payload: Record<string, unknown>;
  type: NetworkMessageType;
  correlationId?: string;
  timeoutMs?: number;
}

function normalizeForJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeForJson(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = normalizeForJson(source[key]);
    }
    return sorted;
  }
  return String(value);
}

function canonicalMessage(message: NetworkMessageEnvelope): string {
  return JSON.stringify(
    normalizeForJson({
      type: message.type,
      from: message.from,
      to: message.to,
      correlationId: message.correlationId,
      payload: message.payload,
      timestamp: message.timestamp,
    })
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function signNetworkMessage(
  message: Omit<NetworkMessageEnvelope, "signature">,
  privateKey: KeyLike | string
): NetworkMessageEnvelope {
  const signature = sign(null, Buffer.from(canonicalMessage(message)), privateKey).toString(
    "base64"
  );
  return { ...message, signature };
}

export function verifyNetworkMessage(
  message: NetworkMessageEnvelope,
  publicKey: KeyLike | string
): boolean {
  if (!message.signature) return false;
  try {
    return verify(
      null,
      Buffer.from(canonicalMessage(message)),
      publicKey,
      Buffer.from(message.signature, "base64")
    );
  } catch {
    return false;
  }
}

export class NetworkMessageReplayError extends Error {
  constructor(readonly existingMessage: NetworkMessageRecord) {
    super(`Network message replay detected for correlation id ${existingMessage.correlationId}`);
    this.name = "NetworkMessageReplayError";
  }
}

export class NetworkMessenger {
  private readonly store: AgentNetworkStore;
  private readonly localAgentId: string;
  private readonly privateKey: KeyLike | string | null;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxClockSkewSeconds: number;
  private readonly auditTrail: AuditTrailService | null;
  private readonly trustService: NetworkTrustService;

  constructor(options: NetworkMessengerOptions) {
    this.store = options.store;
    this.localAgentId = options.localAgentId ?? "primary";
    this.privateKey = options.privateKey ?? null;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxClockSkewSeconds = options.maxClockSkewSeconds ?? 300;
    this.auditTrail = options.auditTrail ?? null;
    this.trustService = options.trustService ?? new NetworkTrustService();
  }

  buildMessage(
    agent: NetworkAgentRecord,
    options: SendNetworkMessageOptions
  ): NetworkMessageEnvelope {
    const message = {
      type: options.type,
      from: this.localAgentId,
      to: agent.id,
      correlationId: options.correlationId ?? randomUUID(),
      payload: options.payload,
      timestamp: new Date().toISOString(),
    };
    if (!this.privateKey) {
      throw new Error("Network private key is required to sign outbound messages");
    }
    return signNetworkMessage(message, this.privateKey);
  }

  async sendMessage(
    agent: NetworkAgentRecord,
    options: SendNetworkMessageOptions
  ): Promise<{ message: NetworkMessageRecord; status: number; response: unknown }> {
    const envelope = this.buildMessage(agent, options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    let failureWasLogged = false;

    try {
      const response = await this.fetcher(agent.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      const body = await response.json().catch(async () => response.text().catch(() => null));
      if (!response.ok) {
        const record = this.store.logMessage(envelope, "failed", {
          error: `HTTP ${response.status}`,
        });
        failureWasLogged = true;
        this.auditMessage(record);
        throw new Error(`Remote agent ${agent.id} returned HTTP ${response.status}`);
      }
      const record = this.store.logMessage(envelope, "sent");
      this.auditMessage(record);
      return { message: record, status: response.status, response: body };
    } catch (error) {
      if (!failureWasLogged) {
        const record = this.store.logMessage(envelope, "failed", {
          error: getErrorMessage(error),
        });
        this.auditMessage(record);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  receiveMessage(message: NetworkMessageEnvelope): NetworkMessageRecord {
    const sender = this.store.getAgent(message.from);
    if (!sender) {
      throw new Error(`Unknown network sender: ${message.from}`);
    }

    const receivedAt = Date.parse(message.timestamp);
    if (!Number.isFinite(receivedAt)) {
      throw new Error("Network message timestamp is invalid");
    }
    const skewMs = Math.abs(Date.now() - receivedAt);
    if (skewMs > this.maxClockSkewSeconds * 1000) {
      throw new Error("Network message timestamp is outside allowed clock skew");
    }

    if (!sender.publicKey) {
      throw new Error(`Missing public key for network sender: ${message.from}`);
    }
    if (!verifyNetworkMessage(message, sender.publicKey)) {
      throw new Error(`Invalid signature from network sender: ${message.from}`);
    }

    const authorization = this.trustService.authorizeAgent(sender, message.type);
    if (!authorization.allowed) {
      throw new Error(authorization.reason ?? "Network sender is not authorized");
    }

    const existing = this.store.findReceivedMessage(message);
    if (existing) {
      throw new NetworkMessageReplayError(existing);
    }

    let record: NetworkMessageRecord;
    try {
      record = this.store.logMessage(message, "received");
    } catch (error) {
      const replayed = this.store.findReceivedMessage(message);
      if (replayed) {
        throw new NetworkMessageReplayError(replayed);
      }
      throw error;
    }
    this.auditMessage(record);
    return record;
  }

  private auditMessage(record: NetworkMessageRecord): void {
    this.auditTrail?.recordEvent({
      eventType: "network.message",
      actor: record.from,
      payload: {
        id: record.id,
        type: record.type,
        from: record.from,
        to: record.to,
        status: record.status,
        correlationId: record.correlationId,
        error: record.error,
      },
    });
  }
}
