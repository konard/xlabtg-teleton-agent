import type { NetworkAgentRecord, NetworkMessageType } from "./types.js";

export interface NetworkAuthorizationResult {
  allowed: boolean;
  reason: string | null;
}

function hasCapabilities(agent: NetworkAgentRecord, requiredCapabilities: string[]): boolean {
  if (requiredCapabilities.length === 0) return true;
  const advertised = new Set(agent.capabilities.map((capability) => capability.toLowerCase()));
  return requiredCapabilities.every((capability) => advertised.has(capability.toLowerCase()));
}

export class NetworkTrustService {
  constructor(
    private readonly options: {
      allowlist?: string[];
      blocklist?: string[];
    } = {}
  ) {}

  authorizeAgentForTask(
    agent: NetworkAgentRecord,
    requiredCapabilities: string[] = []
  ): NetworkAuthorizationResult {
    const base = this.authorizeAgent(agent, "task_request");
    if (!base.allowed) return base;

    if (agent.status === "offline") {
      return { allowed: false, reason: `Agent ${agent.id} is offline` };
    }
    if (!hasCapabilities(agent, requiredCapabilities)) {
      return {
        allowed: false,
        reason: `Agent ${agent.id} does not advertise all required capabilities`,
      };
    }
    return { allowed: true, reason: null };
  }

  authorizeAgent(
    agent: NetworkAgentRecord,
    messageType: NetworkMessageType
  ): NetworkAuthorizationResult {
    if (agent.blocked || this.options.blocklist?.includes(agent.id)) {
      return { allowed: false, reason: `Agent ${agent.id} is blocked` };
    }
    if (this.options.allowlist && this.options.allowlist.length > 0) {
      if (!this.options.allowlist.includes(agent.id)) {
        return { allowed: false, reason: `Agent ${agent.id} is not allowlisted` };
      }
    }
    if (agent.trustLevel === "trusted") return { allowed: true, reason: null };
    if (agent.trustLevel === "verified") return { allowed: true, reason: null };
    if (messageType === "heartbeat" || messageType === "capability_query") {
      return { allowed: true, reason: null };
    }
    return {
      allowed: false,
      reason: `Agent ${agent.id} is untrusted for ${messageType}`,
    };
  }
}
