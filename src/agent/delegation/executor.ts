import type { ManagedAgentMessage } from "../../agents/types.js";
import { matchAgentForSubtask } from "./matcher.js";
import type { TaskDelegationStore } from "./store.js";
import type { AgentCandidate, SubtaskPlan, TaskDelegationTree, TaskSubtask } from "./types.js";

export interface DelegationTaskInput {
  id: string;
  description: string;
}

export interface TaskDelegationExecutorOptions {
  store: TaskDelegationStore;
  candidates: AgentCandidate[];
  sendMessage?: (fromId: string, toId: string, text: string) => ManagedAgentMessage;
}

export interface DecomposeAndAssignResult {
  subtasks: TaskSubtask[];
  tree: TaskDelegationTree;
  messages: ManagedAgentMessage[];
}

export class TaskDelegationExecutor {
  private readonly store: TaskDelegationStore;
  private readonly candidates: AgentCandidate[];
  private readonly sendMessage?: (
    fromId: string,
    toId: string,
    text: string
  ) => ManagedAgentMessage;

  constructor(options: TaskDelegationExecutorOptions) {
    this.store = options.store;
    this.candidates = options.candidates;
    this.sendMessage = options.sendMessage;
  }

  decomposeAndAssign(
    task: DelegationTaskInput,
    plans: SubtaskPlan[],
    options: { parentId?: string | null } = {}
  ): DecomposeAndAssignResult {
    const created = this.store.createSubtasks(task.id, plans, options);
    const messages: ManagedAgentMessage[] = [];
    const assigned = created.map((subtask) => {
      const agentId = subtask.agentId ?? matchAgentForSubtask(subtask, this.candidates)?.agent.id;
      if (!agentId) return subtask;
      const updated = this.store.assignSubtask(subtask.id, agentId);
      const message = this.dispatchDelegation(task, updated);
      if (message) messages.push(message);
      return updated;
    });

    return {
      subtasks: assigned,
      tree: this.store.getTaskTree(task.id),
      messages,
    };
  }

  delegateSubtask(
    task: DelegationTaskInput,
    subtask: TaskSubtask,
    agentId: string
  ): {
    subtask: TaskSubtask;
    tree: TaskDelegationTree;
    message: ManagedAgentMessage | null;
  } {
    const assigned = this.store.assignSubtask(subtask.id, agentId);
    const message = this.dispatchDelegation(task, assigned);
    return {
      subtask: assigned,
      tree: this.store.getTaskTree(task.id),
      message,
    };
  }

  private dispatchDelegation(
    task: DelegationTaskInput,
    subtask: TaskSubtask
  ): ManagedAgentMessage | null {
    if (!this.sendMessage || !subtask.agentId || subtask.agentId === "primary") return null;
    return this.sendMessage(
      "primary",
      subtask.agentId,
      [
        `[DELEGATED SUBTASK - ${subtask.id}]`,
        `Parent task: ${task.description}`,
        `Subtask: ${subtask.description}`,
        subtask.requiredSkills.length > 0
          ? `Required skills: ${subtask.requiredSkills.join(", ")}`
          : null,
        subtask.requiredTools.length > 0
          ? `Required tools: ${subtask.requiredTools.join(", ")}`
          : null,
        subtask.dependencies.length > 0
          ? `Wait for dependencies: ${subtask.dependencies.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
