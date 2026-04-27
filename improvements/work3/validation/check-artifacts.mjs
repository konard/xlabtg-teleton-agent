#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const reportPath = join(root, "AUDIT_V2_REPORT.md");
const issuesDir = join(root, "issues");

const requiredIssueFields = [
  "title",
  "labels",
  "milestone",
  "audit-source",
  "finding-id",
  "severity",
  "category",
];

const requiredHeadings = [
  "## Problem Description",
  "## Location",
  "## How To Reproduce",
  "## Impact",
  "## Proposed Fix",
  "## Regression Test",
  "## Acceptance Criteria",
  "## Related Artifacts",
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!existsSync(reportPath)) {
  fail(`Missing report: ${reportPath}`);
} else {
  const report = readFileSync(reportPath, "utf8");
  for (const id of ["V2-001", "V2-002", "V2-003", "V2-004", "V2-005"]) {
    if (!report.includes(id)) fail(`Report does not reference ${id}`);
  }
}

if (!existsSync(issuesDir)) {
  fail(`Missing issues directory: ${issuesDir}`);
} else {
  const files = readdirSync(issuesDir)
    .filter((file) => file.endsWith(".md"))
    .sort();
  if (files.length !== 5) fail(`Expected 5 issue files, found ${files.length}`);

  for (const file of files) {
    const body = readFileSync(join(issuesDir, file), "utf8");
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      fail(`${file}: missing YAML frontmatter`);
      continue;
    }
    for (const field of requiredIssueFields) {
      if (!new RegExp(`^${field}:`, "m").test(frontmatter[1])) {
        fail(`${file}: missing frontmatter field ${field}`);
      }
    }
    for (const heading of requiredHeadings) {
      if (!body.includes(heading)) fail(`${file}: missing ${heading}`);
    }
  }
}

if (process.exitCode) {
  process.exit();
}

console.log("work3 audit artifacts are structurally valid");
