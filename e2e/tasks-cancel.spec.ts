import { test, expect } from "@playwright/test";
import { setupMockBackend, type TaskFixture } from "./fixtures/mock-backend";

// Smoke test 4: Cancel a running task. The ✖ button (title="Cancel") is shown
// only for pending/in_progress tasks; clicking it opens a confirm dialog whose
// action button reads "Cancel Task". After confirming, the backend marks the
// task cancelled and the list reloads with the new status badge.
test("cancel a running task updates its status", async ({ page }) => {
  const seeded: TaskFixture[] = [
    {
      id: "task-running-1",
      description: "Long running market analysis",
      status: "in_progress",
      priority: 1,
      createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).toISOString(),
      dependencies: [],
      dependents: [],
    },
  ];
  await setupMockBackend(page, { tasks: seeded });

  await page.goto("/tasks");

  await expect(page.getByText("Long running market analysis")).toBeVisible();
  // The running task shows the "Running" status badge.
  await expect(page.getByText("Running", { exact: true }).last()).toBeVisible();

  // Click the cancel (✖) icon button — its title attribute is "Cancel".
  await page.locator('button[title="Cancel"]').click();

  // Confirm dialog action button.
  await page.getByRole("button", { name: "Cancel Task", exact: true }).click();

  // After reload the task shows the Cancelled badge.
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Long running market analysis")).toBeVisible();
});
