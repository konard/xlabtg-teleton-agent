import { test, expect } from "@playwright/test";
import { setupMockBackend, type MemorySourceFixture } from "./fixtures/mock-backend";

// Smoke test 5: Memory search — entering a query filters the indexed sources
// and the matching results render (the Sources tab uses a client-side filter
// over the "Filter sources..." input).
test("memory search filters the indexed sources", async ({ page }) => {
  const sources: MemorySourceFixture[] = [
    { source: "workspace/notes.md", entryCount: 12, lastUpdated: Date.UTC(2026, 0, 1) },
    { source: "research/ton-defi.md", entryCount: 5, lastUpdated: Date.UTC(2026, 0, 1) },
    { source: "conversations/archive.md", entryCount: 31, lastUpdated: Date.UTC(2026, 0, 1) },
  ];
  await setupMockBackend(page, { sources });

  await page.goto("/memory");

  await expect(page.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();

  // All sources visible initially.
  await expect(page.getByText("workspace/notes.md")).toBeVisible();
  await expect(page.getByText("research/ton-defi.md")).toBeVisible();
  await expect(page.getByText("conversations/archive.md")).toBeVisible();

  // Filter by a query that matches a single source.
  await page.getByPlaceholder("Filter sources...").fill("ton-defi");

  await expect(page.getByText("research/ton-defi.md")).toBeVisible();
  await expect(page.getByText("workspace/notes.md")).toHaveCount(0);
  await expect(page.getByText("conversations/archive.md")).toHaveCount(0);
});
