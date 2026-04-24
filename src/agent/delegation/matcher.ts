import type { AgentCandidate, AgentMatch, SubtaskPlan, TaskSubtask } from "./types.js";

const TYPE_SKILLS: Record<string, string[]> = {
  ResearchAgent: ["research", "search", "web", "source", "summarize", "analysis", "investigate"],
  CodeAgent: ["code", "implementation", "debug", "test", "review", "workspace", "programming"],
  ContentAgent: ["write", "edit", "translate", "content", "copy", "format", "document"],
  OrchestratorAgent: ["plan", "delegate", "coordinate", "synthesize", "aggregate", "workflow"],
  MonitorAgent: ["monitor", "health", "metric", "alert", "anomaly", "incident", "log"],
};

const KEYWORD_SKILLS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\b(research|investigate|source|web|search|summari[sz]e)\b/i, skill: "research" },
  { pattern: /\b(code|implement|debug|test|review|build|fix|refactor)\b/i, skill: "code" },
  { pattern: /\b(write|edit|translate|docs?|content|copy|format)\b/i, skill: "content" },
  { pattern: /\b(monitor|health|metric|alert|incident|anomaly|log)\b/i, skill: "monitoring" },
  {
    pattern: /\b(plan|delegate|coordinate|synthesi[sz]e|aggregate|orchestrate)\b/i,
    skill: "planning",
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inferSkills(description: string): string[] {
  const skills = new Set<string>();
  for (const { pattern, skill } of KEYWORD_SKILLS) {
    if (pattern.test(description)) skills.add(skill);
  }
  return [...skills];
}

function getRequiredSkills(subtask: SubtaskPlan | TaskSubtask): string[] {
  const explicit = "requiredSkills" in subtask ? subtask.requiredSkills : [];
  return [...new Set([...(explicit ?? []), ...inferSkills(subtask.description)].map(normalize))];
}

function scoreAvailability(agent: AgentCandidate): number {
  if (agent.state && agent.state !== "running" && agent.state !== "stopped") return -20;
  const maxConcurrent = agent.maxConcurrentTasks ?? 1;
  const pending = agent.pendingMessages ?? 0;
  if (maxConcurrent <= 0) return 0;
  const freeRatio = Math.max(0, Math.min(1, (maxConcurrent - pending) / maxConcurrent));
  return freeRatio * 8;
}

export function scoreAgentForSubtask(
  subtask: SubtaskPlan | TaskSubtask,
  agent: AgentCandidate
): AgentMatch {
  const requiredTools = new Set((subtask.requiredTools ?? []).map(normalize));
  const requiredSkills = getRequiredSkills(subtask);
  const agentTools = new Set(agent.tools.map(normalize));
  const agentSkills = new Set((TYPE_SKILLS[agent.type] ?? []).map(normalize));
  const description = normalize(`${agent.name} ${agent.description} ${agent.type}`);

  let score = 0;
  const reasons: string[] = [];

  for (const tool of requiredTools) {
    if (agentTools.has(tool)) {
      score += 25;
      reasons.push(`has required tool ${tool}`);
    } else if (
      [...agentTools].some((candidate) => candidate.includes(tool) || tool.includes(candidate))
    ) {
      score += 10;
      reasons.push(`has related tool for ${tool}`);
    } else {
      score -= 12;
    }
  }

  for (const skill of requiredSkills) {
    if (agentSkills.has(skill) || description.includes(skill)) {
      score += 16;
      reasons.push(`matches ${skill} skill`);
    }
  }

  score += scoreAvailability(agent);

  if (agent.successRate !== undefined) {
    score += agent.successRate * 10;
    reasons.push(`historical success ${(agent.successRate * 100).toFixed(0)}%`);
  }

  if (agent.type === "OrchestratorAgent" && score < 12) {
    score += 8;
    reasons.push("orchestrator fallback");
  }

  return { agent, score, reasons };
}

export function matchAgentForSubtask(
  subtask: SubtaskPlan | TaskSubtask,
  candidates: AgentCandidate[]
): AgentMatch | null {
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((agent) => scoreAgentForSubtask(subtask, agent))
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
  const best = scored[0];
  if (best.score > 0) return best;

  const orchestrator = scored.find((match) => match.agent.type === "OrchestratorAgent");
  return orchestrator ?? best;
}
