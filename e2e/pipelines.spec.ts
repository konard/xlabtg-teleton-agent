import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

// Smoke test 6: Create and save a pipeline. Clicking "+ New Pipeline" opens the
// "Create Pipeline" modal; after filling in a name and clicking "Save" the
// backend persists it (api.pipelinesCreate) and the new pipeline appears in the
// list on the left.
test("create and save a new pipeline", async ({ page }) => {
  await setupMockBackend(page);

  await page.goto("/pipelines");

  await expect(page.getByRole("heading", { name: "Pipelines", exact: true })).toBeVisible();

  // Open the create modal.
  await page.getByRole("button", { name: "+ New Pipeline" }).click();

  const modal = page.locator(".modal");
  await expect(modal.getByRole("heading", { name: "Create Pipeline" })).toBeVisible();

  // Fill in the pipeline name (the Name field is the first form-group input).
  const nameField = modal
    .locator(".form-group")
    .filter({ has: page.getByText("Name", { exact: true }) })
    .getByRole("textbox");
  await nameField.fill("Daily market digest");

  // Save the pipeline.
  await modal.getByRole("button", { name: "Save", exact: true }).click();

  // The modal closes and the new pipeline is listed (and auto-selected, so its
  // name appears both in the list and as the detail panel heading).
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Daily market digest/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily market digest" })).toBeVisible();
});
