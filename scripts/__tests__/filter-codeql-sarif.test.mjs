import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { filterSarif, filterSarifFile } from "../filter-codeql-sarif.mjs";

function result(ruleId, uri, startLine) {
  return {
    ruleId,
    message: { text: "test result" },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri },
          region: { startLine },
        },
      },
    ],
  };
}

test("filterSarif removes only accepted CodeQL network-to-file alerts", () => {
  const acceptedTts = result("js/http-to-file-access", "src/services/tts.ts", 85);
  const acceptedDownload = result(
    "js/http-to-file-access",
    "src/agent/tools/web/download-binary.ts",
    152
  );
  const unexpectedSameRule = result("js/http-to-file-access", "src/services/unsafe.ts", 10);
  const unexpectedOtherRule = result(
    "js/weak-sensitive-data-hashing",
    "src/services/cache.ts",
    145
  );

  const { sarif, suppressed } = filterSarif({
    version: "2.1.0",
    runs: [
      {
        results: [acceptedTts, acceptedDownload, unexpectedSameRule, unexpectedOtherRule],
      },
    ],
  });

  assert.equal(suppressed, 2);
  assert.deepEqual(sarif.runs[0].results, [unexpectedSameRule, unexpectedOtherRule]);
});

test("filterSarifFile rewrites SARIF in place", () => {
  const dir = mkdtempSync(join(tmpdir(), "teleton-sarif-"));
  const path = join(dir, "codeql.sarif");

  try {
    writeFileSync(
      path,
      JSON.stringify({
        version: "2.1.0",
        runs: [{ results: [result("js/http-to-file-access", "src/services/tts.ts", 84)] }],
      })
    );

    assert.equal(filterSarifFile(path), 1);

    const rewritten = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(rewritten.runs[0].results, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
