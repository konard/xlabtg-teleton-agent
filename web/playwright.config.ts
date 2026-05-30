import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the WebUI accessibility (a11y) suite.
 *
 * The suite builds the production bundle, serves it with `vite preview`, mocks
 * the management API, and runs axe-core against every WebUI route. CI fails on
 * any `critical` or `serious` WCAG 2.1 A/AA violation.
 *
 * Run locally with:
 *   npm run test:a11y          # run the audit
 *   npm run test:a11y -- --ui  # debug interactively
 */
const PORT = Number(process.env.A11Y_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  // A11y checks are independent per page; run them in parallel.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // `vite preview` serves the already-built bundle from ../dist/web.
  // The build step runs in CI before this suite, so `reuseExistingServer`
  // keeps local iterations fast.
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
