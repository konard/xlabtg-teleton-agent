import { test, expect } from "@playwright/test";
import { setupMockBackend, type TaskFixture } from "./fixtures/mock-backend";

// Smoke test 3: Tasks list renders seeded tasks (the agent's task queue).
// The WebUI has no manual "create task" form — tasks are produced by the
// agent — so we seed a task through the backend and assert it appears in the
// list, which is the user-visible contract this test guards.
test("seeded task appears in the task list", async ({ page }) => {
  const seeded: TaskFixture[] = [
    {
      id: "task-created-1",
      description: "Newly queued task from the agent",
      status: "pending",
      priority: 1,
      createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)).toISOString(),
      dependencies: [],
      dependents: [],
    },
  ];
  await setupMockBackend(page, { tasks: seeded });

  await page.goto("/tasks");

  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByText("Newly queued task from the agent")).toBeVisible();
});
