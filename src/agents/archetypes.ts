import type {
  BuiltInAgentType,
  ManagedAgentArchetype,
  ManagedAgentRegistryConfig,
} from "./types.js";

export const DEFAULT_AGENT_REGISTRY_CONFIG: ManagedAgentRegistryConfig = {
  hookRules: [],
  provider: null,
  model: null,
  temperature: null,
  maxTokens: null,
  maxToolCallsPerTurn: null,
};

export const BUILT_IN_AGENT_ARCHETYPES: ManagedAgentArchetype[] = [
  {
    type: "ResearchAgent",
    name: "Research Agent",
    description: "Researches the web, gathers source material, and summarizes findings.",
    soulTemplate:
      "You are a research agent. Gather relevant information, compare sources, cite uncertainty clearly, and produce concise summaries with next steps.",
    tools: ["web_search", "web_fetch", "memory_search", "memory_write"],
    config: {
      ...DEFAULT_AGENT_REGISTRY_CONFIG,
      temperature: 0.3,
      maxTokens: 4096,
      maxToolCallsPerTurn: 8,
    },
    resources: {
      maxConcurrentTasks: 8,
      rateLimitPerMinute: 45,
      llmRateLimitPerMinute: 20,
    },
  },
  {
    type: "CodeAgent",
    name: "Code Agent",
    description: "Implements, reviews, debugs, and tests code changes.",
    soulTemplate:
      "You are a code agent. Read the codebase before changing it, prefer local patterns, add focused tests, and explain implementation tradeoffs directly.",
    tools: ["workspace_read", "workspace_write", "workspace_list", "exec_run", "memory_search"],
    config: {
      ...DEFAULT_AGENT_REGISTRY_CONFIG,
      temperature: 0.2,
      maxTokens: 6144,
      maxToolCallsPerTurn: 10,
    },
    resources: {
      maxMemoryMb: 768,
      maxConcurrentTasks: 6,
      rateLimitPerMinute: 30,
      llmRateLimitPerMinute: 15,
    },
  },
  {
    type: "ContentAgent",
    name: "Content Agent",
    description: "Writes, edits, translates, and formats user-facing content.",
    soulTemplate:
      "You are a content agent. Preserve intent, write plainly, adapt tone to the audience, and keep formatting clean and scannable.",
    tools: ["memory_search", "memory_write", "telegram_send_message", "workspace_read"],
    config: {
      ...DEFAULT_AGENT_REGISTRY_CONFIG,
      temperature: 0.6,
      maxTokens: 4096,
      maxToolCallsPerTurn: 5,
    },
    resources: {
      maxConcurrentTasks: 8,
      rateLimitPerMinute: 60,
      llmRateLimitPerMinute: 25,
    },
  },
  {
    type: "OrchestratorAgent",
    name: "Orchestrator Agent",
    description: "Plans work, delegates to specialist agents, and aggregates results.",
    soulTemplate:
      "You are an orchestrator agent. Break work into clear subtasks, route each task to the right specialist, track dependencies, and synthesize final results.",
    tools: [
      "memory_search",
      "memory_write",
      "telegram_send_message",
      "telegram_create_scheduled_task",
    ],
    config: {
      ...DEFAULT_AGENT_REGISTRY_CONFIG,
      temperature: 0.35,
      maxTokens: 6144,
      maxToolCallsPerTurn: 12,
      hookRules: ["delegate:prefer-specialist", "aggregate:require-summary"],
    },
    resources: {
      maxMemoryMb: 768,
      maxConcurrentTasks: 12,
      rateLimitPerMinute: 60,
      llmRateLimitPerMinute: 25,
    },
    messaging: {
      enabled: true,
      maxMessagesPerMinute: 60,
    },
  },
  {
    type: "MonitorAgent",
    name: "Monitor Agent",
    description: "Watches health, metrics, anomalies, and alerting signals.",
    soulTemplate:
      "You are a monitor agent. Watch system health, inspect recent activity, escalate anomalies, and keep alerts specific and actionable.",
    tools: ["memory_search", "memory_write", "telegram_send_message", "exec_status"],
    config: {
      ...DEFAULT_AGENT_REGISTRY_CONFIG,
      temperature: 0.1,
      maxTokens: 3072,
      maxToolCallsPerTurn: 6,
      hookRules: ["alert:dedupe", "health:include-status"],
    },
    resources: {
      maxMemoryMb: 384,
      maxConcurrentTasks: 4,
      rateLimitPerMinute: 30,
      llmRateLimitPerMinute: 10,
    },
  },
];

export function listBuiltInAgentArchetypes(): ManagedAgentArchetype[] {
  return BUILT_IN_AGENT_ARCHETYPES.map(cloneArchetype);
}

export function getBuiltInAgentArchetype(type: string | undefined): ManagedAgentArchetype | null {
  if (!type) return null;
  const archetype = BUILT_IN_AGENT_ARCHETYPES.find((candidate) => candidate.type === type);
  return archetype ? cloneArchetype(archetype) : null;
}

export function isBuiltInAgentType(type: string): type is BuiltInAgentType {
  return BUILT_IN_AGENT_ARCHETYPES.some((candidate) => candidate.type === type);
}

function cloneArchetype(archetype: ManagedAgentArchetype): ManagedAgentArchetype {
  return {
    ...archetype,
    tools: [...archetype.tools],
    config: {
      ...archetype.config,
      hookRules: [...archetype.config.hookRules],
    },
    resources: archetype.resources ? { ...archetype.resources } : undefined,
    messaging: archetype.messaging
      ? {
          ...archetype.messaging,
          allowlist: archetype.messaging.allowlist ? [...archetype.messaging.allowlist] : undefined,
        }
      : undefined,
  };
}
