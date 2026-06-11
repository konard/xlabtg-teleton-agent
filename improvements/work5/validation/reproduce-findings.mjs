#!/usr/bin/env node
// Reproduction check for the V5 audit (issue #583).
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
  restore: read("src/backup/restore.ts"),
  archive: read("src/backup/archive.ts"),
  integrationsAuth: read("src/services/integrations/auth.ts"),
  policyEngine: read("src/services/policy-engine.ts"),
  mcpSecurity: read("src/config/mcp-security.ts"),
  autonomousPolicy: read("src/autonomous/policy-engine.ts"),
  retention: read("src/memory/retention.ts"),
  runtime: read("src/agent/runtime.ts"),
  rateLimiter: read("src/bot/rate-limiter.ts"),
};

const checks = [
  {
    id: "WORK5-001",
    description: "restoreBackup writes join(root, file.path) with no containment check",
    present:
      f.restore.includes("const destAbs = join(root, file.path);") &&
      f.restore.includes("writeFileSync(destAbs, data") &&
      !f.restore.includes("resolve(destAbs)") &&
      !f.restore.includes("startsWith(root"),
  },
  {
    id: "WORK5-002",
    description: "integration credentials fall back to a hardcoded literal key",
    present:
      f.integrationsAuth.includes('"default-insecure-key-set-TELETON_INTEGRATIONS_KEY"') &&
      f.integrationsAuth.includes("keyMaterial || process.env.TELETON_INTEGRATIONS_KEY"),
  },
  {
    id: "WORK5-003",
    description: "policy engine compiles matcher.pattern with no guard/try-catch",
    present:
      f.policyEngine.includes("new RegExp(matcher.pattern).test(value)") &&
      !f.policyEngine.includes("safeCompilePattern"),
  },
  {
    id: "WORK5-004",
    description: "MCP URL validation checks IP literals only, never resolves DNS",
    present:
      f.mcpSecurity.includes("validateMcpServerUrl") &&
      f.mcpSecurity.includes("isIP(hostname)") &&
      !f.mcpSecurity.includes("dns") &&
      !f.mcpSecurity.includes("lookup"),
  },
  {
    id: "WORK5-005",
    description: "autonomous budget/confirmation gated on self-reported action.tonAmount",
    present:
      f.autonomousPolicy.includes("action.tonAmount !== undefined && action.tonAmount > 0") &&
      f.autonomousPolicy.includes("action.tonAmount > budgetTON"),
  },
  {
    id: "WORK5-006",
    description: "retention deletes locally then only warns on remote vector delete failure",
    present:
      f.retention.includes("await this.vectorStore.delete(ids)") &&
      f.retention.includes("Semantic vector cleanup failed after memory archive"),
  },
  {
    id: "WORK5-007",
    description: "runtime retry backoff uses a non-abortable setTimeout sleep",
    present:
      f.runtime.includes("await new Promise((r) => setTimeout(r, delay))") &&
      !f.runtime.includes("abortableDelay"),
  },
  {
    id: "WORK5-008",
    description: "plugin rate limiter keys windows on pluginName:action only (not userId)",
    present:
      f.rateLimiter.includes("const key = `${pluginName}:${action}`;") &&
      !f.rateLimiter.includes("userId"),
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
