export type ManagedAgentMode = "personal" | "bot";

export type ManagedAgentState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ManagedAgentDefinition {
  id: string;
  name: string;
  mode: ManagedAgentMode;
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
}

export interface ManagedAgentSnapshot extends ManagedAgentDefinition, ManagedAgentRuntimeStatus {
  provider: string;
  model: string;
  ownerId: number | null;
  adminIds: number[];
  hasBotToken: boolean;
}

export interface CreateManagedAgentInput {
  id?: string;
  name: string;
  cloneFromId?: string;
}

export interface ManagedAgentCommand {
  command: string;
  args: string[];
}
