const API_BASE = "/api";

// ── Workflow Automation types ─────────────────────────────────────────────────

export interface CronTrigger {
  type: "cron";
  cron: string;
  label?: string;
}

export interface WebhookTrigger {
  type: "webhook";
  secret?: string;
}

export interface EventTrigger {
  type: "event";
  event: "agent.start" | "agent.stop" | "agent.error" | "tool.complete";
}

export type WorkflowTrigger = CronTrigger | WebhookTrigger | EventTrigger;

export interface SendMessageAction {
  type: "send_message";
  chatId: string;
  text: string;
}

export interface CallApiAction {
  type: "call_api";
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SetVariableAction {
  type: "set_variable";
  name: string;
  value: string;
}

export type WorkflowAction = SendMessageAction | CallApiAction | SetVariableAction;

export interface WorkflowConfig {
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
}

export interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  config: WorkflowConfig;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  runCount: number;
  lastError: string | null;
}

// ── Pipeline Execution types ─────────────────────────────────────────────────

export type PipelineErrorStrategy = "fail_fast" | "continue" | "retry";
export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type PipelineStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface PipelineStepData {
  id: string;
  agent: string;
  action: string;
  output: string;
  dependsOn: string[];
  errorStrategy?: PipelineErrorStrategy;
  retryCount?: number;
  timeoutSeconds?: number;
}

