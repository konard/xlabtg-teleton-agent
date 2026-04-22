import type { AutonomousTask, TaskConstraints } from "../memory/agent/autonomous-tasks.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("PolicyEngine");

export interface PolicyConfig {
  tonSpending: {
    perTask: number;
    daily: number;
    requireConfirmationAbove: number;
  };
  restrictedTools: string[];
  requireHumanApproval: "any" | "above-threshold" | "never";
  uncertainty: {
    threshold: number;
    maxConsecutiveUncertain: number;
  };
  loopDetection: {
    enabled: boolean;
    maxIdenticalActions: number;
  };
  rateLimit: {
    apiCallsPerMinute: number;
    toolCallsPerHour: number;
  };
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  tonSpending: {
    perTask: 1,
    daily: 5,
    requireConfirmationAbove: 0.5,
  },
  restrictedTools: ["ton_send", "jetton_send", "exec", "exec_run"],
  requireHumanApproval: "above-threshold",
  uncertainty: {
    threshold: 0.7,
    maxConsecutiveUncertain: 3,
  },
  loopDetection: {
    enabled: true,
    maxIdenticalActions: 5,
  },
  rateLimit: {
    apiCallsPerMinute: 30,
    toolCallsPerHour: 100,
  },
};

/**
 * Snapshot of the mutable rate-limit / loop / uncertainty state that must
 * survive pause/resume cycles. Persisted by the loop; hydrated into a new
 * PolicyEngine on resume so the sliding-window limits are not bypassed by
 * scripting pause/resume (see issue #256).
 */
export interface PolicyEngineState {
  toolCallTimestamps: number[];
  apiCallTimestamps: number[];
  consecutiveUncertainCount: number;
  recentActions: string[];
}

export type PolicyViolation =
  | { type: "budget_exceeded"; message: string; requiresConfirmation: boolean }
  | { type: "restricted_tool"; message: string; toolName: string }
  | { type: "loop_detected"; message: string }
  | { type: "rate_limit"; message: string }
  | { type: "max_iterations"; message: string }
  | { type: "duration_exceeded"; message: string };

export interface PolicyCheckResult {
  allowed: boolean;
  requiresEscalation: boolean;
  violations: PolicyViolation[];
}

export class PolicyEngine {
  private toolCallTimestamps: number[] = [];
  private apiCallTimestamps: number[] = [];
  private consecutiveUncertainCount = 0;
  private recentActions: string[] = [];
  private onStateChange?: (state: PolicyEngineState) => void;

  constructor(private config: PolicyConfig = DEFAULT_POLICY_CONFIG) {}

  /**
   * Register a callback invoked after any mutation to the engine's runtime
   * state. The loop uses this to persist state so that pause/resume cannot
   * bypass rate-limit and loop-detection windows (issue #256).
   */
  setOnStateChange(cb: ((state: PolicyEngineState) => void) | undefined): void {
    this.onStateChange = cb;
  }

  /** Dump mutable runtime state for persistence. */
  serialize(): PolicyEngineState {
    return {
      toolCallTimestamps: [...this.toolCallTimestamps],
      apiCallTimestamps: [...this.apiCallTimestamps],
      consecutiveUncertainCount: this.consecutiveUncertainCount,
      recentActions: [...this.recentActions],
    };
  }

  /**
   * Restore state produced by a previous `serialize()` call. Unknown fields
   * are ignored so the engine stays forward-compatible with older snapshots.
   */
  hydrate(state: Partial<PolicyEngineState> | undefined | null): void {
    if (!state) return;
    this.toolCallTimestamps = Array.isArray(state.toolCallTimestamps)
      ? [...state.toolCallTimestamps]
      : [];
    this.apiCallTimestamps = Array.isArray(state.apiCallTimestamps)
      ? [...state.apiCallTimestamps]
      : [];
    this.consecutiveUncertainCount =
      typeof state.consecutiveUncertainCount === "number" ? state.consecutiveUncertainCount : 0;
    this.recentActions = Array.isArray(state.recentActions) ? [...state.recentActions] : [];
  }

  private notifyChange(): void {
    if (this.onStateChange) this.onStateChange(this.serialize());
  }

