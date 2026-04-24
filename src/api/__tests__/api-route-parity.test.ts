import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STABLE_V2_WEBUI_GROUPS = [
  "analytics",
  "anomalies",
  "audit",
  "autonomous",
  "cache",
  "context",
  "dashboards",
  "export",
  "health-check",
  "metrics",
  "network",
  "notifications",
  "pipelines",
  "predictions",
  "security",
  "self-improvement",
  "sessions",
  "widgets",
  "workflows",
];

const WEBUI_ONLY_GROUPS = new Map<string, string>([
  [
    "agent-actions",
    "WebUI-only action surface for browser-driven agent controls; management clients use /v1/agent.",
  ],
  [
    "agent-network",
    "Signed inter-agent ingress with protocol authentication, not management API bearer authentication.",
  ],
  ["groq", "WebUI provider configuration helper, not a stable management API surface."],
  ["mtproto", "WebUI setup/configuration helper, not a stable management API surface."],
]);

function readServerSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

function mountedGroups(source: string, prefix: "api" | "v1"): Set<string> {
  const groups = new Set<string>();
  const pattern = new RegExp(`this\\.app\\.route\\("/${prefix}/([^"]+)"`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    groups.add(match[1]);
  }

  return groups;
}

describe("Management API route parity", () => {
  const webuiGroups = mountedGroups(readServerSource("../../webui/server.ts"), "api");
  const managementGroups = mountedGroups(readServerSource("../server.ts"), "v1");

  it("mounts stable V2 WebUI route groups under /v1", () => {
    const missing = STABLE_V2_WEBUI_GROUPS.filter((group) => !managementGroups.has(group));

    for (const group of STABLE_V2_WEBUI_GROUPS) {
      expect(webuiGroups.has(group), `${group} should be a WebUI route group`).toBe(true);
    }

    expect(missing).toEqual([]);
  });

  it("keeps every non-management WebUI group explicitly documented", () => {
    const undocumented = [...webuiGroups].filter(
      (group) => !managementGroups.has(group) && !WEBUI_ONLY_GROUPS.has(group)
    );
    const staleExemptions = [...WEBUI_ONLY_GROUPS.keys()].filter(
      (group) => !webuiGroups.has(group)
    );

    expect(undocumented).toEqual([]);
    expect(staleExemptions).toEqual([]);
  });
});
