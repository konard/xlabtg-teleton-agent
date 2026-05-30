import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "web/src/**/__tests__/**/*.test.ts",
      "packages/sdk/src/**/__tests__/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: [
        "src/**/*.ts",
        "packages/sdk/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
        // The web workspace has its own coverage scope; keep it out of the
        // backend/SDK report (otherwise web/src/lib/api.ts leaks in and skews
        // the totals the threshold gate runs against).
        "web/**",
      ],
      // Baseline thresholds derived from the current measured coverage with a
      // few points of margin below to absorb V8 variance between Node 20/22.
      // Ratchet these up over time as coverage improves.
      thresholds: {
        statements: 46,
        branches: 38,
        functions: 54,
        lines: 47,
      },
    },
    // Longer timeout for tests that import heavy deps (GramJS, @ton/ton)
    testTimeout: 10_000,
  },
});