  checkAction(
    task: AutonomousTask,
    action: {
      toolName?: string;
      tonAmount?: number;
      recentActions?: string[];
    }
  ): PolicyCheckResult {
    const violations: PolicyViolation[] = [];
    let requiresEscalation = false;

    const constraints = task.constraints as TaskConstraints;

    // Check max iterations
    if (constraints.maxIterations !== undefined && task.currentStep >= constraints.maxIterations) {
      violations.push({
        type: "max_iterations",
        message: `Task has reached maximum iterations (${constraints.maxIterations})`,
      });
    }

    // Check duration limit
    if (constraints.maxDurationHours !== undefined && task.startedAt) {
      const elapsedHours = (Date.now() - task.startedAt.getTime()) / 3600000;
      if (elapsedHours >= constraints.maxDurationHours) {
        violations.push({
          type: "duration_exceeded",
          message: `Task has exceeded maximum duration of ${constraints.maxDurationHours}h`,
        });
      }
    }

    // Check tool whitelist / blacklist
    if (action.toolName) {
      if (
        constraints.allowedTools &&
        constraints.allowedTools.length > 0 &&
        !constraints.allowedTools.includes(action.toolName)
      ) {
        violations.push({
          type: "restricted_tool",
          message: `Tool "${action.toolName}" is not in the allowed tools list`,
          toolName: action.toolName,
        });
      }

      if (
        this.config.restrictedTools.includes(action.toolName) ||
        (constraints.restrictedTools && constraints.restrictedTools.includes(action.toolName))
      ) {
        requiresEscalation = true;
        log.warn({ tool: action.toolName }, "Restricted tool requires escalation");
      }
    }

    // Check TON budget
    if (action.tonAmount !== undefined && action.tonAmount > 0) {
      const budgetTON = constraints.budgetTON ?? this.config.tonSpending.perTask;
      if (action.tonAmount > budgetTON) {
        violations.push({
          type: "budget_exceeded",
          message: `TON amount ${action.tonAmount} exceeds budget ${budgetTON}`,
          requiresConfirmation: true,
        });
      } else if (action.tonAmount > this.config.tonSpending.requireConfirmationAbove) {
        requiresEscalation = true;
      }
    }

    // Check rate limits
    const now = Date.now();
    this.toolCallTimestamps = this.toolCallTimestamps.filter((t) => now - t < 3600000);
    if (this.toolCallTimestamps.length >= this.config.rateLimit.toolCallsPerHour) {
      violations.push({
        type: "rate_limit",
        message: `Tool call rate limit exceeded (${this.config.rateLimit.toolCallsPerHour}/hour)`,
      });
    }

    this.apiCallTimestamps = this.apiCallTimestamps.filter((t) => now - t < 60000);
    if (this.apiCallTimestamps.length >= this.config.rateLimit.apiCallsPerMinute) {
      violations.push({
        type: "rate_limit",
        message: `API call rate limit exceeded (${this.config.rateLimit.apiCallsPerMinute}/min)`,
      });
    }

    // Check loop detection
    if (
      this.config.loopDetection.enabled &&
      action.recentActions &&
      action.recentActions.length >= this.config.loopDetection.maxIdenticalActions
    ) {
      const lastN = action.recentActions.slice(-this.config.loopDetection.maxIdenticalActions);
      if (lastN.every((a) => a === lastN[0])) {
        violations.push({
          type: "loop_detected",
          message: `Loop detected: same action repeated ${this.config.loopDetection.maxIdenticalActions} times`,
        });
        requiresEscalation = true;
      }
    }

    const allowed = violations.length === 0;

    return { allowed, requiresEscalation, violations };
  }

  recordToolCall(): void {
    this.toolCallTimestamps.push(Date.now());
    this.notifyChange();
  }

  recordApiCall(): void {
    this.apiCallTimestamps.push(Date.now());
    this.notifyChange();
  }

  recordUncertain(): boolean {
    this.consecutiveUncertainCount++;
    this.notifyChange();
    return this.consecutiveUncertainCount >= this.config.uncertainty.maxConsecutiveUncertain;
  }

  resetUncertainCount(): void {
    if (this.consecutiveUncertainCount === 0) return;
    this.consecutiveUncertainCount = 0;
    this.notifyChange();
  }

  /**
   * Record a tool name the loop just executed. The engine stores a bounded
   * window (length 20) used for loop detection.
   */
  recordAction(toolName: string): void {
    this.recentActions.push(toolName);
    if (this.recentActions.length > 20) this.recentActions.shift();
    this.notifyChange();
  }

  getRecentActions(): readonly string[] {
    return this.recentActions;
  }

  satisfiesPolicies(
    task: AutonomousTask,
    action: Parameters<typeof this.checkAction>[1]
  ): PolicyCheckResult {
    return this.checkAction(task, action);
  }
}
