import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mockBackend } from "./mock-api";

// ESM-safe __dirname (web/ uses "type": "module").
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Accessibility audit for every WebUI route.
 *
 * Each route is loaded against the mock backend and scanned with axe-core using
 * the WCAG 2.1 A/AA rule set. The suite fails on any `critical` or `serious`
 * violation. A machine-readable baseline (`a11y-report/`) is written after the
 * run for publishing as a CI artifact.
 */

interface RouteDef {
  path: string;
  name: string;
}

// All 23 WebUI pages (22 authenticated routes + the standalone setup flow).
const ROUTES: RouteDef[] = [
  { path: "/", name: "Dashboard" },
  { path: "/agents", name: "Agents" },
  { path: "/tools", name: "Tools" },
  { path: "/plugins", name: "Plugins" },
  { path: "/soul", name: "Soul" },
  { path: "/memory", name: "Memory" },
  { path: "/workspace", name: "Workspace" },
  { path: "/tasks", name: "Tasks" },
  { path: "/workflows", name: "Workflows" },
  { path: "/pipelines", name: "Pipelines" },
  { path: "/events", name: "Events" },
  { path: "/mcp", name: "MCP" },
  { path: "/integrations", name: "Integrations" },
  { path: "/network", name: "Network" },
  { path: "/config", name: "Config" },
  { path: "/hooks", name: "Hooks" },
  { path: "/sessions", name: "Sessions" },
  { path: "/analytics", name: "Analytics" },
  { path: "/feedback", name: "Feedback" },
  { path: "/security", name: "Security" },
  { path: "/self-improve", name: "Self-Improve" },
  { path: "/autonomous", name: "Autonomous" },
  { path: "/setup", name: "Setup" },
];

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Severities that fail CI (per the issue's acceptance criteria).
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

interface ViolationSummary {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: number;
  targets: string[];
}

interface PageReport {
  page: string;
  path: string;
  blocking: ViolationSummary[];
  advisory: ViolationSummary[];
}

const reports: PageReport[] = [];

test.afterAll(() => {
  const outDir = resolve(HERE, "../a11y-report");
  mkdirSync(outDir, { recursive: true });
  const totalBlocking = reports.reduce((n, r) => n + r.blocking.length, 0);
  const totalAdvisory = reports.reduce((n, r) => n + r.advisory.length, 0);
  const generatedAt = new Date().toISOString();

  writeFileSync(
    resolve(outDir, "baseline.json"),
    JSON.stringify({ generatedAt, wcagTags: WCAG_TAGS, totalBlocking, totalAdvisory, pages: reports }, null, 2),
  );

  const lines: string[] = [];
  lines.push("# WebUI Accessibility Audit Baseline");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`Rule set: ${WCAG_TAGS.join(", ")} (WCAG 2.1 Level A & AA)`);
  lines.push("");
  lines.push(`- Pages audited: **${reports.length}**`);
  lines.push(`- Blocking violations (critical/serious): **${totalBlocking}**`);
  lines.push(`- Advisory violations (moderate/minor): **${totalAdvisory}**`);
  lines.push("");
  lines.push("| Page | Path | Blocking | Advisory |");
  lines.push("| ---- | ---- | -------- | -------- |");
  for (const r of reports) {
    lines.push(`| ${r.page} | \`${r.path}\` | ${r.blocking.length} | ${r.advisory.length} |`);
  }
  lines.push("");
  const withBlocking = reports.filter((r) => r.blocking.length > 0);
  if (withBlocking.length > 0) {
    lines.push("## Blocking violations");
    lines.push("");
    for (const r of withBlocking) {
      lines.push(`### ${r.page} (\`${r.path}\`)`);
      lines.push("");
      for (const v of r.blocking) {
        lines.push(`- **${v.id}** (${v.impact}) — ${v.help}`);
        lines.push(`  - Nodes: ${v.nodes}; e.g. \`${v.targets.slice(0, 3).join("`, `")}\``);
        lines.push(`  - ${v.helpUrl}`);
      }
      lines.push("");
    }
  } else {
    lines.push("✅ No critical or serious violations found.");
    lines.push("");
  }
  writeFileSync(resolve(outDir, "summary.md"), lines.join("\n"));
});

function summarize(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): ViolationSummary[] {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? "unknown",
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    targets: v.nodes.flatMap((n) => n.target.map((t) => String(t))),
  }));
}

for (const route of ROUTES) {
  test(`a11y: ${route.name} (${route.path})`, async ({ page }) => {
    await mockBackend(page);
    // Disable CSS animations/transitions at the engine level so axe never samples
    // a colour mid-fade (entrance animations briefly lower opacity and produce
    // flaky `color-contrast` violations). This also mirrors WCAG 2.3.3 behaviour.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route.path, { waitUntil: "domcontentloaded" });

    // Give the SPA time to fetch mock data and render past loading states.
    await page.waitForLoadState("networkidle").catch(() => {});

    // Belt-and-braces: force every animation/transition to zero duration and
    // fast-forward any still-running animation to its final frame before scanning.
    await page.addStyleTag({
      content:
        "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }",
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try {
          a.finish();
        } catch {
          /* ignore animations that cannot be finished */
        }
      }
    });
    await page.waitForTimeout(150);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    const blocking = summarize(results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? "")));
    const advisory = summarize(results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? "")));
    reports.push({ page: route.name, path: route.path, blocking, advisory });

    if (blocking.length > 0) {
      const detail = blocking
        .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.targets.slice(0, 5).join(", ")}`)
        .join("\n");
      test.info().annotations.push({ type: "a11y-violations", description: detail });
    }

    expect(blocking, `Critical/serious a11y violations on ${route.name}:\n${blocking.map((v) => `${v.id} (${v.impact})`).join(", ")}`).toEqual([]);
  });
}
