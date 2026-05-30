import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

// Smoke test 7: Settings/Security — change a setting, save it, reload the page
// and verify the new value persisted. The Security Center "Settings" tab holds
// the rate-limit control; saving issues a PUT that the mock backend persists,
// so a subsequent reload reflects the updated value.
test("changed security setting persists across reload", async ({ page }) => {
  await setupMockBackend(page);

  await page.goto("/security");

  await expect(page.getByRole("heading", { name: "Security Center", exact: true })).toBeVisible();

  // Open the Settings tab.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Security Settings" })).toBeVisible();

  // The default rate limit (120 req/min) is shown in the readout.
  await expect(page.getByText("120 req/min")).toBeVisible();

  // Change the rate limit and save.
  const rateLimit = page.getByPlaceholder("Leave empty to disable");
  await rateLimit.fill("250");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // Reload and confirm the new value was persisted by the backend.
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("250 req/min")).toBeVisible();
});
