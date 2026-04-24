import { describe, expect, it } from "vitest";
import { matchAgentForSubtask } from "../matcher.js";

describe("matchAgentForSubtask", () => {
  it("routes tool and domain specific work to the strongest specialist", () => {
    const match = matchAgentForSubtask(
      {
        description: "Review the implementation and add tests",
        requiredSkills: ["code", "testing"],
        requiredTools: ["workspace_write"],
      },
      [
        {
          id: "research",
          name: "Research Agent",
          type: "ResearchAgent",
          description: "Researches the web",
          tools: ["web_search"],
          state: "running",
          pendingMessages: 0,
          maxConcurrentTasks: 4,
        },
        {
          id: "code",
          name: "Code Agent",
          type: "CodeAgent",
          description: "Implements and tests code",
          tools: ["workspace_read", "workspace_write"],
          state: "running",
          pendingMessages: 1,
          maxConcurrentTasks: 6,
        },
      ]
    );

    expect(match?.agent.id).toBe("code");
    expect(match?.reasons.join(" ")).toContain("workspace_write");
  });

  it("falls back to an orchestrator when no specialist is a strong match", () => {
    const match = matchAgentForSubtask(
      {
        description: "Coordinate a vague multi-step goal",
        requiredSkills: ["planning"],
        requiredTools: [],
      },
      [
        {
          id: "orchestrator",
          name: "Orchestrator",
          type: "OrchestratorAgent",
          description: "Plans and delegates work",
          tools: [],
          state: "running",
          pendingMessages: 0,
          maxConcurrentTasks: 10,
        },
      ]
    );

    expect(match?.agent.id).toBe("orchestrator");
  });
});