export interface PipelineData {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  steps: PipelineStepData[];
  errorStrategy: PipelineErrorStrategy;
  maxRetries: number;
  timeoutSeconds: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineRunData {
  id: string;
  pipelineId: string;
  status: PipelineStatus;
  errorStrategy: PipelineErrorStrategy;
  inputContext: Record<string, unknown>;
  context: Record<string, unknown>;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface PipelineRunStepData {
  runId: string;
  pipelineId: string;
  stepId: string;
  agent: string;
  action: string;
  output: string;
  dependsOn: string[];
  status: PipelineStepStatus;
  inputContext: Record<string, unknown> | null;
  outputValue: unknown;
  error: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface PipelineRunDetailData {
  run: PipelineRunData;
  steps: PipelineRunStepData[];
}

// ── Structured Rule types (Visual Rule Builder) ───────────────────────────────

export type RuleType = "block" | "inject" | "transform" | "notify";
export type ChatType = "dm" | "group" | "any";
export type UserRole = "admin" | "any";

export interface TriggerBlock {
  type: "trigger";
  keyword: string;
}

export interface ConditionBlock {
  type: "condition";
  userRole: UserRole;
  chatType: ChatType;
}

export interface ActionBlock {
  type: "action";
  ruleType: RuleType;
  value: string;
}

export type RuleBlock = TriggerBlock | ConditionBlock | ActionBlock;

export interface StructuredRule {
  id: string;
  name: string;
  enabled: boolean;
  blocks: RuleBlock[];
  order: number;
}

// ── Setup types ─────────────────────────────────────────────────────

export interface SetupStatusResponse {
  workspaceExists: boolean;
  configExists: boolean;
  walletExists: boolean;
  walletAddress: string | null;
  sessionExists: boolean;
  envVars: {
    apiKey: string | null;
    apiKeyRaw: boolean;
    telegramApiId: string | null;
    telegramApiHash: string | null;
    telegramPhone: string | null;
  };
}

export interface SetupProvider {
  id: string;
  displayName: string;
  defaultModel: string;
  utilityModel: string;
  toolLimit: number | null;
  keyPrefix: string | null;
  consoleUrl: string | null;
  requiresApiKey: boolean;
  autoDetectsKey?: boolean;
}

export interface ClaudeCodeKeyDetection {
  found: boolean;
  maskedKey: string | null;
  valid: boolean;
}

export interface SetupModelOption {
  value: string;
  name: string;
  description: string;
  isCustom?: boolean;
}

export interface BotValidation {
  valid: boolean;
  networkError: boolean;
  bot?: { username: string; firstName: string };
  error?: string;
}

export interface WalletStatus {
  exists: boolean;
  address?: string;
}

export interface WalletResult {
  address: string;
  mnemonic: string[];
}

export type ManagedAgentKind = "primary" | "managed";
export type ManagedAgentMode = "personal" | "bot";
export type ManagedAgentMemoryPolicy = "isolated" | "shared-read" | "shared-write";
export type ManagedAgentState = "stopped" | "starting" | "running" | "stopping" | "error";
export type ManagedAgentTransport = "mtproto" | "bot-api";
export type ManagedAgentHealth = "stopped" | "starting" | "healthy" | "degraded" | "error";
export type BuiltInAgentType =
  | "ResearchAgent"
  | "CodeAgent"
  | "ContentAgent"
  | "OrchestratorAgent"
  | "MonitorAgent";
export type ManagedAgentType = BuiltInAgentType | "CustomAgent" | (string & {});

export interface AgentResourcePolicy {
  maxMemoryMb: number;
  maxConcurrentTasks: number;
  rateLimitPerMinute: number;
  llmRateLimitPerMinute: number;
  restartOnCrash: boolean;
  maxRestarts: number;
  restartBackoffMs: number;
}

export interface AgentMessagingPolicy {
  enabled: boolean;
  allowlist: string[];
  maxMessagesPerMinute: number;
}

export interface AgentSecurityPolicy {
  personalAccountAccessConfirmedAt: string | null;
}

export interface AgentConnectionSettings {
  botUsername: string | null;
}

export interface AgentRegistryConfig {
  hookRules: string[];
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  maxToolCallsPerTurn: number | null;
}

export interface AgentArchetype {
  type: BuiltInAgentType;
  name: string;
  description: string;
  soulTemplate: string;
  tools: string[];
  config: AgentRegistryConfig;
  resources?: Partial<AgentResourcePolicy>;
  messaging?: Partial<AgentMessagingPolicy>;
  memoryPolicy?: ManagedAgentMemoryPolicy;
}

export interface AgentOverview {
  id: string;
  name: string;
  kind: ManagedAgentKind;
  type: ManagedAgentType;
  description: string;
  mode: ManagedAgentMode;
  soulTemplate: string;
  tools: string[];
  config: AgentRegistryConfig;
  memoryPolicy: ManagedAgentMemoryPolicy;
  resources: AgentResourcePolicy;
  messaging: AgentMessagingPolicy;
  security: AgentSecurityPolicy;
  connection: AgentConnectionSettings;
  homePath: string;
  configPath: string;
  workspacePath: string;
  logPath: string;
  createdAt: string;
  updatedAt: string;
  sourceId: string | null;
  provider: string;
  model: string;
  ownerId: number | null;
  adminIds: number[];
  hasBotToken: boolean;
  hasPersonalCredentials: boolean;
  hasPersonalSession: boolean;
  personalPhoneMasked: string | null;
  state: ManagedAgentState;
  status: ManagedAgentState;
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
  canDelete: boolean;
  canStart: boolean;
  canStop: boolean;
  logsAvailable: boolean;
  canStartReason: string | null;
}

export interface AgentLogs {
  lines: string[];
  path: string;
}

export interface AgentMessage {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface CreateAgentInput {
  name: string;
  id?: string;
  type?: ManagedAgentType;
  description?: string;
  soulTemplate?: string;
  tools?: string[];
  config?: Partial<AgentRegistryConfig>;
  cloneFromId?: string;
  mode?: ManagedAgentMode;
  botToken?: string;
  botUsername?: string;
  personalConnection?: {
    apiId?: number;
    apiHash?: string;
    phone?: string;
  };
  memoryPolicy?: ManagedAgentMemoryPolicy;
  resources?: Partial<AgentResourcePolicy>;
  messaging?: Partial<AgentMessagingPolicy>;
  acknowledgePersonalAccountAccess?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  type?: ManagedAgentType;
  description?: string;
  soulTemplate?: string;
  tools?: string[];
  config?: Partial<AgentRegistryConfig>;
  botToken?: string | null;
  botUsername?: string | null;
  personalConnection?: {
    apiId?: number;
    apiHash?: string;
    phone?: string;
  };
  memoryPolicy?: ManagedAgentMemoryPolicy;
  resources?: Partial<AgentResourcePolicy>;
  messaging?: Partial<AgentMessagingPolicy>;
  acknowledgePersonalAccountAccess?: boolean;
}

export interface AuthCodeResult {
  authSessionId: string;
  codeDelivery: "app" | "sms" | "fragment";
  fragmentUrl?: string;
  codeLength?: number;
  expiresAt: number;
}

export interface AuthQrResult {
  authSessionId: string;
  token: string;
  expires: number;
  expiresAt: number;
}

export interface AuthVerifyResult {
  status:
    | "authenticated"
    | "2fa_required"
    | "invalid_code"
    | "invalid_password"
    | "expired"
    | "too_many_attempts";
  user?: { id: number; firstName: string; username: string };
  passwordHint?: string;
}

export interface AuthQrRefreshResult {
  status: "waiting" | "authenticated" | "2fa_required" | "expired";
  token?: string;
  expires?: number;
  user?: { id: number; firstName: string; username?: string };
  passwordHint?: string;
}

export interface SetupConfig {
  agent: {
    provider: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    max_agentic_iterations?: number;
  };
  telegram: {
    api_id: number;
    api_hash: string;
    phone: string;
    admin_ids: number[];
    owner_id: number;
    dm_policy?: string;
    group_policy?: string;
    require_mention?: boolean;
    bot_token?: string;
    bot_username?: string;
  };
  cocoon?: { port: number };
  deals?: { enabled?: boolean; buy_max_floor_percent?: number; sell_min_floor_percent?: number };
  tonapi_key?: string;
  toncenter_api_key?: string;
  tavily_api_key?: string;
  webui?: { enabled: boolean };
  api?: { expose_lan?: boolean };
}

// ── Response types ──────────────────────────────────────────────────

export interface StatusData {
  uptime: number;
  model: string;
  provider: string;
  sessionCount: number;
  toolCount: number;
  tokenUsage?: { totalTokens: number; totalCost: number };
  platform?: string;
}

export interface MemoryStats {
  knowledge: number;
  sessions: number;
  messages: number;
  chats: number;
}

export interface SearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  importanceScore?: number;
}

export interface MemorySourceFile {
  source: string;
  entryCount: number;
  lastUpdated: number;
}

export interface MemoryChunk {
  id: string;
  text: string;
  source: string;
  startLine: number | null;
  endLine: number | null;
  updatedAt: number;
}

export interface MemoryScoreInfo {
  memoryId: string;
  score: number;
  recency: number;
  frequency: number;
  impact: number;
  explicit: number;
  centrality: number;
  accessCount: number;
  impactCount: number;
  pinned: boolean;
  lastAccessedAt: number | null;
  updatedAt: number;
}

export interface MemoryScoreDistributionBucket {
  min: number;
  max: number;
  count: number;
}

export interface MemoryScoreStats {
  total: number;
  averageScore: number;
  pinned: number;
  distribution: MemoryScoreDistributionBucket[];
}

export interface MemoryAtRiskEntry {
  id: string;
  text: string;
  source: string;
  path: string | null;
  score: number;
  createdAt: number;
  updatedAt: number;
  reasons: string[];
  ageDays: number;
}

export interface MemoryArchiveStats {
  archived: number;
  pendingDeletion: number;
  oldestArchivedAt: number | null;
}

export interface MemoryCleanupHistoryEntry {
  id: number;
  mode: "dry_run" | "archive" | "prune_archive";
  candidates: number;
  archived: number;
  deleted: number;
  protected: number;
  reason: string | null;
  createdAt: number;
}

export interface MemoryPriorityData {
  scores: MemoryScoreStats;
  pinned: MemoryScoreInfo[];
  archive: MemoryArchiveStats;
  atRisk: MemoryAtRiskEntry[];
  cleanupHistory: MemoryCleanupHistoryEntry[];
}

export interface MemoryCleanupCandidate {
  id: string;
  text: string;
  source: string;
  path: string | null;
  score: number;
  createdAt: number;
  updatedAt: number;
  reasons: string[];
}

export interface MemoryCleanupResult {
  dryRun: boolean;
  candidates: MemoryCleanupCandidate[];
  archived: number;
  deleted: number;
  protected: number;
}

export type MemoryGraphNodeType = "conversation" | "task" | "tool" | "topic" | "entity" | "outcome";

export interface MemoryGraphNode {
  id: string;
  type: MemoryGraphNodeType;
  label: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  createdAt: number;
}

export interface MemoryGraphData {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  total?: number;
  root?: MemoryGraphNode | null;
}

export interface SemanticMemoryStatusInfo {
  mode: "online" | "standby" | "fallback";
  reason?: string;
  vectorCount?: number;
  pendingVectorCount?: number;
  indexDimension?: number;
}

export interface MemoryVectorSyncResult {
  synced: boolean;
  indexed: number;
  skipped: number;
  vectorsUpserted: number;
  vectorsDeleted: number;
  vectorErrors: string[];
  status: SemanticMemoryStatusInfo;
  message: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  module: string;
  scope: "always" | "dm-only" | "group-only" | "admin-only";
  category?: string;
  enabled: boolean;
}

export interface ModuleInfo {
  name: string;
  toolCount: number;
  tools: ToolInfo[];
  isPlugin: boolean;
}

export interface PluginManifest {
  name: string;
  version: string;
  author?: string;
  description?: string;
  dependencies?: string[];
  sdkVersion?: string;
}

export interface TaskData {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed" | "cancelled";
  priority: number;
  createdBy?: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  scheduledFor?: string | null;
  payload?: string | null;
  reason?: string | null;
  result?: string | null;
  error?: string | null;
  dependencies: string[];
  dependents: string[];
  correctionCount?: number;
}

export type TaskSubtaskStatus =
  | "pending"
  | "delegated"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled";

export interface TaskSubtaskData {
  id: string;
  taskId: string;
  parentId?: string;
  description: string;
  requiredSkills: string[];
  requiredTools: string[];
  agentId?: string;
  status: TaskSubtaskStatus;
  result?: string | null;
  error?: string | null;
  depth: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  dependencies: string[];
}

export interface TaskSubtaskNodeData extends TaskSubtaskData {
  children: TaskSubtaskNodeData[];
}

export interface DelegationTimelineEventData {
  id: string;
  type: "created" | "delegated" | "started" | "completed" | "failed" | "cancelled";
  subtaskId: string;
  subtaskDescription: string;
  agentId?: string;
  at: string;
  message: string;
}

export interface TaskDelegationTreeData {
  taskId: string;
  subtasks: TaskSubtaskData[];
  roots: TaskSubtaskNodeData[];
  timeline: DelegationTimelineEventData[];
}

export interface SubtaskPlanInput {
  planId?: string;
  description: string;
  requiredSkills?: string[];
  requiredTools?: string[];
  dependsOn?: string[];
  agentId?: string | null;
}

export interface SoulVersionMeta {
  id: number;
  filename: string;
  comment: string | null;
  created_at: string;
  content_length: number;
}

export interface SoulVersion {
  id: number;
  filename: string;
  content: string;
  comment: string | null;
  created_at: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export interface WorkspaceInfo {
  root: string;
  totalFiles: number;
  totalSize: number;
}

export interface ToolConfigData {
  tool: string;
  enabled: boolean;
  scope: string;
}

export interface ToolUsageStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: number | null;
  avgDurationMs: number | null;
}

export interface ToolDetails {
  name: string;
  description: string;
  module: string | null;
  category: string | null;
  scope: "always" | "dm-only" | "group-only" | "admin-only";
  enabled: boolean;
  parameters: unknown;
  stats: ToolUsageStats;
}

export interface ToolRagStatus {
  enabled: boolean;
  indexed: boolean;
  topK: number;
  totalTools: number;
  alwaysInclude?: string[];
  skipUnlimitedProviders?: boolean;
}

export interface McpServerInfo {
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  target: string;
  scope: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  tools: string[];
  envKeys: string[];
}

export type IntegrationType = "api" | "webhook" | "oauth" | "mcp";
export type IntegrationAuthType =
  | "none"
  | "api_key"
  | "oauth2"
  | "jwt"
  | "basic"
  | "custom_header";
export type IntegrationStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unconfigured";

export interface IntegrationAuthConfig {
  type: IntegrationAuthType;
  credentialId?: string | null;
  headerName?: string;
  prefix?: string;
}

export interface IntegrationConfig {
  baseUrl?: string;
  healthCheckUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  actions?: Record<string, unknown>;
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    queue?: boolean;
    maxQueueSize?: number;
  };
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

export interface IntegrationCredential {
  id: string;
  integrationId: string;
  authType: IntegrationAuthType;
  credentials: Record<string, unknown>;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
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
  latencyMs?: number;
}

export interface ConfigKeyData {
  key: string;
  label: string;
  set: boolean;
  value: string | null;
  sensitive: boolean;
  type: "string" | "number" | "boolean" | "enum" | "array";
  hotReload: "instant" | "restart";
  itemType?: "string" | "number";
  options?: string[];
  optionLabels?: Record<string, string>;
  category: string;
  description: string;
}

export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

export type NotificationType = "error" | "warning" | "info" | "achievement";

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
}

// ── Metrics types ────────────────────────────────────────────────────

export interface TokenDataPoint {
  timestamp: number; // unix seconds, truncated to hour
  tokens: number;
  cost: number;
}

export interface ToolUsageEntry {
  tool: string;
  count: number;
}

export interface ActivityEntry {
  dayOfWeek: number; // 0=Sun … 6=Sat
  hour: number; // 0–23
  count: number;
}

export type MetricsPeriod = "24h" | "7d" | "30d";

// ── Analytics types ──────────────────────────────────────────────────

export interface PerformanceSummary {
  avgResponseMs: number | null;
  successRate: number | null;
  totalRequests: number;
  errorCount: number;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface ErrorFrequencyEntry {
  date: string;
  count: number;
}

export interface AnalyticsPerformanceData {
  summary: PerformanceSummary;
  errorFrequency: ErrorFrequencyEntry[];
}

export interface DailyCostEntry {
  date: string;
  cost_usd: number;
  tokens_input: number;
  tokens_output: number;
  request_count: number;
}

export interface CostPerToolEntry {
  tool: string;
  count: number;
  avg_duration_ms: number | null;
}

export interface AnalyticsCostData {
  daily: DailyCostEntry[];
  perTool: CostPerToolEntry[];
}

export interface BudgetStatus {
  monthly_limit_usd: number | null;
  current_month_cost_usd: number;
  percent_used: number | null;
  projection_usd: number | null;
}

// ── Temporal context types ───────────────────────────────────────────

export interface TemporalMetadata {
  timestamp: number;
  isoString: string;
  timezone: string;
  localDate: string;
  localTime: string;
  dayOfWeek: number;
  dayName: string;
  hourOfDay: number;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  relativePeriod: "weekday" | "weekend";
  relativeMarkers: string[];
  sessionPhase: "beginning" | "middle" | "end" | "unknown";
}

export interface TemporalPattern {
  id: string;
  patternType: "daily" | "weekly" | "recurring" | "seasonal" | "custom";
  description: string;
  scheduleCron: string | null;
  confidence: number;
  frequency: number;
  lastSeen: number;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  activeScore?: number;
}

export interface TemporalContextData {
  timezone: string;
  generatedAt: number;
  metadata: TemporalMetadata;
  activePatterns: TemporalPattern[];
  suggestedGreeting: string;
}

export interface TemporalTimelineEntry {
  id: string;
  entityType: "knowledge" | "message" | "session" | "task" | "behavior" | "request" | "tool";
  entityId: string;
  timestamp: number;
  timezone: string;
  dayOfWeek: number;
  hourOfDay: number;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  relativePeriod: "weekday" | "weekend";
  sessionPhase: "beginning" | "middle" | "end" | "unknown";
  metadata: Record<string, unknown>;
}

// ── Cache types ─────────────────────────────────────────────────────

export type CacheResourceType = "tools" | "prompts" | "embeddings" | "api_responses";

export interface CacheEntryInfo {
  key: string;
  type: CacheResourceType;
  resourceId: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hits: number;
  sizeBytes: number;
  estimatedLatencyMs: number;
}

export interface CacheTypeStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  memoryBytes: number;
}

export interface CacheStats {
  enabled: boolean;
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  hitRate: number;
  memoryBytes: number;
  latencySavedMs: number;
  byType: Record<CacheResourceType, CacheTypeStats>;
  entries: CacheEntryInfo[];
}

export interface CacheWarmInput {
  context?: string;
  sessionId?: string;
  chatId?: string;
  isGroup?: boolean;
  isAdmin?: boolean;
}

export interface CacheWarmResult {
  startedAt: number;
  durationMs: number;
  predictedTools: string[];
  warmed: {
    tools: string[];
    prompts: string[];
  };
}

export type AnomalyType =
  | "volume_spike"
  | "error_burst"
  | "latency_degradation"
  | "cost_spike"
  | "behavioral_anomaly";

export type AnomalySeverity = "warning" | "critical";

export interface AnomalyAlertingConfig {
  in_app: boolean;
  telegram: boolean;
  telegram_chat_ids: string[];
  webhook_url: string | null;
}

export interface AnomalyDetectionConfigData {
  enabled: boolean;
  sensitivity: number;
  baseline_days: number;
  min_samples: number;
  cooldown_minutes: number;
  alerting: AnomalyAlertingConfig;
}

export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  metric: string;
  period: string;
  currentValue: number;
  expectedMin: number;
  expectedMax: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number | null;
  description: string;
  acknowledged: boolean;
  createdAt: number;
  acknowledgedAt: number | null;
}

export interface AnomalyBaseline {
  metric: string;
  period: string;
  mean: number;
  stddev: number;
  sampleCount: number;
  updatedAt: number;
  currentValue: number | null;
}

export interface AnomalyStats {
  total: number;
  warning: number;
  critical: number;
  unacknowledged: number;
  lastDetectedAt: number | null;
  byType: Array<{ type: AnomalyType; count: number }>;
  config: AnomalyDetectionConfigData;
}

// ── Prediction types ─────────────────────────────────────────────────

export type PredictionEndpoint = "next" | "tools" | "topics";

export interface PredictionSuggestion {
  action: string;
  confidence: number;
  reason: string;
}

// ── Security types ────────────────────────────────────────────────────────────

export type AuditActionType =
  | "config_change"
  | "tool_toggle"
  | "soul_edit"
  | "agent_restart"
  | "agent_stop"
  | "plugin_install"
  | "plugin_remove"
  | "hook_change"
  | "mcp_change"
  | "integration_change"
  | "memory_delete"
  | "workspace_change"
  | "session_delete"
  | "secret_change"
  | "security_change"
  | "login"
  | "logout"
  | "other";

export interface AuditLogEntry {
  id: number;
  action: AuditActionType;
  details: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface SecuritySettings {
  session_timeout_minutes: number | null;
  ip_allowlist: string[];
  rate_limit_rpm: number | null;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  remoteVersion: string;
  installedVersion: string | null;
  status: "available" | "installed" | "updatable";
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  secrets?: Record<string, { required: boolean; description: string; env?: string }>;
  source: "official" | "community" | "custom";
  sourceLabel: string;
}

export interface MarketplaceSource {
  url: string;
  label: string;
  enabled: boolean;
  isOfficial: boolean;
}

export interface SecretDeclaration {
  required: boolean;
  description: string;
  env?: string;
}

export interface PluginSecretsInfo {
  declared: Record<string, SecretDeclaration>;
  configured: string[];
}

// ── Hook test types ─────────────────────────────────────────────────

export interface HookTraceStep {
  step: string;
  detail?: string;
  matched: boolean;
}

export interface HookTestResult {
  blocked: boolean;
  blockResponse: string;
  triggeredHooks: Array<{ keyword: string; context: string }>;
  injectedContext: string;
  trace: HookTraceStep[];
}

// ── Sessions types ──────────────────────────────────────────────────

export interface SessionListItem {
  sessionId: string;
  chatId: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  chatType: string | null;
  chatTitle: string | null;
  chatUsername: string | null;
}

export interface SessionMessage {
  id: string;
  senderId: string | null;
  senderUsername: string | null;
  senderName: string | null;
  text: string | null;
  isFromAgent: boolean;
  isEdited: boolean;
  hasMedia: boolean;
  mediaType: string | null;
  timestamp: number;
  replyToId: string | null;
}

export interface SessionSearchResult {
  messageId: string;
  text: string;
  isFromAgent: boolean;
  timestamp: number;
  chatId: string;
  sessionId: string | null;
  chatType: string | null;
  chatTitle: string | null;
  score: number;
}

export interface CorrectionEvaluation {
  score: number;
  feedback: string;
  criteria: {
    completeness: number;
    correctness: number;
    toolUsage: number;
    formatting: number;
  };
  issues: string[];
  needsCorrection: boolean;
}

export interface CorrectionLogEntry {
  id: string;
  sessionId: string;
  taskId: string | null;
  chatId: string;
  iteration: number;
  originalOutput: string;
  evaluation: CorrectionEvaluation;
  reflection: {
    summary: string;
    instructions: string[];
    focusAreas: string[];
  } | null;
  correctedOutput: string | null;
  score: number;
  correctedScore: number | null;
  scoreDelta: number;
  threshold: number;
  escalated: boolean;
  toolRecoveries: Array<{
    toolName: string;
    error: string;
    kind: string;
    retryable: boolean;
    guidance: string;
    adaptedParams?: Record<string, unknown>;
  }>;
  feedback: string;
  createdAt: number;
}

// ── Autonomous Task types ───────────────────────────────────────────

export type AutonomousTaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AutonomousStrategy = "conservative" | "balanced" | "aggressive";
export type AutonomousPriority = "low" | "medium" | "high" | "critical";
export type AutonomousEventType =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "reflect"
  | "checkpoint"
  | "escalate"
  | "error"
  | "info";

export interface AutonomousConstraints {
  maxIterations?: number;
  maxDurationHours?: number;
  allowedTools?: string[];
  restrictedTools?: string[];
  budgetTON?: number;
}

export interface AutonomousRetryPolicy {
  maxRetries: number;
  backoff: "linear" | "exponential";
}

export interface AutonomousTaskData {
  id: string;
  goal: string;
  successCriteria: string[];
  failureConditions: string[];
  constraints: AutonomousConstraints;
  strategy: AutonomousStrategy;
  retryPolicy: AutonomousRetryPolicy;
  context: Record<string, unknown>;
  priority: AutonomousPriority;
  status: AutonomousTaskStatus;
  currentStep: number;
  lastCheckpointId?: string;
  createdAt: string;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result?: string;
  error?: string;
}

export interface AutonomousExecutionLog {
  id: number;
  taskId: string;
  step: number;
  eventType: AutonomousEventType;
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface AutonomousTaskDetail extends AutonomousTaskData {
  lastCheckpoint: {
    id: string;
    step: number;
    nextActionHint?: string;
    createdAt: string;
  } | null;
  executionLogs: AutonomousExecutionLog[];
}

export interface AutonomousCreateInput {
  goal: string;
  successCriteria?: string[];
  failureConditions?: string[];
  constraints?: AutonomousConstraints;
  strategy?: AutonomousStrategy;
  retryPolicy?: AutonomousRetryPolicy;
  context?: Record<string, unknown>;
  priority?: AutonomousPriority;
}

export interface AutonomousParsedGoal {
  goal: string;
  successCriteria: string[];
  failureConditions: string[];
  constraints: AutonomousConstraints;
  suggestedStrategy: AutonomousStrategy;
  suggestedPriority: AutonomousPriority;
  confidence: number;
}

// ── API response wrapper ────────────────────────────────────────────

interface APIResponse<T> {
  success: boolean;
  data: T;
}

// ── Health Check types ──────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unconfigured";

export interface HealthCheck {
  status: HealthStatus;
  latency_ms?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResponse {
  status: HealthStatus;
  checks: {
    agent: HealthCheck;
    database: HealthCheck;
    disk: HealthCheck;
    memory: HealthCheck;
    mcp: HealthCheck;
  };
  checked_at: string;
}

// ── Export/Import types ─────────────────────────────────────────────

export interface ConfigBundle {
  version: "1.0";
  exported_at: string;
  app_version: string;
  config: Record<string, unknown>;
  hooks: {
    blocklist: unknown;
    triggers: unknown;
    rules: unknown;
  };
  soul: Record<string, string>;
}

export interface SelfImprovementTargetRepo {
  id: string;
  name: string;
  lastScan: number | null;
  issueCount: number;
  enabled: boolean;
}

export interface SelfImprovementScanScope {
  source_code: boolean;
  config_files: boolean;
  dependencies: boolean;
  documentation: boolean;
  exclude_paths: string;
}

export interface SelfImprovementAutomationSettings {
  auto_create_prs: boolean;
  fix_severity: "critical" | "critical_high" | "all";
  branch_prefix: string;
  draft_pr: boolean;
  run_tests: boolean;
  auto_merge: boolean;
}

export interface SelfImprovementConfig {
  selected_plugin: string;
  guide_url: string;
  target_repo: string;
  focus_areas: string[];
  auto_create_issues: boolean;
  schedule_enabled: boolean;
  schedule_interval_hours: number;
  require_approval: boolean;
  automation: SelfImprovementAutomationSettings;
  targets: SelfImprovementTargetRepo[];
  scan_scope: SelfImprovementScanScope;
}

export interface SelfImprovementAnalysisEntry {
  id: number;
  timestamp: number;
  repo: string;
  branch: string;
  files_analyzed: number;
  issues_found: number;
  issues_created: number;
  summary: string | null;
}

export interface SelfImprovementTask {
  id: number;
  analysis_id: number | null;
  task_type: string;
  priority: string;
  file_path: string | null;
  description: string;
  suggestion: string | null;
  code_snippet: string | null;
  status: string;
  created_at: number;
  github_issue_url: string | null;
}

// ── Fetch helpers ───────────────────────────────────────────────────

async function fetchSetupAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data !== undefined ? json.data : json;
}

/** Read a cookie value by name from document.cookie (browser only). */
function getCookieValue(name: string): string | null {
  const prefix = name + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trimStart();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const method = options?.method?.toUpperCase() ?? "GET";
  const csrfToken = MUTATION_METHODS.has(method) ? getCookieValue("teleton_csrf") : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: "include", // send HttpOnly cookie automatically
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Auth ────────────────────────────────────────────────────────────

/** Check if session cookie is valid */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch("/auth/check", { credentials: "include" });
    const data = await res.json();
    return data.success && data.data?.authenticated;
  } catch {
    return false;
  }
}

/** Login with token — server sets HttpOnly cookie */
export async function login(token: string): Promise<boolean> {
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Logout — server clears cookie */
export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
}

// ── API methods ─────────────────────────────────────────────────────

export const api = {
  async getStatus() {
    return fetchAPI<APIResponse<StatusData>>("/status");
  },

  async getTools() {
    return fetchAPI<APIResponse<ModuleInfo[]>>("/tools");
  },

  async getMemoryStats() {
    return fetchAPI<APIResponse<MemoryStats>>("/memory/stats");
  },

  async searchKnowledge(query: string, limit = 10) {
    return fetchAPI<APIResponse<SearchResult[]>>(
      `/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  },

  async getMemorySources() {
    return fetchAPI<APIResponse<MemorySourceFile[]>>("/memory/sources");
  },

  async getSourceChunks(sourceKey: string) {
    return fetchAPI<APIResponse<MemoryChunk[]>>(`/memory/sources/${encodeURIComponent(sourceKey)}`);
  },

  async syncVectorMemory() {
    return fetchAPI<APIResponse<MemoryVectorSyncResult>>("/memory/sync-vector", {
      method: "POST",
    });
  },

  async getMemoryPriority() {
    return fetchAPI<APIResponse<MemoryPriorityData>>("/memory/scores/stats");
  },

  async pinMemory(memoryId: string, pinned: boolean) {
    return fetchAPI<APIResponse<MemoryScoreInfo>>(
      `/memory/scores/${encodeURIComponent(memoryId)}/pin`,
      {
        method: "POST",
        body: JSON.stringify({ pinned }),
      }
    );
  },

  async cleanupMemory(dryRun: boolean) {
    return fetchAPI<APIResponse<MemoryCleanupResult>>(`/memory/cleanup?dry_run=${dryRun}`, {
      method: "POST",
    });
  },

  async getMemoryGraph(params?: { type?: string; q?: string; limit?: number }) {
    const search = new URLSearchParams();
    if (params?.type) search.set("type", params.type);
    if (params?.q) search.set("q", params.q);
    if (params?.limit) search.set("limit", String(params.limit));
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return fetchAPI<APIResponse<MemoryGraphData>>(`/memory/graph/nodes${suffix}`);
  },

  async getMemoryGraphRelated(id: string, depth = 2) {
    return fetchAPI<APIResponse<MemoryGraphData>>(
      `/memory/graph/node/${encodeURIComponent(id)}/related?depth=${depth}`
    );
  },

  async getMemoryGraphPath(from: string, to: string) {
    return fetchAPI<APIResponse<MemoryGraphData>>(
      `/memory/graph/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
  },

  async getSoulFile(filename: string) {
    return fetchAPI<APIResponse<{ content: string }>>(`/soul/${filename}`);
  },

  async updateSoulFile(filename: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/soul/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  },

  async listSoulVersions(filename: string) {
    return fetchAPI<APIResponse<SoulVersionMeta[]>>(`/soul/${filename}/versions`);
  },

  async saveSoulVersion(filename: string, content: string, comment?: string) {
    return fetchAPI<APIResponse<SoulVersionMeta>>(`/soul/${filename}/versions`, {
      method: "POST",
      body: JSON.stringify({ content, comment }),
    });
  },

  async getSoulVersion(filename: string, id: number) {
    return fetchAPI<APIResponse<SoulVersion>>(`/soul/${filename}/versions/${id}`);
  },

  async deleteSoulVersion(filename: string, id: number) {
    return fetchAPI<APIResponse<{ message: string }>>(`/soul/${filename}/versions/${id}`, {
      method: "DELETE",
    });
  },

  async getPlugins() {
    return fetchAPI<APIResponse<PluginManifest[]>>("/plugins");
  },

  async getPluginPriorities() {
    return fetchAPI<APIResponse<Record<string, number>>>("/plugins/priorities");
  },

  async setPluginPriority(pluginName: string, priority: number) {
    return fetchAPI<APIResponse<{ pluginName: string; priority: number }>>("/plugins/priorities", {
      method: "POST",
      body: JSON.stringify({ pluginName, priority }),
    });
  },

  async resetPluginPriority(pluginName: string) {
    return fetchAPI<APIResponse<null>>(`/plugins/priorities/${encodeURIComponent(pluginName)}`, {
      method: "DELETE",
    });
  },

  async getToolRag() {
    return fetchAPI<APIResponse<ToolRagStatus>>("/tools/rag");
  },

  async updateToolRag(config: {
    enabled?: boolean;
    topK?: number;
    alwaysInclude?: string[];
    skipUnlimitedProviders?: boolean;
  }) {
    return fetchAPI<APIResponse<ToolRagStatus>>("/tools/rag", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  async getMcpServers() {
    return fetchAPI<APIResponse<McpServerInfo[]>>("/mcp");
  },

  async addMcpServer(data: {
    package?: string;
    url?: string;
    name?: string;
    args?: string[];
    scope?: string;
    env?: Record<string, string>;
  }) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>("/mcp", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async removeMcpServer(name: string) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>(
      `/mcp/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      }
    );
  },

  async getIntegrations() {
    return fetchAPI<APIResponse<IntegrationEntity[]>>("/integrations");
  },

  async getIntegrationCatalog() {
    return fetchAPI<APIResponse<IntegrationCatalogEntry[]>>("/integrations/catalog");
  },

  async createIntegration(data: {
    id?: string;
    name: string;
    type: IntegrationType;
    provider: string;
    auth?: IntegrationAuthConfig;
    config?: IntegrationConfig;
    healthCheckUrl?: string | null;
  }) {
    return fetchAPI<APIResponse<IntegrationEntity>>("/integrations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateIntegration(id: string, data: Partial<IntegrationEntity>) {
    return fetchAPI<APIResponse<IntegrationEntity>>(`/integrations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteIntegration(id: string) {
    return fetchAPI<APIResponse<null>>(`/integrations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async checkIntegrationHealth(id: string) {
    return fetchAPI<APIResponse<IntegrationHealth>>(
      `/integrations/${encodeURIComponent(id)}/health`
    );
  },

  async executeIntegration(id: string, action: string, params: Record<string, unknown>) {
    return fetchAPI<APIResponse<IntegrationResult>>(
      `/integrations/${encodeURIComponent(id)}/execute`,
      {
        method: "POST",
        body: JSON.stringify({ action, params }),
      }
    );
  },

  async getIntegrationCredentials(id: string) {
    return fetchAPI<APIResponse<IntegrationCredential[]>>(
      `/integrations/${encodeURIComponent(id)}/credentials`
    );
  },

  async createIntegrationCredential(
    id: string,
    data: {
      authType: IntegrationAuthType;
      credentials: Record<string, unknown>;
      expiresAt?: number | null;
    }
  ) {
    return fetchAPI<APIResponse<IntegrationCredential>>(
      `/integrations/${encodeURIComponent(id)}/credentials`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  async updateToolConfig(
    toolName: string,
    config: { enabled?: boolean; scope?: "always" | "dm-only" | "group-only" | "admin-only" }
  ) {
    return fetchAPI<APIResponse<ToolConfigData>>(`/tools/${toolName}`, {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  async getToolsStats() {
    return fetchAPI<APIResponse<Record<string, ToolUsageStats>>>("/tools/stats");
  },

  async getToolDetails(toolName: string) {
    return fetchAPI<APIResponse<ToolDetails>>(`/tools/${encodeURIComponent(toolName)}/details`);
  },

  async testTool(toolName: string, params: Record<string, unknown>) {
    return fetchAPI<APIResponse<{ success: boolean; data?: unknown; error?: string }>>(
      `/tools/${encodeURIComponent(toolName)}/test`,
      {
        method: "POST",
        body: JSON.stringify({ params }),
      }
    );
  },

  async workspaceList(_path = "", _recursive = false) {
    const params = new URLSearchParams();
    if (_path) params.set("path", _path);
    if (_recursive) params.set("recursive", "true");
    const qs = params.toString();
    return fetchAPI<APIResponse<{ entries: FileEntry[]; truncated?: boolean }>>(
      `/workspace${qs ? `?${qs}` : ""}`
    );
  },

  async workspaceRead(path: string) {
    return fetchAPI<APIResponse<{ content: string; size: number }>>(
      `/workspace/read?path=${encodeURIComponent(path)}`
    );
  },

  async workspaceWrite(path: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  },

  async workspaceMkdir(path: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/mkdir", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },

  async workspaceDelete(path: string, recursive = false) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace", {
      method: "DELETE",
      body: JSON.stringify({ path, recursive }),
    });
  },

  async workspaceRename(from: string, to: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/rename", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
  },

  async workspaceInfo() {
    return fetchAPI<APIResponse<WorkspaceInfo>>("/workspace/info");
  },

  workspaceRawUrl(path: string): string {
    return `/api/workspace/raw?path=${encodeURIComponent(path)}`;
  },

  async tasksList(_status?: string) {
    const qs = _status ? `?status=${_status}` : "";
    return fetchAPI<APIResponse<TaskData[]>>(`/tasks${qs}`);
  },

  async tasksGet(id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${id}`);
  },

  async tasksCorrections(id: string) {
    return fetchAPI<APIResponse<{ corrections: CorrectionLogEntry[] }>>(
      `/tasks/${encodeURIComponent(id)}/corrections`
    );
  },

  async tasksDelete(_id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/tasks/${_id}`, { method: "DELETE" });
  },

  async tasksCancel(_id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${_id}/cancel`, { method: "POST" });
  },

  async tasksClean(status: string) {
    return fetchAPI<APIResponse<{ deleted: number }>>("/tasks/clean", {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  },

  async tasksCleanDone() {
    return fetchAPI<APIResponse<{ deleted: number }>>("/tasks/clean-done", { method: "POST" });
  },

  async tasksDecompose(
    id: string,
    data?: { parentId?: string | null; subtasks?: SubtaskPlanInput[] }
  ) {
    return fetchAPI<
      APIResponse<{
        subtasks: TaskSubtaskData[];
        tree: TaskDelegationTreeData;
      }>
    >(`/tasks/${encodeURIComponent(id)}/decompose`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    });
  },

  async tasksSubtasks(id: string) {
    return fetchAPI<APIResponse<{ subtasks: TaskSubtaskData[] }>>(
      `/tasks/${encodeURIComponent(id)}/subtasks`
    );
  },

  async tasksTree(id: string) {
    return fetchAPI<APIResponse<TaskDelegationTreeData>>(`/tasks/${encodeURIComponent(id)}/tree`);
  },

  async tasksDelegate(
    id: string,
    data: {
      subtaskId?: string;
      agentId: string;
      description?: string;
      requiredSkills?: string[];
      requiredTools?: string[];
    }
  ) {
    return fetchAPI<
      APIResponse<{
        subtask: TaskSubtaskData;
        tree: TaskDelegationTreeData;
      }>
    >(`/tasks/${encodeURIComponent(id)}/delegate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async tasksRetrySubtask(id: string, subtaskId: string, data?: { agentId?: string }) {
    return fetchAPI<
      APIResponse<{
        subtask: TaskSubtaskData;
        tree: TaskDelegationTreeData;
      }>
    >(`/tasks/${encodeURIComponent(id)}/subtasks/${encodeURIComponent(subtaskId)}/retry`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    });
  },

  async getConfigKeys() {
    return fetchAPI<APIResponse<ConfigKeyData[]>>("/config");
  },

  async setConfigKey(key: string, value: string | string[]) {
    return fetchAPI<APIResponse<ConfigKeyData>>(`/config/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  },

  async unsetConfigKey(key: string) {
    return fetchAPI<APIResponse<ConfigKeyData>>(`/config/${key}`, {
      method: "DELETE",
    });
  },

  async getModelsForProvider(provider: string) {
    return fetchAPI<APIResponse<Array<{ value: string; name: string; description: string }>>>(
      `/config/models/${encodeURIComponent(provider)}`
    );
  },

  async getProviderMeta(provider: string) {
    return fetchAPI<
      APIResponse<{
        needsKey: boolean;
        keyHint: string;
        keyPrefix: string | null;
        consoleUrl: string;
        displayName: string;
      }>
    >(`/config/provider-meta/${encodeURIComponent(provider)}`);
  },

  async validateApiKey(provider: string, apiKey: string) {
    return fetchAPI<APIResponse<{ valid: boolean; error: string | null }>>(
      "/config/validate-api-key",
      {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      }
    );
  },

  async getMarketplace(_refresh = false) {
    const qs = _refresh ? "?refresh=true" : "";
    return fetchAPI<APIResponse<MarketplacePlugin[]>>(`/marketplace${qs}`);
  },

  async installPlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>(
      "/marketplace/install",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    );
  },

  async uninstallPlugin(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/marketplace/uninstall", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },

  async updatePlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>(
      "/marketplace/update",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    );
  },

  async getPluginSecrets(pluginId: string) {
    return fetchAPI<APIResponse<PluginSecretsInfo>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}`
    );
  },

  async setPluginSecret(pluginId: string, key: string, value: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ value }),
      }
    );
  },

  async unsetPluginSecret(pluginId: string, key: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`,
      {
        method: "DELETE",
      }
    );
  },

  async getMarketplaceSources() {
    return fetchAPI<APIResponse<MarketplaceSource[]>>("/marketplace/sources");
  },

  async addMarketplaceSource(url: string, label?: string) {
    return fetchAPI<APIResponse<MarketplaceSource>>("/marketplace/sources", {
      method: "POST",
      body: JSON.stringify({ url, label }),
    });
  },

  async removeMarketplaceSource(url: string) {
    return fetchAPI<APIResponse<{ url: string }>>("/marketplace/sources", {
      method: "DELETE",
      body: JSON.stringify({ url }),
    });
  },

  async toggleMarketplaceSource(url: string, enabled: boolean) {
    return fetchAPI<APIResponse<{ url: string; enabled: boolean }>>("/marketplace/sources", {
      method: "PATCH",
      body: JSON.stringify({ url, enabled }),
    });
  },

  // ── Hooks ─────────────────────────────────────────────────────────

  async getBlocklist() {
    return fetchAPI<APIResponse<{ enabled: boolean; keywords: string[]; message: string }>>(
      "/hooks/blocklist"
    );
  },

  async updateBlocklist(config: { enabled: boolean; keywords: string[]; message: string }) {
    return fetchAPI<APIResponse<{ enabled: boolean; keywords: string[]; message: string }>>(
      "/hooks/blocklist",
      {
        method: "PUT",
        body: JSON.stringify(config),
      }
    );
  },

  async getTriggers() {
    return fetchAPI<
      APIResponse<Array<{ id: string; keyword: string; context: string; enabled: boolean }>>
    >("/hooks/triggers");
  },

  async createTrigger(data: { keyword: string; context: string; enabled?: boolean }) {
    return fetchAPI<
      APIResponse<{ id: string; keyword: string; context: string; enabled: boolean }>
    >("/hooks/triggers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateTrigger(id: string, data: { keyword?: string; context?: string; enabled?: boolean }) {
    return fetchAPI<
      APIResponse<{ id: string; keyword: string; context: string; enabled: boolean }>
    >(`/hooks/triggers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteTrigger(id: string) {
    return fetchAPI<APIResponse<null>>(`/hooks/triggers/${id}`, { method: "DELETE" });
  },

  async toggleTrigger(id: string, enabled: boolean) {
    return fetchAPI<APIResponse<{ id: string; enabled: boolean }>>(`/hooks/triggers/${id}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  },

  // ── Structured Rules (Visual Rule Builder) ────────────────────────

  async getRules() {
    return fetchAPI<APIResponse<StructuredRule[]>>("/hooks/rules");
  },

  async createRule(data: { name: string; enabled?: boolean; blocks: RuleBlock[] }) {
    return fetchAPI<APIResponse<StructuredRule>>("/hooks/rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateRule(id: string, data: Partial<StructuredRule>) {
    return fetchAPI<APIResponse<StructuredRule>>(`/hooks/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteRule(id: string) {
    return fetchAPI<APIResponse<null>>(`/hooks/rules/${id}`, { method: "DELETE" });
  },

  async reorderRules(ids: string[]) {
    return fetchAPI<APIResponse<StructuredRule[]>>("/hooks/rules/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
  },

  async testHooks(message: string) {
    return fetchAPI<APIResponse<HookTestResult>>("/hooks/test", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  },

  // ── Groq Multi-Modal ──────────────────────────────────────────────

  async getGroqModels(type?: "text" | "stt" | "tts") {
    const qs = type ? `?type=${type}` : "";
    return fetchAPI<
      APIResponse<
        Array<{
          id: string;
          type: string;
          displayName: string;
          rpm: number;
          tpm: number;
          tpd: number;
        }>
      >
    >(`/groq/models${qs}`);
  },

  async getGroqSttModels() {
    return fetchAPI<APIResponse<Array<{ value: string; name: string; description: string }>>>(
      "/groq/models/stt"
    );
  },

  async getGroqTtsModels() {
    return fetchAPI<APIResponse<Array<{ value: string; name: string; description: string }>>>(
      "/groq/models/tts"
    );
  },

  async getGroqTtsVoices(model?: string) {
    const qs = model ? `?model=${encodeURIComponent(model)}` : "";
    return fetchAPI<APIResponse<string[]>>(`/groq/tts/voices${qs}`);
  },

  async testGroqKey(apiKey?: string) {
    return fetchAPI<APIResponse<{ valid: boolean }>>("/groq/test", {
      method: "POST",
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    });
  },

  async getGroqDebug() {
    return fetchAPI<
      APIResponse<{
        baseURL: string;
        authHeaderShape: string;
        apiKeyConfigured: boolean;
        apiKeyPrefix: string | null;
        apiKeyLength: number;
        apiKeyFormatValid: boolean;
        registeredModels: { text: number; stt: number; tts: number };
        troubleshooting: string | null;
      }>
    >("/groq/debug");
  },

  async getGroqHealth() {
    return fetchAPI<
      APIResponse<{
        status: "ok" | "warn" | "error";
        checks: Record<string, { status: "ok" | "warn" | "error"; message: string }>;
        baseURL: string;
        timestamp: string;
      }>
    >("/groq/health");
  },

  // ── MTProto Proxy ─────────────────────────────────────────────────

  async getMtprotoConfig() {
    return fetchAPI<
      APIResponse<{
        enabled: boolean;
        proxies: Array<{ server: string; port: number; secret: string }>;
      }>
    >("/mtproto");
  },

  async setMtprotoEnabled(enabled: boolean) {
    return fetchAPI<APIResponse<{ enabled: boolean }>>("/mtproto/enabled", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  },

  async setMtprotoProxies(proxies: Array<{ server: string; port: number; secret: string }>) {
    return fetchAPI<
      APIResponse<{ proxies: Array<{ server: string; port: number; secret: string }> }>
    >("/mtproto/proxies", {
      method: "PUT",
      body: JSON.stringify({ proxies }),
    });
  },

  async getMtprotoStatus() {
    return fetchAPI<
      APIResponse<{
        connected: boolean;
        enabled: boolean;
        activeProxy: { server: string; port: number; index: number } | null;
      }>
    >("/mtproto/status");
  },

  // ── TON Proxy ──────────────────────────────────────────────────────

  async getTonProxyStatus() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy");
  },

  async startTonProxy() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy/start", { method: "POST" });
  },

  async stopTonProxy() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy/stop", { method: "POST" });
  },

  async uninstallTonProxy() {
    return fetchAPI<
      APIResponse<{ running: boolean; installed: boolean; port: number; enabled: boolean }>
    >("/ton-proxy/uninstall", { method: "POST" });
  },

  // ── Notifications ─────────────────────────────────────────────────

  async getNotifications(unreadOnly = false) {
    const qs = unreadOnly ? "?unread=true" : "";
    return fetchAPI<APIResponse<NotificationData[]>>(`/notifications${qs}`);
  },

  async getUnreadCount() {
    return fetchAPI<APIResponse<{ count: number }>>("/notifications/unread-count");
  },

  async markNotificationRead(id: string) {
    return fetchAPI<APIResponse<{ count: number }>>(`/notifications/${id}/read`, {
      method: "PATCH",
    });
  },

  async markAllNotificationsRead() {
    return fetchAPI<APIResponse<{ changed: number; count: number }>>("/notifications/read-all", {
      method: "POST",
    });
  },

  async deleteNotification(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/notifications/${id}`, { method: "DELETE" });
  },

  connectNotifications(onCount: (count: number) => void) {
    const url = `${API_BASE}/notifications/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener("unread-count", (event) => {
      try {
        const data = JSON.parse(event.data);
        onCount(data.count);
      } catch {
        // ignore parse errors
      }
    });

    return () => eventSource.close();
  },

  // ── Metrics ───────────────────────────────────────────────────────

  async getTokenMetrics(period: MetricsPeriod = "24h") {
    return fetchAPI<APIResponse<TokenDataPoint[]>>(`/metrics/tokens?period=${period}`);
  },

  async getToolMetrics(period: MetricsPeriod = "7d") {
    return fetchAPI<APIResponse<ToolUsageEntry[]>>(`/metrics/tools?period=${period}`);
  },

  async getActivityMetrics(period: MetricsPeriod = "30d") {
    return fetchAPI<APIResponse<ActivityEntry[]>>(`/metrics/activity?period=${period}`);
  },

  // ── Analytics ────────────────────────────────────────────────────

  async getAnalyticsUsage(period: MetricsPeriod = "7d") {
    return fetchAPI<APIResponse<TokenDataPoint[]>>(`/analytics/usage?period=${period}`);
  },

  async getAnalyticsTools(period: MetricsPeriod = "7d") {
    return fetchAPI<APIResponse<ToolUsageEntry[]>>(`/analytics/tools?period=${period}`);
  },

  async getAnalyticsHeatmap(period: MetricsPeriod = "30d") {
    return fetchAPI<APIResponse<ActivityEntry[]>>(`/analytics/heatmap?period=${period}`);
  },

  async getAnalyticsPerformance(period: MetricsPeriod = "7d") {
    return fetchAPI<APIResponse<AnalyticsPerformanceData>>(
      `/analytics/performance?period=${period}`
    );
  },

  async getAnalyticsCost(period: MetricsPeriod = "30d") {
    return fetchAPI<APIResponse<AnalyticsCostData>>(`/analytics/cost?period=${period}`);
  },

  async getAnalyticsBudget() {
    return fetchAPI<APIResponse<BudgetStatus>>("/analytics/budget");
  },

  async setAnalyticsBudget(monthly_limit_usd: number | null) {
    return fetchAPI<APIResponse<BudgetStatus>>("/analytics/budget", {
      method: "PUT",
      body: JSON.stringify({ monthly_limit_usd }),
    });
  },

  // ── Temporal Context ─────────────────────────────────────────────

  async getTemporalContext() {
    return fetchAPI<APIResponse<TemporalContextData>>("/context/temporal");
  },

  async getTemporalPatterns(includeDisabled = true) {
    return fetchAPI<APIResponse<TemporalPattern[]>>(
      `/context/patterns?includeDisabled=${includeDisabled ? "true" : "false"}`
    );
  },

  async updateTemporalPattern(id: string, data: Partial<Pick<TemporalPattern, "enabled">>) {
    return fetchAPI<APIResponse<TemporalPattern>>(`/context/patterns/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getTemporalTimeline(limit = 20) {
    return fetchAPI<APIResponse<TemporalTimelineEntry[]>>(`/context/timeline?limit=${limit}`);
  },

  // ── Cache ────────────────────────────────────────────────────────

  async getCacheStats() {
    return fetchAPI<APIResponse<CacheStats>>("/cache/stats");
  },

  async warmCache(input: CacheWarmInput = {}) {
    return fetchAPI<APIResponse<CacheWarmResult>>("/cache/warm", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async invalidateCache(input: { key?: string; type?: CacheResourceType }) {
    const params = new URLSearchParams();
    if (input.key) params.set("key", input.key);
    if (input.type) params.set("type", input.type);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return fetchAPI<APIResponse<{ invalidated: number }>>(`/cache/invalidate${suffix}`, {
      method: "POST",
    });
  },

  async deleteCache() {
    return fetchAPI<APIResponse<{ cleared: string[]; message: string }>>("/cache", {
      method: "DELETE",
    });
  },

  // ── Anomalies ────────────────────────────────────────────────────

  async getAnomalies(
    opts: {
      period?: MetricsPeriod;
      severity?: AnomalySeverity;
      acknowledged?: boolean;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (opts.period) params.set("period", opts.period);
    if (opts.severity) params.set("severity", opts.severity);
    if (opts.acknowledged !== undefined) params.set("acknowledged", String(opts.acknowledged));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return fetchAPI<APIResponse<AnomalyEvent[]>>(`/anomalies${suffix}`);
  },

  async getAnomalyBaselines() {
    return fetchAPI<APIResponse<AnomalyBaseline[]>>("/anomalies/baselines");
  },

  async getAnomalyStats(period: MetricsPeriod = "24h") {
    return fetchAPI<APIResponse<AnomalyStats>>(`/anomalies/stats?period=${period}`);
  },

  async acknowledgeAnomaly(id: string) {
    return fetchAPI<APIResponse<AnomalyEvent>>(`/anomalies/${encodeURIComponent(id)}/acknowledge`, {
      method: "POST",
    });
  },

  // ── Predictions ──────────────────────────────────────────────────

  async getPredictions(endpoint: PredictionEndpoint, context?: string) {
    const params = new URLSearchParams();
    if (context) params.set("context", context);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return fetchAPI<APIResponse<PredictionSuggestion[]>>(`/predictions/${endpoint}${suffix}`);
  },

  async sendPredictionFeedback(input: {
    endpoint: PredictionEndpoint;
    action: string;
    confidence?: number;
    reason?: string;
    helpful: boolean;
  }) {
    return fetchAPI<APIResponse<{ recorded: true }>>("/predictions/feedback", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async executePrediction(input: {
    endpoint: PredictionEndpoint;
    action: string;
    confidence?: number;
    reason?: string;
  }) {
    return fetchAPI<APIResponse<TaskData>>("/predictions/execute", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // ── Security ──────────────────────────────────────────────────────

  async getAuditLog(
    opts: {
      page?: number;
      limit?: number;
      type?: AuditActionType | null;
      since?: number | null;
      until?: number | null;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (opts.page) params.set("page", String(opts.page));
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.type) params.set("type", opts.type);
    if (opts.since != null) params.set("since", String(opts.since));
    if (opts.until != null) params.set("until", String(opts.until));
    return fetchAPI<APIResponse<AuditLogPage>>(`/security/audit?${params}`);
  },

  getAuditExportUrl(
    opts: {
      type?: AuditActionType | null;
      since?: number | null;
      until?: number | null;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (opts.type) params.set("type", opts.type);
    if (opts.since != null) params.set("since", String(opts.since));
    if (opts.until != null) params.set("until", String(opts.until));
    return `${API_BASE}/security/audit/export?${params}`;
  },

  async getSecuritySettings() {
    return fetchAPI<APIResponse<SecuritySettings>>("/security/settings");
  },

  async updateSecuritySettings(patch: Partial<SecuritySettings>) {
    return fetchAPI<APIResponse<SecuritySettings>>("/security/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  connectLogs(onLog: (entry: LogEntry) => void, onError?: (error: Event) => void) {
    const url = `${API_BASE}/logs/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener("log", (event) => {
      try {
        const entry = JSON.parse(event.data);
        onLog(entry);
      } catch (error) {
        console.error("Failed to parse log entry:", error);
      }
    });

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    return () => eventSource.close();
  },

  // ── Sessions ──────────────────────────────────────────────────────

  async listSessions(page = 1, limit = 20, filters?: { chatType?: string; q?: string }) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters?.chatType) params.set("chat_type", filters.chatType);
    if (filters?.q) params.set("q", filters.q);
    return fetchAPI<
      APIResponse<{ sessions: SessionListItem[]; total: number; page: number; limit: number }>
    >(`/sessions?${params}`);
  },

  async getSession(sessionId: string) {
    return fetchAPI<APIResponse<SessionListItem>>(`/sessions/${encodeURIComponent(sessionId)}`);
  },

  async getSessionMessages(sessionId: string, page = 1, limit = 50) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return fetchAPI<
      APIResponse<{ messages: SessionMessage[]; total: number; page: number; limit: number }>
    >(`/sessions/${encodeURIComponent(sessionId)}/messages?${params}`);
  },

  async getSessionCorrections(sessionId: string) {
    return fetchAPI<APIResponse<{ corrections: CorrectionLogEntry[] }>>(
      `/sessions/${encodeURIComponent(sessionId)}/corrections`
    );
  },

  async deleteSession(sessionId: string) {
    return fetchAPI<APIResponse<{ message: string }>>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    );
  },

  getSessionExportUrl(sessionId: string, format: "json" | "md" = "json") {
    return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`;
  },

  async searchSessionMessages(query: string, limit = 20) {
    return fetchAPI<APIResponse<SessionSearchResult[]>>(
      `/sessions/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  },

  // ── Quick Actions ──────────────────────────────────────────────────

  async clearCache() {
    return fetchAPI<APIResponse<{ cleared: string[]; message: string }>>("/cache/clear", {
      method: "POST",
    });
  },

  async sendTestMessage() {
    return fetchAPI<APIResponse<{ message: string; targetId: number }>>(
      "/agent-actions/test/message",
      { method: "POST" }
    );
  },

  async triggerHeartbeat() {
    return fetchAPI<APIResponse<{ content: string; suppressed: boolean; sentToTelegram: boolean }>>(
      "/agent-actions/heartbeat/trigger",
      { method: "POST" }
    );
  },

  // ── Self-Improvement ───────────────────────────────────────────────

  async getSelfImprovementConfig() {
    return fetchAPI<APIResponse<SelfImprovementConfig>>("/self-improvement/config");
  },

  async saveSelfImprovementConfig(config: Partial<SelfImprovementConfig>) {
    return fetchAPI<APIResponse<SelfImprovementConfig>>("/self-improvement/config", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  async triggerSelfImprovement() {
    return fetchAPI<APIResponse<{ message: string }>>("/self-improvement/trigger", {
      method: "POST",
    });
  },

  async getSelfImprovementStatus() {
    return fetchAPI<
      APIResponse<{
        installed: boolean;
        analysis_count?: number;
        pending_tasks?: number;
        last_analysis?: number | null;
      }>
    >("/self-improvement/status");
  },

  async getSelfImprovementAnalysis(limit = 20) {
    return fetchAPI<APIResponse<SelfImprovementAnalysisEntry[]>>(
      `/self-improvement/analysis?limit=${limit}`
    );
  },

  async getSelfImprovementTasks(
    status: "pending" | "created" | "dismissed" | "all" = "all",
    limit = 50
  ) {
    return fetchAPI<APIResponse<SelfImprovementTask[]>>(
      `/self-improvement/tasks?status=${status}&limit=${limit}`
    );
  },

  // ── Health Check ───────────────────────────────────────────────────

  async getHealthCheck() {
    return fetchAPI<APIResponse<HealthCheckResponse>>("/health-check");
  },

  // ── Export / Import ────────────────────────────────────────────────

  async exportConfig() {
    return fetchAPI<APIResponse<ConfigBundle>>("/export");
  },

  async importConfig(
    bundle: ConfigBundle,
    options?: { config?: boolean; hooks?: boolean; soul?: boolean }
  ) {
    return fetchAPI<APIResponse<{ applied: string[] }>>("/export/import", {
      method: "POST",
      body: JSON.stringify({ bundle, options }),
    });
  },

  // ── Workflows ──────────────────────────────────────────────────────

  async workflowsList() {
    return fetchAPI<APIResponse<WorkflowData[]>>("/workflows");
  },

  async workflowsGet(id: string) {
    return fetchAPI<APIResponse<WorkflowData>>(`/workflows/${id}`);
  },

  async workflowsCreate(data: {
    name: string;
    description?: string;
    enabled?: boolean;
    config: WorkflowConfig;
  }) {
    return fetchAPI<APIResponse<WorkflowData>>("/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async workflowsUpdate(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      config: WorkflowConfig;
    }>
  ) {
    return fetchAPI<APIResponse<WorkflowData>>(`/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async workflowsToggle(id: string, enabled: boolean) {
    return fetchAPI<APIResponse<{ id: string; enabled: boolean }>>(`/workflows/${id}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  },

  async workflowsDelete(id: string) {
    return fetchAPI<APIResponse<null>>(`/workflows/${id}`, { method: "DELETE" });
  },

  // ── Pipelines ─────────────────────────────────────────────────────

  async pipelinesList() {
    return fetchAPI<APIResponse<PipelineData[]>>("/pipelines");
  },

  async pipelinesGet(id: string) {
    return fetchAPI<APIResponse<PipelineData>>(`/pipelines/${id}`);
  },

  async pipelinesCreate(data: {
    name: string;
    description?: string | null;
    enabled?: boolean;
    steps: PipelineStepData[];
    errorStrategy?: PipelineErrorStrategy;
    maxRetries?: number;
    timeoutSeconds?: number | null;
  }) {
    return fetchAPI<APIResponse<PipelineData>>("/pipelines", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async pipelinesUpdate(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      steps: PipelineStepData[];
      errorStrategy: PipelineErrorStrategy;
      maxRetries: number;
      timeoutSeconds: number | null;
    }>
  ) {
    return fetchAPI<APIResponse<PipelineData>>(`/pipelines/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async pipelinesDelete(id: string) {
    return fetchAPI<APIResponse<null>>(`/pipelines/${id}`, { method: "DELETE" });
  },

  async pipelinesRun(
    id: string,
    data: { inputContext?: Record<string, unknown>; errorStrategy?: PipelineErrorStrategy } = {}
  ) {
    return fetchAPI<APIResponse<PipelineRunData>>(`/pipelines/${id}/run`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async pipelineRunsList(id: string, limit = 50) {
    return fetchAPI<APIResponse<PipelineRunData[]>>(`/pipelines/${id}/runs?limit=${limit}`);
  },

  async pipelineRunDetail(id: string, runId: string) {
    return fetchAPI<APIResponse<PipelineRunDetailData>>(`/pipelines/${id}/runs/${runId}`);
  },

  async pipelineRunCancel(id: string, runId: string) {
    return fetchAPI<APIResponse<PipelineRunData>>(`/pipelines/${id}/runs/${runId}/cancel`, {
      method: "POST",
    });
  },

  async agentStart() {
    return fetchAPI<{ state: string }>("/agent/start", { method: "POST" });
  },

  async agentStop() {
    return fetchAPI<{ state: string }>("/agent/stop", { method: "POST" });
  },

  async agentStatus() {
    return fetchAPI<{ state: string; uptime?: number; error?: string | null }>("/agent/status");
  },

  async listAgents() {
    return fetchAPI<APIResponse<{ agents: AgentOverview[] }>>("/agents");
  },

  async listAgentArchetypes() {
    return fetchAPI<APIResponse<{ archetypes: AgentArchetype[] }>>("/agents/archetypes");
  },

  async getAgent(id: string) {
    return fetchAPI<APIResponse<AgentOverview>>(`/agents/${encodeURIComponent(id)}`);
  },

  async createAgent(data: CreateAgentInput) {
    return fetchAPI<APIResponse<AgentOverview>>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async validateManagedBotToken(token: string) {
    return fetchAPI<APIResponse<BotValidation>>("/agents/validate-bot-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  async sendManagedPersonalCode(
    id: string,
    data: { apiId?: number; apiHash?: string; phone?: string }
  ) {
    return fetchAPI<APIResponse<AuthCodeResult>>(
      `/agents/${encodeURIComponent(id)}/personal-auth/send-code`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  async verifyManagedPersonalCode(id: string, authSessionId: string, code: string) {
    return fetchAPI<APIResponse<AuthVerifyResult>>(
      `/agents/${encodeURIComponent(id)}/personal-auth/verify-code`,
      {
        method: "POST",
        body: JSON.stringify({ authSessionId, code }),
      }
    );
  },

  async verifyManagedPersonalPassword(id: string, authSessionId: string, password: string) {
    return fetchAPI<APIResponse<AuthVerifyResult>>(
      `/agents/${encodeURIComponent(id)}/personal-auth/verify-password`,
      {
        method: "POST",
        body: JSON.stringify({ authSessionId, password }),
      }
    );
  },

  async resendManagedPersonalCode(id: string, authSessionId: string) {
    return fetchAPI<
      APIResponse<{
        codeDelivery: "app" | "sms" | "fragment";
        fragmentUrl?: string;
        codeLength?: number;
      }>
    >(`/agents/${encodeURIComponent(id)}/personal-auth/resend-code`, {
      method: "POST",
      body: JSON.stringify({ authSessionId }),
    });
  },

  async startManagedPersonalQr(
    id: string,
    data: { apiId?: number; apiHash?: string; phone?: string }
  ) {
    return fetchAPI<APIResponse<AuthQrResult>>(
      `/agents/${encodeURIComponent(id)}/personal-auth/qr-start`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  async refreshManagedPersonalQr(id: string, authSessionId: string) {
    return fetchAPI<APIResponse<AuthQrRefreshResult>>(
      `/agents/${encodeURIComponent(id)}/personal-auth/qr-refresh`,
      {
        method: "POST",
        body: JSON.stringify({ authSessionId }),
      }
    );
  },

  async cancelManagedPersonalAuth(id: string, authSessionId: string) {
    return fetchAPI<APIResponse<void>>(`/agents/${encodeURIComponent(id)}/personal-auth/session`, {
      method: "DELETE",
      body: JSON.stringify({ authSessionId }),
    });
  },

  async cloneAgent(
    id: string,
    data?: CreateAgentInput & {
      newId?: string;
    }
  ) {
    return fetchAPI<APIResponse<AgentOverview>>(`/agents/${encodeURIComponent(id)}/clone`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    });
  },

  async updateAgent(id: string, data: UpdateAgentInput) {
    return fetchAPI<APIResponse<AgentOverview>>(`/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async replaceAgent(id: string, data: UpdateAgentInput) {
    return fetchAPI<APIResponse<AgentOverview>>(`/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteAgent(id: string) {
    return fetchAPI<APIResponse<{ id: string }>>(`/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async startManagedAgent(id: string) {
    return fetchAPI<
      APIResponse<Pick<AgentOverview, "state" | "pid" | "startedAt" | "uptimeMs" | "lastError">>
    >(`/agents/${encodeURIComponent(id)}/start`, {
      method: "POST",
    });
  },

  async stopManagedAgent(id: string) {
    return fetchAPI<
      APIResponse<Pick<AgentOverview, "state" | "pid" | "startedAt" | "uptimeMs" | "lastError">>
    >(`/agents/${encodeURIComponent(id)}/stop`, {
      method: "POST",
    });
  },

  async getManagedAgentLogs(id: string, lines = 200) {
    return fetchAPI<APIResponse<AgentLogs>>(
      `/agents/${encodeURIComponent(id)}/logs?lines=${lines}`
    );
  },

  async getManagedAgentMessages(id: string, limit = 100) {
    return fetchAPI<APIResponse<{ messages: AgentMessage[] }>>(
      `/agents/${encodeURIComponent(id)}/messages?limit=${limit}`
    );
  },

  async sendManagedAgentMessage(id: string, data: { fromId?: string; text: string }) {
    return fetchAPI<APIResponse<AgentMessage>>(`/agents/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // ── Autonomous Task Engine ────────────────────────────────────────

  async autonomousList(status?: AutonomousTaskStatus) {
    const qs = status ? `?status=${status}` : "";
    return fetchAPI<APIResponse<AutonomousTaskData[]>>(`/autonomous${qs}`);
  },

  async autonomousGet(id: string) {
    return fetchAPI<APIResponse<AutonomousTaskDetail>>(`/autonomous/${id}`);
  },

  async autonomousCreate(data: AutonomousCreateInput) {
    return fetchAPI<APIResponse<AutonomousTaskData>>("/autonomous", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async autonomousParseGoal(naturalLanguage: string) {
    return fetchAPI<APIResponse<AutonomousParsedGoal>>("/autonomous/parse-goal", {
      method: "POST",
      body: JSON.stringify({ naturalLanguage }),
    });
  },

  async autonomousPause(id: string) {
    return fetchAPI<APIResponse<AutonomousTaskData>>(`/autonomous/${id}/pause`, { method: "POST" });
  },

  async autonomousResume(id: string) {
    return fetchAPI<APIResponse<AutonomousTaskData>>(`/autonomous/${id}/resume`, {
      method: "POST",
    });
  },

  async autonomousStop(id: string) {
    return fetchAPI<APIResponse<AutonomousTaskData>>(`/autonomous/${id}/stop`, { method: "POST" });
  },

  async autonomousInjectContext(id: string, context: Record<string, unknown>) {
    return fetchAPI<APIResponse<AutonomousTaskData>>(`/autonomous/${id}/context`, {
      method: "POST",
      body: JSON.stringify({ context }),
    });
  },

  async autonomousGetLogs(id: string, limit = 200) {
    return fetchAPI<APIResponse<AutonomousExecutionLog[]>>(`/autonomous/${id}/logs?limit=${limit}`);
  },

  async autonomousDelete(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/autonomous/${id}`, { method: "DELETE" });
  },

  async autonomousCleanCheckpoints() {
    return fetchAPI<APIResponse<{ deleted: number }>>("/autonomous/checkpoints/clean", {
      method: "POST",
    });
  },
};

// ── Setup API (no auth required) ────────────────────────────────────

export const setup = {
  getStatus: () => fetchSetupAPI<SetupStatusResponse>("/setup/status"),

  getProviders: () => fetchSetupAPI<SetupProvider[]>("/setup/providers"),

  getModels: (_provider: string) =>
    fetchSetupAPI<SetupModelOption[]>(`/setup/models/${encodeURIComponent(_provider)}`),

  validateApiKey: (provider: string, apiKey: string) =>
    fetchSetupAPI<{ valid: boolean; error?: string }>("/setup/validate/api-key", {
      method: "POST",
      body: JSON.stringify({ provider, apiKey }),
    }),

  detectClaudeCodeKey: () => fetchSetupAPI<ClaudeCodeKeyDetection>("/setup/detect-claude-code-key"),

  validateBotToken: (token: string) =>
    fetchSetupAPI<BotValidation>("/setup/validate/bot-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  initWorkspace: (agentName?: string) =>
    fetchSetupAPI<{ created: boolean; path: string }>("/setup/workspace/init", {
      method: "POST",
      body: JSON.stringify({ agentName }),
    }),

  getWalletStatus: () => fetchSetupAPI<WalletStatus>("/setup/wallet/status"),

  generateWallet: () => fetchSetupAPI<WalletResult>("/setup/wallet/generate", { method: "POST" }),

  importWallet: (mnemonic: string) =>
    fetchSetupAPI<{ address: string }>("/setup/wallet/import", {
      method: "POST",
      body: JSON.stringify({ mnemonic }),
    }),

  sendCode: (apiId: number, apiHash: string, phone: string) =>
    fetchSetupAPI<AuthCodeResult>("/setup/telegram/send-code", {
      method: "POST",
      body: JSON.stringify({ apiId, apiHash, phone }),
    }),

  verifyCode: (authSessionId: string, code: string) =>
    fetchSetupAPI<AuthVerifyResult>("/setup/telegram/verify-code", {
      method: "POST",
      body: JSON.stringify({ authSessionId, code }),
    }),

  verifyPassword: (authSessionId: string, password: string) =>
    fetchSetupAPI<AuthVerifyResult>("/setup/telegram/verify-password", {
      method: "POST",
      body: JSON.stringify({ authSessionId, password }),
    }),

  resendCode: (authSessionId: string) =>
    fetchSetupAPI<{
      codeDelivery: "app" | "sms" | "fragment";
      fragmentUrl?: string;
      codeLength?: number;
    }>("/setup/telegram/resend-code", {
      method: "POST",
      body: JSON.stringify({ authSessionId }),
    }),

  startQr: (apiId: number, apiHash: string) =>
    fetchSetupAPI<{ authSessionId: string; token: string; expires: number; expiresAt: number }>(
      "/setup/telegram/qr-start",
      {
        method: "POST",
        body: JSON.stringify({ apiId, apiHash }),
      }
    ),

  refreshQr: (authSessionId: string) =>
    fetchSetupAPI<{
      status: "waiting" | "authenticated" | "2fa_required" | "expired";
      token?: string;
      expires?: number;
      user?: { id: number; firstName: string; username?: string };
      passwordHint?: string;
    }>("/setup/telegram/qr-refresh", {
      method: "POST",
      body: JSON.stringify({ authSessionId }),
    }),

  cancelSession: (authSessionId: string) =>
    fetchSetupAPI<void>("/setup/telegram/session", {
      method: "DELETE",
      body: JSON.stringify({ authSessionId }),
    }),

  saveConfig: (config: SetupConfig) =>
    fetchSetupAPI<{ path: string }>("/setup/config/save", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  launch: (nonce: string) =>
    fetchSetupAPI<{ token: string }>("/setup/launch", {
      method: "POST",
      headers: { "X-Setup-Nonce": nonce },
    }),

  pollHealth: async (timeoutMs = 30000): Promise<void> => {
    const start = Date.now();
    const interval = 1000;
    // Wait a beat for the server to restart
    await new Promise((r) => setTimeout(r, 1500));

    while (Date.now() - start < timeoutMs) {
      try {
        const authRes = await fetch("/auth/check", { signal: AbortSignal.timeout(2000) });
        if (authRes.ok) {
          const json = await authRes.json();
          // The setup server returns { data: { setup: true } } — reject it.
          // The agent WebUI returns { data: { authenticated: bool } } without setup flag.
          if (json.success && json.data && !json.data.setup) return;
        }
      } catch {
        // Server not up yet (connection refused, timeout, etc.)
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error("Agent did not start within the expected time");
  },
};
