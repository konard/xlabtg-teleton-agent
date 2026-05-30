import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

// Smoke test 2: Dashboard loads with the agent status visible.
test("dashboard loads and shows the running agent status", async ({ page }) => {
  await setupMockBackend(page);

  await page.goto("/");

  // Dashboard heading from Dashboard.tsx (rendered once data loads).
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("System overview")).toBeVisible();

  // The data-load guard ("Failed to load dashboard data") must not appear.
  await expect(page.getByText("Failed to load dashboard data")).toHaveCount(0);

  // AgentControl in the sidebar reflects the SSE "running" state.
  await expect(page.getByText("Running", { exact: true }).first()).toBeVisible();
});
