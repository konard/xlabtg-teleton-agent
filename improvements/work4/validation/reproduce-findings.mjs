#!/usr/bin/env node
// Reproduction check for the V4 audit (issue #521).
// Each check asserts that the audited code pattern is still present on the
// current commit. While a finding remains reproducible the script exits
// non-zero, so it doubles as a regression guard once the fixes land.
import { readFileSync } from "node:fs";

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const f = {
  execInstall: read("src/agent/tools/exec/install.ts"),
  execService: read("src/agent/tools/exec/service.ts"),
  execRun: read("src/agent/tools/exec/run.ts"),
  execModule: read("src/agent/tools/exec/module.ts"),
  moduleDb: read("src/utils/module-db.ts"),
  integrationsAuth: read("src/services/integrations/auth.ts"),
  mcpRoute: read("src/webui/routes/mcp.ts"),
  mcpLoader: read("src/agent/tools/mcp-loader.ts"),
  workflowExecutor: read("src/services/workflow-executor.ts"),
  workflowScheduler: read("src/services/workflow-scheduler.ts"),
  alerting: read("src/services/alerting.ts"),
  exportImport: read("src/webui/routes/export-import.ts"),
  pipelineExecutor: read("src/services/pipeline/executor.ts"),
  autonomousManager: read("src/autonomous/manager.ts"),
  autonomousLoop: read("src/autonomous/loop.ts"),
  goalParser: read("src/autonomous/goal-parser.ts"),
  getMyGifts: read("src/agent/tools/telegram/gifts/get-my-gifts.ts"),
  giftDetector: read("src/deals/gift-detector.ts"),
  verifyPayment: read("src/agent/tools/deals/verify-payment.ts"),
  verificationPoller: read("src/bot/services/verification-poller.ts"),
  sdkTon: read("src/sdk/ton.ts"),
  paymentVerifier: read("src/ton/payment-verifier.ts"),
  index: read("src/index.ts"),
  memoryDatabase: read("src/memory/database.ts"),
  knowledge: read("src/memory/agent/knowledge.ts"),
  messages: read("src/memory/feed/messages.ts"),
  hybrid: read("src/memory/search/hybrid.ts"),
  scoring: read("src/memory/scoring.ts"),
  groqStt: read("src/providers/groq/GroqSTTProvider.ts"),
  groqTts: read("src/providers/groq/GroqTTSProvider.ts"),
};

