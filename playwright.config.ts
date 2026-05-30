import { defineConfig, devices } from "@playwright/test";

// E2E configuration for the Teleton WebUI smoke suite.
//
// The suite runs against the production build (dist/web) served by a tiny
// static file server (e2e/static-server.mjs). The backend is fully mocked in
// the browser via page.route() (see e2e/fixtures/mock-backend.ts), so the
// tests are deterministic, need no credentials and are safe to run on forks.

const PORT = Number(process.env.E2E_PORT) || 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node e2e/static-server.mjs",
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
});
