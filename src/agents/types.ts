export type ManagedAgentMode = "personal" | "bot";
export type ManagedAgentMemoryPolicy = "isolated" | "shared-read" | "shared-write";

export type ManagedAgentState = "stopped" | "starting" | "running" | "stopping" | "error";
export type ManagedAgentTransport = "mtproto" | "bot-api";
export type ManagedAgentHealth = "stopped" | "starting" | "healthy" | "degraded" | "error";

export interface ManagedAgentResourcePolicy {
  maxMemoryMb: number;
  maxConcurrentTasks: number;
  rateLimitPerMinute: number;
  llmRateLimitPerMinute: number;
  restartOnCrash: boolean;
  maxRestarts: number;
  restartBackoffMs: number;
}

export interface ManagedAgentMessagingPolicy {
  enabled: boolean;
  allowlist: string[];
  maxMessagesPerMinute: number;
}

export interface ManagedAgentSecurityPolicy {
  personalAccountAccessConfirmedAt: string | null;
}

export interface ManagedAgentConnectionSettings {
  botUsername: string | null;
}

export interface ManagedAgentPersonalConnectionInput {
  apiId?: number;
  apiHash?: string;
  phone?: string;
}

export interface ManagedAgentPersonalAuthTarget {
  configPath: string;
  sessionPath: string;
}

export interface ManagedAgentMessage {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ManagedAgentDefinition {
  id: string;
  name: string;
  mode: ManagedAgentMode;
  memoryPolicy: ManagedAgentMemoryPolicy;
  resources: ManagedAgentResourcePolicy;
  messaging: ManagedAgentMessagingPolicy;
  security: ManagedAgentSecurityPolicy;
  connection: ManagedAgentConnectionSettings;
  homePath: string;
  configPath: string;
  workspacePath: string;
  logPath: string;
  createdAt: string;
  updatedAt: string;
  sourceId: string | null;
}

export interface ManagedAgentRuntimeStatus {
  state: ManagedAgentState;
  pid: number | null;
  startedAt: string | null;
  uptimeMs: number | null;
  lastError: string | null;
  transport: ManagedAgentTransport;
  health: ManagedAgentHealth;
  restartCount: number;
  lastExitAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  pendingMessages: number;
}

export interface ManagedAgentSnapshot extends ManagedAgentDefinition, ManagedAgentRuntimeStatus {
  provider: string;
  model: string;
  ownerId: number | null;
  adminIds: number[];
  hasBotToken: boolean;
  hasPersonalCredentials: boolean;
  hasPersonalSession: boolean;
  personalPhoneMasked: string | null;
}

export interface CreateManagedAgentInput {
  id?: string;
  name: string;
  cloneFromId?: string;
  mode?: ManagedAgentMode;
  botToken?: string;
  botUsername?: string;
  personalConnection?: ManagedAgentPersonalConnectionInput;
  memoryPolicy?: ManagedAgentMemoryPolicy;
  resources?: Partial<ManagedAgentResourcePolicy>;
  messaging?: Partial<ManagedAgentMessagingPolicy>;
  acknowledgePersonalAccountAccess?: boolean;
}

export interface UpdateManagedAgentInput {
  name?: string;
  botToken?: string | null;
  botUsername?: string | null;
  personalConnection?: ManagedAgentPersonalConnectionInput;
  memoryPolicy?: ManagedAgentMemoryPolicy;
  resources?: Partial<ManagedAgentResourcePolicy>;
  messaging?: Partial<ManagedAgentMessagingPolicy>;
  acknowledgePersonalAccountAccess?: boolean;
}

export interface ManagedAgentCommand {
  command: string;
  args: string[];
}
