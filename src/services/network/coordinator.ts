import type { AgentNetworkStore } from "./discovery.js";
import { NetworkMessenger } from "./messenger.js";
import { NetworkTrustService } from "./trust.js";
import type {
  AgentSelectionOptions,
  NetworkAgentRecord,
  NetworkTaskDelegationInput,
  NetworkTaskDelegationResult,
} from "./types.js";

export interface NetworkTaskCoordinatorOptions {
  store: AgentNetworkStore;
  localAgentId?: string;
  privateKey?: string | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  allowlist?: string[];
  blocklist?: string[];
}

function capabilitySet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function hasRequiredCapabilities(agent: NetworkAgentRecord, required: string[]): boolean {
  const available = capabilitySet(agent.capabilities);
  return required.every((capability) => available.has(capability.trim().toLowerCase()));
}

function trustRank(agent: NetworkAgentRecord): number {
  if (agent.trustLevel === "trusted") return 0;
  if (agent.trustLevel === "verified") return 1;
  return 2;
}

export class NetworkTaskCoordinator {
  private readonly store: AgentNetworkStore;
  private readonly messenger: NetworkMessenger;
  private readonly trustService: NetworkTrustService;

  constructor(options: NetworkTaskCoordinatorOptions) {
    this.store = options.store;
    this.trustService = new NetworkTrustService({
      allowlist: options.allowlist,
      blocklist: options.blocklist,
    });
    this.messenger = new NetworkMessenger({
      store: options.store,
      localAgentId: options.localAgentId,
      privateKey: options.privateKey,
      fetcher: options.fetcher,
      timeoutMs: options.timeoutMs,
      trustService: this.trustService,
    });
  }

  selectAgent(options: AgentSelectionOptions = {}): NetworkAgentRecord | null {
    const required = options.requiredCapabilities ?? [];
    const excluded = new Set(options.excludeAgentIds ?? []);
    const candidates = this.store
      .listAgents()
      .filter((agent) => !excluded.has(agent.id))
      .filter((agent) => agent.status === "available" || agent.status === "busy")
      .filter((agent) => hasRequiredCapabilities(agent, required))
      .filter((agent) => this.trustService.authorizeAgentForTask(agent, required).allowed)
      .sort((a, b) => {
        const trustDelta = trustRank(a) - trustRank(b);
        if (trustDelta !== 0) return trustDelta;
        if (a.load !== b.load) return a.load - b.load;
        if (a.errorRate !== b.errorRate) return a.errorRate - b.errorRate;
        return a.name.localeCompare(b.name);
      });

    return candidates[0] ?? null;
  }

  async delegateTask(input: NetworkTaskDelegationInput): Promise<NetworkTaskDelegationResult> {
    const agent = input.agentId
      ? this.store.getAgent(input.agentId)
      : this.selectAgent({ requiredCapabilities: input.requiredCapabilities });
    if (!agent) {
      throw new Error("No capable network agent is available for this task");
    }

    const authorization = this.trustService.authorizeAgentForTask(
      agent,
      input.requiredCapabilities ?? []
    );
    if (!authorization.allowed) {
      throw new Error(authorization.reason ?? `Agent ${agent.id} is not authorized`);
    }

    const result = await this.messenger.sendMessage(agent, {
      type: "task_request",
      timeoutMs: input.timeoutMs,
      payload: {
        description: input.description,
        requiredCapabilities: input.requiredCapabilities ?? [],
        payload: input.payload ?? {},
      },
    });

    return {
      agent,
      message: result.message,
      remoteStatus: result.status,
      remoteResponse: result.response,
    };
  }
}
