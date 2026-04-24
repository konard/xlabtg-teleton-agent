import type { SubtaskPlan } from "./types.js";

export interface DecompositionInput {
  description: string;
  maxSubtasks?: number;
}

export interface DecompositionOptions {
  complete?: (prompt: string) => Promise<string>;
}

const DEFAULT_MAX_SUBTASKS = 6;

export function buildDecompositionPrompt(input: DecompositionInput): string {
  return [
    "Break the task into focused subtasks for specialist agents.",
    "Return only JSON with this shape:",
    `{"subtasks":[{"planId":"short-id","description":"...","requiredSkills":["research"],"requiredTools":["web_search"],"dependsOn":["other-plan-id"]}]}`,
    "Use at most three nesting levels overall; this response should only include the immediate children.",
    `Task: ${input.description}`,
  ].join("\n");
}

export async function decomposeTask(
  input: DecompositionInput,
  options: DecompositionOptions = {}
): Promise<SubtaskPlan[]> {
  if (options.complete) {
    try {
      const response = await options.complete(buildDecompositionPrompt(input));
      const parsed = parseStructuredDecomposition(
        response,
        input.maxSubtasks ?? DEFAULT_MAX_SUBTASKS
      );
      if (parsed.length > 0) return parsed;
    } catch {
      // Fall through to deterministic decomposition. The route should remain useful
      // when a configured provider is unavailable or returns non-JSON text.
    }
  }

  return heuristicDecomposeTask(input.description, input.maxSubtasks ?? DEFAULT_MAX_SUBTASKS);
}

export function parseStructuredDecomposition(text: string, maxSubtasks: number): SubtaskPlan[] {
  const jsonText = extractJson(text);
  const parsed = JSON.parse(jsonText) as { subtasks?: unknown };
  if (!Array.isArray(parsed.subtasks)) return [];
  return parsed.subtasks
    .slice(0, maxSubtasks)
    .map((item, index) => normalizePlan(item, index))
    .filter((item): item is SubtaskPlan => Boolean(item));
}

export function heuristicDecomposeTask(
  description: string,
  maxSubtasks = DEFAULT_MAX_SUBTASKS
): SubtaskPlan[] {
  const explicitItems = description
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*0-9.)]+\s*/, "").trim())
    .filter((line) => line.length >= 12);

  if (explicitItems.length > 1) {
    return explicitItems.slice(0, maxSubtasks).map((item, index) => ({
      planId: `step-${index + 1}`,
      description: item,
      ...inferRequirements(item),
      dependsOn: index > 0 ? [`step-${index}`] : [],
    }));
  }

  const clauses = description
    .split(/\s+(?:then|and then|after that)\s+|;\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
  if (clauses.length > 1) {
    return clauses.slice(0, maxSubtasks).map((part, index) => ({
      planId: `step-${index + 1}`,
      description: normalizeDescription(part),
      ...inferRequirements(part),
      dependsOn: index > 0 ? [`step-${index}`] : [],
    }));
  }

  const plans: SubtaskPlan[] = [];
  if (/\b(research|investigate|analy[sz]e|source|web|search)\b/i.test(description)) {
    plans.push({
      planId: "research",
      description: `Research context and constraints for: ${description}`,
      requiredSkills: ["research"],
      requiredTools: ["web_search"],
    });
  }
  if (/\b(code|implement|build|fix|debug|test|review|refactor)\b/i.test(description)) {
    plans.push({
      planId: "implementation",
      description: `Implement and test the requested change: ${description}`,
      requiredSkills: ["code", "testing"],
      requiredTools: ["workspace_read", "workspace_write"],
      dependsOn: plans.length > 0 ? [plans[plans.length - 1].planId ?? "research"] : [],
    });
  }
  if (/\b(write|docs?|document|content|summari[sz]e|release note)\b/i.test(description)) {
    plans.push({
      planId: "content",
      description: `Prepare user-facing content for: ${description}`,
      requiredSkills: ["content"],
      requiredTools: ["workspace_read"],
      dependsOn: plans.length > 0 ? [plans[plans.length - 1].planId ?? "implementation"] : [],
    });
  }
  if (/\b(monitor|health|metric|alert|incident|anomaly|logs?)\b/i.test(description)) {
    plans.push({
      planId: "monitoring",
      description: `Inspect health and monitoring signals for: ${description}`,
      requiredSkills: ["monitoring"],
      requiredTools: [],
    });
  }

  if (plans.length === 0) {
    plans.push(
      {
        planId: "plan",
        description: `Clarify scope and execution plan for: ${description}`,
        requiredSkills: ["planning"],
        requiredTools: [],
      },
      {
        planId: "execute",
        description: `Execute the planned work for: ${description}`,
        requiredSkills: [],
        requiredTools: [],
        dependsOn: ["plan"],
      },
      {
        planId: "synthesize",
        description: `Review and synthesize final results for: ${description}`,
        requiredSkills: ["planning"],
        requiredTools: [],
        dependsOn: ["execute"],
      }
    );
  }

  return plans.slice(0, maxSubtasks);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalizePlan(item: unknown, index: number): SubtaskPlan | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return null;
  return {
    planId:
      typeof raw.planId === "string"
        ? raw.planId.trim() || `step-${index + 1}`
        : `step-${index + 1}`,
    description,
    requiredSkills: normalizeArray(raw.requiredSkills),
    requiredTools: normalizeArray(raw.requiredTools),
    dependsOn: normalizeArray(raw.dependsOn),
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
  };
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeDescription(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function inferRequirements(text: string): Pick<SubtaskPlan, "requiredSkills" | "requiredTools"> {
  const requiredSkills: string[] = [];
  const requiredTools: string[] = [];
  if (/\b(research|investigate|web|search|source)\b/i.test(text)) {
    requiredSkills.push("research");
    requiredTools.push("web_search");
  }
  if (/\b(code|implement|build|fix|debug|test|review|refactor)\b/i.test(text)) {
    requiredSkills.push("code");
    requiredTools.push("workspace_read", "workspace_write");
  }
  if (/\b(write|edit|translate|docs?|content|format)\b/i.test(text)) {
    requiredSkills.push("content");
    requiredTools.push("workspace_read");
  }
  if (/\b(monitor|health|metric|alert|incident|anomaly|logs?)\b/i.test(text)) {
    requiredSkills.push("monitoring");
  }
  return {
    requiredSkills: [...new Set(requiredSkills)],
    requiredTools: [...new Set(requiredTools)],
  };
}