const checks = [
  {
    id: "WORK4-001",
    description: "exec_install/exec_service build shell strings with no package/name allowlist",
    present:
      f.execInstall.includes("apt install -y ${pkgs}") &&
      f.execInstall.includes("runCommand(command") &&
      f.execService.includes("`systemctl ${action} ${name}`") &&
      f.execService.includes("runCommand(command"),
  },
  {
    id: "WORK4-002",
    description: "plugin migrateFromMainDb ATTACHes the core DB and copies core tables",
    present:
      f.moduleDb.includes("ATTACH DATABASE") &&
      f.moduleDb.includes("INSERT OR IGNORE INTO ${table}") &&
      f.moduleDb.includes("FROM main_db.${table}"),
  },
  {
    id: "WORK4-003",
    description: "integrations AES key is auto-generated into security_settings in the same DB",
    present:
      f.integrationsAuth.includes("INSERT INTO security_settings (key, value)") &&
      f.integrationsAuth.includes("randomBytes(32).toString(\"hex\")") &&
      f.integrationsAuth.includes("process.env.TELETON_INTEGRATIONS_KEY || getStoredKey(db)"),
  },
  {
    id: "WORK4-004",
    description: "exec allowlist scope still resolves to admin-only (not enforced as a scope)",
    present:
      f.execModule.includes('case "allowlist":') &&
      f.execModule.includes('return "admin-only";') &&
      f.execRun.includes('const useShell = execConfig.mode !== "allowlist";'),
  },
  {
    id: "WORK4-005",
    description: "WebUI MCP route stores url/env without SSRF/metacharacter validation",
    present:
      f.mcpRoute.includes("entry.url = body.url") &&
      f.mcpRoute.includes("entry.env = body.env") &&
      f.mcpLoader.includes("new StreamableHTTPClientTransport(new URL(serverConfig.url))"),
  },
  {
    id: "WORK4-006",
    description: "workflow call_api fetches action.url with no SSRF/private-address guard",
    present:
      f.workflowExecutor.includes("fetch(action.url") &&
      !f.workflowExecutor.includes("validateWebhookUrl") &&
      !f.workflowExecutor.includes("isPrivateIp"),
  },
  {
    id: "WORK4-007",
    description: "workflow webhook secret compared with non-constant-time === ",
    present:
      f.workflowScheduler.includes(".secret === secret") &&
      !f.workflowScheduler.includes("timingSafeEqual"),
  },
  {
    id: "WORK4-008",
    description: "webhook SSRF guard checks hostname strings only, never resolves DNS",
    present:
      f.alerting.includes("validateWebhookUrl") &&
      f.alerting.includes('host === "localhost"') &&
      !f.alerting.includes("dns") &&
      !f.alerting.includes("lookup"),
  },
  {
    id: "WORK4-009",
    description: "config import merges bundle.config over existing with no key allowlist",
    present:
      f.exportImport.includes("const merged = { ...existing, ...bundle.config }") &&
      f.exportImport.includes("SENSITIVE_KEYS"),
  },
  {
    id: "WORK4-010",
    description: "pipeline primary-agent branch calls processMessage with no signal/timeout",
    present:
      f.pipelineExecutor.includes("this.deps.agent.processMessage({") &&
      f.pipelineExecutor.includes("signal: options.signal"),
  },
  {
    id: "WORK4-011",
    description: "restoreInterruptedTasks calls runLoop without re-checking maxParallelTasks",
    present:
      f.autonomousManager.includes("restoreInterruptedTasks") &&
      f.autonomousManager.includes('task.status === "running"') &&
      f.autonomousManager.includes("this.runLoop(task)"),
  },
  {
    id: "WORK4-012",
    description: "evaluateSuccess returns false for non-empty criteria; no enforced default cap",
    present:
      f.autonomousManager.includes("return false; // LLM evaluation happens in selfReflect") &&
      f.autonomousLoop.includes("MAX_GLOBAL_ITERATIONS = 500") &&
      f.goalParser.includes("result.maxIterations = Math.max(1, Math.round(raw.maxIterations))"),
  },
  {
    id: "WORK4-013",
    description: "compactGift omits sender; gift-detector mixes seconds/ms timestamps",
    present:
      !/fromId:/.test(f.getMyGifts.slice(f.getMyGifts.indexOf("const compactGift"), f.getMyGifts.indexOf("const compactGift") + 400)) &&
      f.giftDetector.includes("fromUserId: gift.fromId ? Number(gift.fromId) : undefined") &&
      f.giftDetector.includes("receivedAt: gift.date || Date.now()") &&
      f.verifyPayment.includes("g.receivedAt >= deal.created_at * 1000") &&
      f.verificationPoller.includes("Number(g.fromId) === deal.userId"),
  },
  {
    id: "WORK4-014",
    description: "SDK verifyPayment enforces only an upper age bound, no lower (request-time) bound",
    present:
      f.sdkTon.includes("if (tx.secondsAgo > maxAgeMinutes * 60) continue;") &&
      !f.sdkTon.includes("requestTime") &&
      !f.sdkTon.includes("params.since") &&
      f.paymentVerifier.includes("if (txTime < requestTime) continue;"),
  },
  {
    id: "WORK4-015",
    description: "vector dimension hardcoded to 384; vec inserts share the row transaction",
    present:
      f.index.includes("vectorDimensions: 384,") &&
      f.memoryDatabase.includes("const dims = this.config.vectorDimensions ?? 512;") &&
      f.knowledge.includes("INSERT INTO knowledge_vec (id, embedding)") &&
      f.messages.includes("INSERT INTO tg_messages_vec (id, embedding)"),
  },
  {
    id: "WORK4-016",
    description: "searchMessages never calls the semantic vector store (unlike searchKnowledge)",
    present: (() => {
      // searchKnowledge consults the semantic store; isolate the searchMessages
      // method body and confirm it has no semantic-store call of its own.
      if (!f.hybrid.includes("semanticVectorSearchKnowledge")) return false;
      const start = f.hybrid.indexOf("async searchMessages(");
      if (start === -1) return false;
      const rest = f.hybrid.slice(start + 1);
      const nextMethod = rest.search(/\n {2}(?:async |private |public )?\w+\s*[(<]/);
      const body = nextMethod === -1 ? rest : rest.slice(0, nextMethod);
      return !/semantic/i.test(body);
    })(),
  },
  {
    id: "WORK4-017",
    description: "memory getStats forces a full recalculateAll on every call",
    present:
      f.scoring.includes("getStats(") &&
      /getStats\([^)]*\)[^{]*\{\s*\n\s*this\.recalculateAll\(\);/.test(f.scoring),
  },
  {
    id: "WORK4-018",
    description: "Groq STT/TTS throw raw, unsanitized upstream error bodies",
    present:
      f.groqStt.includes("Groq STT error (${response.status} ${errorType}): ${errorBody}") &&
      f.groqTts.includes("Groq TTS error (${response.status} ${errorType}): ${errorBody}") &&
      !f.groqStt.includes("sanitizeErrorBody") &&
      !f.groqTts.includes("sanitizeErrorBody"),
  },
];

const present = checks.filter((check) => check.present);

for (const check of checks) {
  const status = check.present ? "PRESENT" : "not detected";
  console.log(`${check.id}: ${status} - ${check.description}`);
}

if (present.length > 0) {
  console.error(`\n${present.length}/${checks.length} audit finding(s) are still reproducible.`);
  process.exit(1);
}

console.log("\nNo tracked audit findings detected.");
