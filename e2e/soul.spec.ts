import { test, expect } from "@playwright/test";
import { setupMockBackend } from "./fixtures/mock-backend";

test("discarding one Soul tab cannot save its content into another tab", async ({ page }) => {
  const updates: Array<{ filename: string; content: string }> = [];
  const originalStrategy = "# STRATEGY\n\nOriginal strategy content.";
  const discardedSoul = "# SOUL\n\nDiscarded local edit.";

  await setupMockBackend(page, {
    soulFiles: {
      "SOUL.md": "# SOUL\n\nOriginal soul content.",
      "STRATEGY.md": originalStrategy,
    },
    soulLoadDelayMs: { "STRATEGY.md": 1_000 },
    onSoulUpdate: (filename, content) => {
      updates.push({ filename, content });
    },
  });

  await page.goto("/soul");
  await expect(page.getByRole("heading", { name: "Soul Editor", exact: true })).toBeVisible();
  await expect(page.getByText("Original soul content.")).toBeVisible();

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(discardedSoul);
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "STRATEGY.md" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Loading...")).toBeVisible();

  await page.keyboard.press("Control+S");
  await page.waitForTimeout(250);

  expect(updates).not.toContainEqual({ filename: "STRATEGY.md", content: discardedSoul });

  await expect(page.getByText("Original strategy content.")).toBeVisible();
  expect(updates).not.toContainEqual({ filename: "STRATEGY.md", content: discardedSoul });
});
