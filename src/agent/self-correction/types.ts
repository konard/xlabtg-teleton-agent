import type { AssistantMessage } from "@mariozechner/pi-ai";

export interface EvaluationCriteria {
  completeness: number;
  correctness: number;
  toolUsage: number;
  formatting: number;
}

export interface OutputEvaluation {
  score: number;
  feedback: string;
  criteria: EvaluationCriteria;
  issues: string[];
  needsCorrection: boolean;
}

export interface ReflectionPlan {
  summary: string;
  instructions: string[];
  focusAreas: string[];
}

export type ToolErrorKind =
  | "auth"
  | "timeout"
  | "invalid_input"
  | "resource_not_found"
  | "rate_limit"
  | "permission"
  | "network"
  | "unknown";

export interface ToolRecovery {
  toolName: string;
  error: string;
  kind: ToolErrorKind;
  retryable: boolean;
  guidance: string;
  adaptedParams?: Record<string, unknown>;
}

export type SelfCorrectionUsage = NonNullable<AssistantMessage["usage"]>;

export interface EvaluationResult {
  evaluation: OutputEvaluation;
  rawText: string;
  usage?: SelfCorrectionUsage;
}

export interface ReflectionResult {
  reflection: ReflectionPlan;
  rawText: string;
  usage?: SelfCorrectionUsage;
}

export interface CorrectionLogInput {
  sessionId: string;
  taskId?: string | null;
  chatId: string;
  iteration: number;
  originalOutput: string;
  evaluation: OutputEvaluation;
  reflection?: ReflectionPlan | null;
  correctedOutput?: string | null;
  correctedScore?: number | null;
  threshold: number;
  escalated: boolean;
  toolRecoveries: ToolRecovery[];
}

export interface CorrectionLogEntry {
  id: string;
  sessionId: string;
  taskId: string | null;
  chatId: string;
  iteration: number;
  originalOutput: string;
  evaluation: OutputEvaluation;
  reflection: ReflectionPlan | null;
  correctedOutput: string | null;
  score: number;
  correctedScore: number | null;
  scoreDelta: number;
  threshold: number;
  escalated: boolean;
  toolRecoveries: ToolRecovery[];
  feedback: string;
  createdAt: number;
}

export interface CorrectionPattern {
  key: string;
  label: string;
  count: number;
  lastSeenAt: number;
}
