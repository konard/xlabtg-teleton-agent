export const INTEGRATION_TYPES = ["api", "webhook", "oauth", "mcp"] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_AUTH_TYPES = [
  "none",
  "api_key",
  "oauth2",
  "jwt",
  "basic",
  "custom_header",
] as const;
export type IntegrationAuthType = (typeof INTEGRATION_AUTH_TYPES)[number];

export const INTEGRATION_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "unhealthy",
  "unconfigured",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface IntegrationAuthConfig {
  type: IntegrationAuthType;
  credentialId?: string | null;
  headerName?: string;
  prefix?: string;
  queryParam?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
}

export interface IntegrationRateLimitConfig {
  requestsPerMinute?: number;
  requestsPerHour?: number;
  queue?: boolean;
  maxQueueSize?: number;
}

export interface IntegrationHttpActionConfig {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path?: string;
  url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}

export interface IntegrationConfig {
  baseUrl?: string;
  healthCheckUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  actions?: Record<string, IntegrationHttpActionConfig>;
  rateLimit?: IntegrationRateLimitConfig;
  [key: string]: unknown;
}

export interface IntegrationStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  lastExecutedAt: number | null;
  avgLatencyMs: number | null;
}

export interface IntegrationEntity {
  id: string;
  name: string;
  type: IntegrationType;
  provider: string;
  auth: IntegrationAuthConfig;
  authId: string | null;
  config: IntegrationConfig;
  status: IntegrationStatus;
  healthCheckUrl: string | null;
  lastHealthAt: number | null;
  lastHealthMessage: string | null;
  createdAt: number;
  updatedAt: number;
  stats: IntegrationStats;
}

export interface IntegrationHealth {
  status: Exclude<IntegrationStatus, "unknown">;
  checkedAt: string;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface IntegrationResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  headers?: Record<string, string>;
  latencyMs?: number;
}

export interface Integration {
  id: string;
  name: string;
  type: IntegrationType;
  auth: IntegrationAuthConfig;
  healthCheck(): Promise<IntegrationHealth>;
  execute(action: string, params: Record<string, unknown>): Promise<IntegrationResult>;
}

export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  type: IntegrationType;
  provider: string;
  description: string;
  authTypes: IntegrationAuthType[];
  defaultConfig: IntegrationConfig;
  actions: Array<{ id: string; name: string; description: string }>;
}

export interface CreateIntegrationInput {
  id?: string;
  name: string;
  type: IntegrationType;
  provider: string;
  auth?: IntegrationAuthConfig;
  authId?: string | null;
  config?: IntegrationConfig;
  healthCheckUrl?: string | null;
}

export interface UpdateIntegrationInput {
  name?: string;
  type?: IntegrationType;
  provider?: string;
  auth?: IntegrationAuthConfig;
  authId?: string | null;
  config?: IntegrationConfig;
  healthCheckUrl?: string | null;
  status?: IntegrationStatus;
}

export interface IntegrationCredential {
  id: string;
  integrationId: string;
  authType: IntegrationAuthType;
  credentials: Record<string, unknown>;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCredentialInput {
  integrationId: string;
  authType: IntegrationAuthType;
  credentials: Record<string, unknown>;
  expiresAt?: number | null;
}

export function isIntegrationType(value: unknown): value is IntegrationType {
  return typeof value === "string" && INTEGRATION_TYPES.includes(value as IntegrationType);
}

export function isIntegrationAuthType(value: unknown): value is IntegrationAuthType {
  return typeof value === "string" && INTEGRATION_AUTH_TYPES.includes(value as IntegrationAuthType);
}

export function isIntegrationStatus(value: unknown): value is IntegrationStatus {
  return typeof value === "string" && INTEGRATION_STATUSES.includes(value as IntegrationStatus);
}
