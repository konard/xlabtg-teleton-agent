export const NETWORK_AGENT_STATUSES = ["available", "busy", "offline", "degraded"] as const;
export type NetworkAgentStatus = (typeof NETWORK_AGENT_STATUSES)[number];

export const NETWORK_TRUST_LEVELS = ["trusted", "verified", "untrusted"] as const;
export type NetworkTrustLevel = (typeof NETWORK_TRUST_LEVELS)[number];

export const NETWORK_MESSAGE_TYPES = [
  "capability_query",
  "heartbeat",
  "negotiation",
  "task_request",
  "task_response",
] as const;
export type NetworkMessageType = (typeof NETWORK_MESSAGE_TYPES)[number];

export const NETWORK_MESSAGE_STATUSES = ["queued", "sent", "received", "failed"] as const;
export type NetworkMessageStatus = (typeof NETWORK_MESSAGE_STATUSES)[number];

export type NetworkDiscoveryMode = "central" | "peer-to-peer" | "dns";

export interface AgentNetworkConfig {
  enabled: boolean;
  agent_id: string;
  agent_name: string;
  endpoint: string | null;
  discovery_mode: NetworkDiscoveryMode;
  registry_url: string | null;
  known_peers: string[];
  public_key: string | null;
  private_key: string | null;
  allowlist: string[];
  blocklist: string[];
  default_trust_level: NetworkTrustLevel;
  message_timeout_ms: number;
  max_clock_skew_seconds: number;
}

export interface AgentNetworkAdvertisement {
  agentId: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  status: NetworkAgentStatus;
  load: number;
  publicKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NetworkAgentRecord {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  status: NetworkAgentStatus;
  load: number;
  publicKey: string | null;
  trustLevel: NetworkTrustLevel;
  blocked: boolean;
  latencyMs: number | null;
  errorRate: number;
  metadata: Record<string, unknown>;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkMessageEnvelope {
  type: NetworkMessageType;
  from: string;
  to: string;
  correlationId: string;
  payload: Record<string, unknown>;
  signature?: string | null;
  timestamp: string;
}

export interface NetworkMessageRecord extends NetworkMessageEnvelope {
  id: string;
  status: NetworkMessageStatus;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
  receivedAt: number | null;
}

export interface NetworkStatusSummary {
  totalAgents: number;
  availableAgents: number;
  degradedAgents: number;
  offlineAgents: number;
  trustedAgents: number;
  blockedAgents: number;
  averageLoad: number;
  messagesLastHour: number;
  errorsLastHour: number;
}

export interface NetworkTaskDelegationInput {
  agentId?: string;
  description: string;
  requiredCapabilities?: string[];
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface NetworkTaskDelegationResult {
  agent: NetworkAgentRecord;
  message: NetworkMessageRecord;
  remoteStatus: number;
  remoteResponse: unknown;
}

export interface AgentSelectionOptions {
  requiredCapabilities?: string[];
  excludeAgentIds?: string[];
}
