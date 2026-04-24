export const SUBTASK_STATUSES = [
  "pending",
  "delegated",
  "in_progress",
  "done",
  "failed",
  "cancelled",
] as const;

export type SubtaskStatus = (typeof SUBTASK_STATUSES)[number];

export interface SubtaskPlan {
  planId?: string;
  description: string;
  requiredSkills?: string[];
  requiredTools?: string[];
  dependsOn?: string[];
  agentId?: string | null;
}

export interface CreateSubtaskOptions {
  parentId?: string | null;
}

export interface TaskSubtask {
  id: string;
  taskId: string;
  parentId?: string;
  description: string;
  requiredSkills: string[];
  requiredTools: string[];
  agentId?: string;
  status: SubtaskStatus;
  result?: string;
  error?: string;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dependencies: string[];
}

export interface TaskSubtaskNode extends TaskSubtask {
  children: TaskSubtaskNode[];
}

export type DelegationTimelineEventType =
  | "created"
  | "delegated"
  | "started"
  | "completed"
  | "failed"
  | "cancelled";

export interface DelegationTimelineEvent {
  id: string;
  type: DelegationTimelineEventType;
  subtaskId: string;
  subtaskDescription: string;
  agentId?: string;
  at: Date;
  message: string;
}

export interface TaskDelegationTree {
  taskId: string;
  subtasks: TaskSubtask[];
  roots: TaskSubtaskNode[];
  timeline: DelegationTimelineEvent[];
}

export interface AgentCandidate {
  id: string;
  name: string;
  type: string;
  description: string;
  tools: string[];
  state?: string;
  pendingMessages?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
}

export interface AgentMatch {
  agent: AgentCandidate;
  score: number;
  reasons: string[];
}
