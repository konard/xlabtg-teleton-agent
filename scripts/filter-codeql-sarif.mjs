#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUPPRESSED_RESULTS = [
  // These sinks write validated, size-capped network payloads to controlled paths.
  {
    ruleId: "js/http-to-file-access",
    uri: "src/services/tts.ts",
    startLineMin: 80,
    startLineMax: 90,
  },
  {
    ruleId: "js/http-to-file-access",
    uri: "src/agent/tools/web/download-binary.ts",
    startLineMin: 148,
    startLineMax: 156,
  },
];

function normalizeUri(uri) {
  return String(uri ?? "")
    .replaceAll("\\", "/")
    .replace(/^file:\/\/\/?/, "");
}

function primaryLocation(result) {
  return result.locations?.[0]?.physicalLocation;
}

function matchesSuppression(result, suppression) {
  if (result.ruleId !== suppression.ruleId) return false;

  const location = primaryLocation(result);
  const uri = normalizeUri(location?.artifactLocation?.uri);
  const startLine = location?.region?.startLine;
  if (typeof startLine !== "number") return false;

  const sameFile = uri === suppression.uri || uri.endsWith(`/${suppression.uri}`);
  return sameFile && startLine >= suppression.startLineMin && startLine <= suppression.startLineMax;
}

export function filterSarif(sarif) {
  let suppressed = 0;

  for (const run of sarif.runs ?? []) {
    if (!Array.isArray(run.results)) continue;

    const keptResults = [];
    for (const result of run.results) {
      if (SUPPRESSED_RESULTS.some((suppression) => matchesSuppression(result, suppression))) {
        suppressed += 1;
      } else {
        keptResults.push(result);
      }
    }
    run.results = keptResults;
  }

  return { sarif, suppressed };
}

export function filterSarifFile(path) {
  const sarif = JSON.parse(readFileSync(path, "utf8"));
  const result = filterSarif(sarif);
  writeFileSync(path, `${JSON.stringify(result.sarif, null, 2)}\n`);
  return result.suppressed;
}

function collectSarifFiles(path) {
  const status = statSync(path);
  if (status.isFile()) return path.endsWith(".sarif") ? [path] : [];
  if (!status.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const childPath = `${path.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) return collectSarifFiles(childPath);
    return entry.isFile() && entry.name.endsWith(".sarif") ? [childPath] : [];
  });
}

function runCli() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/filter-codeql-sarif.mjs <sarif-file-or-directory>");
    process.exitCode = 2;
    return;
  }

  const files = collectSarifFiles(target);
  if (files.length === 0) {
    console.error(`No SARIF files found in ${target}`);
    process.exitCode = 1;
    return;
  }

  let totalSuppressed = 0;
  for (const file of files) {
    const suppressed = filterSarifFile(file);
    totalSuppressed += suppressed;
    console.log(`Filtered ${suppressed} accepted CodeQL result(s) from ${file}`);
  }
  console.log(`Filtered ${totalSuppressed} accepted CodeQL result(s) total`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
