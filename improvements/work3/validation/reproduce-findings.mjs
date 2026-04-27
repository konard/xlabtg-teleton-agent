#!/usr/bin/env node
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

const files = {
  webuiServer: read("src/webui/server.ts"),
  csrf: read("src/webui/middleware/csrf.ts"),
  pipelineExecutor: read("src/services/pipeline/executor.ts"),
  memoryRoutes: read("src/webui/routes/memory.ts"),
  workflowExecutor: read("src/services/workflow-executor.ts"),
};

const checks = [
  {
    id: "V2-001",
    description: "public webhook ingress is still not bypassed in auth/CSRF middleware",
    present:
      files.webuiServer.includes('if (c.req.path === "/api/agent-network")') &&
      !files.webuiServer.includes("/api/webhooks/incoming") &&
      !files.webuiServer.includes("/api/workflows/webhook") &&
      files.csrf.includes('path === "/api/agent-network"') &&
      !files.csrf.includes("/api/webhooks/incoming") &&
      !files.csrf.includes("/api/workflows/webhook"),
  },
  {
    id: "V2-002",
    description: "managed pipeline steps still return dispatch metadata as output",
    present:
      files.pipelineExecutor.includes("this.deps.agentManager.sendMessage") &&
      files.pipelineExecutor.includes("messageId: message.id") &&
      files.pipelineExecutor.includes("toAgentId: agent.id"),
  },
  {
    id: "V2-003",
    description: "pipeline timeout is still checked only around levels/step-specific timeouts",
    present:
      files.pipelineExecutor.includes("const deadline =") &&
      files.pipelineExecutor.includes("await Promise.all(") &&
      files.pipelineExecutor.includes("step.timeoutSeconds") &&
      !files.pipelineExecutor.includes("pipelineRemainingTimeout"),
  },
  {
    id: "V2-004",
    description: "memory route search still passes vectorEnabled=false and an empty embedding",
    present:
      files.memoryRoutes.includes("new HybridSearch(deps.memory.db, false") &&
      files.memoryRoutes.includes("search.searchKnowledge(query, []"),
  },
  {
    id: "V2-005",
    description: "workflow call_api still awaits raw fetch without an abort signal",
    present:
      files.workflowExecutor.includes("await fetch(action.url, init)") &&
      !files.workflowExecutor.includes("AbortSignal.timeout") &&
      !files.workflowExecutor.includes("AbortController"),
  },
];

const present = checks.filter((check) => check.present);

for (const check of checks) {
  const status = check.present ? "PRESENT" : "not detected";
  console.log(`${check.id}: ${status} - ${check.description}`);
}

if (present.length > 0) {
  console.error(`\n${present.length} audit finding(s) are still reproducible.`);
  process.exit(1);
}

console.log("\nNo tracked audit findings detected.");
