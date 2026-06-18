/**
 * Regression checker.
 *
 * Compares a fresh benchmark run against the committed baseline and exits
 * non-zero when any tracked metric's mean time per operation degrades beyond the
 * threshold (default 20%). Wired into CI for PRs touching performance-sensitive
 * code paths (`src/memory/`, `src/agent(s)/`, `src/ton/`).
 *
 * Usage:
 *   tsx benchmarks/check-regression.ts [--baseline <file>] [--current <file>] [--threshold 20]
 *
 * If `--current` is omitted, the suite is run in-process first.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BenchReport } from "./lib/harness.js";
import { detectRegressions, formatRegressionReport } from "./lib/regression.js";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): {
  baseline: string;
  current?: string;
  threshold: number;
  summary?: string;
} {
  let baseline = resolve(here, "baseline.json");
  let current: string | undefined;
  let threshold = 20;
  let summary: string | undefined;
  let runs = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--baseline") baseline = resolve(argv[++i]);
    else if (argv[i] === "--current") current = resolve(argv[++i]);
    else if (argv[i] === "--threshold") threshold = Number(argv[++i]);
    else if (argv[i] === "--summary") summary = resolve(argv[++i]);
    else if (argv[i] === "--runs") runs = Math.max(1, Number(argv[++i]) || 1);
  }
  return { baseline, current, threshold, summary, runs };
}

function loadReport(path: string): BenchReport {
  return JSON.parse(readFileSync(path, "utf8")) as BenchReport;
}

async function main(): Promise<void> {
  const { baseline, current, threshold, summary, runs } = parseArgs(process.argv.slice(2));

  if (!existsSync(baseline)) {
    console.error(`No baseline found at ${baseline}. Generate one with: npm run bench:update-baseline`);
    process.exit(1);
  }

  let currentPath = current;
  if (!currentPath) {
    // Run the suite in-process and write to a temp results file.
    const { spawnSync } = await import("node:child_process");
    currentPath = resolve(here, "results.json");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(here, "run.ts"), "--json", currentPath, "--runs", String(runs), "--quiet"],
      { stdio: "inherit" }
    );
    if (result.status !== 0) {
      throw new Error(`Benchmark suite failed with exit code ${result.status ?? "unknown"}`);
    }
  }

  const baselineReport = loadReport(baseline);
  const currentReport = loadReport(currentPath);

  const report = detectRegressions(baselineReport.results, currentReport.results, {
    thresholdPct: threshold,
  });

  const text = formatRegressionReport(report);
  console.log(text);

  if (summary) {
    // Append so we don't clobber existing GitHub step-summary content.
    appendFileSync(summary, `## Benchmark regression check\n\n${text}\n`);
  }

  process.exit(report.failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Regression check failed:", err);
  process.exit(1);
});
