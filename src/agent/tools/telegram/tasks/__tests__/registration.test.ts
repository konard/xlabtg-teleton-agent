import { describe, it, expect } from "vitest";
import { tools } from "../index.js";

// Regression guard for issue #653: the task-management tools (list/get/cancel/update)
// were fully implemented and tested but never added to the `tools` ToolEntry array,
// so the agent could create scheduled tasks yet had no way to query, inspect, cancel,
// or update them by UUID. This test ensures all task lifecycle tools stay registered.
describe("task tools registration (issue #653)", () => {
  const registeredNames = tools.map((entry) => entry.tool.name);

  const expectedTools = [
    "telegram_create_scheduled_task",
    "telegram_list_tasks",
    "telegram_get_task",
    "telegram_cancel_task",
    "telegram_update_task",
  ];

  it.each(expectedTools)("registers %s", (name) => {
    expect(registeredNames).toContain(name);
  });

  it("every registered task tool has an executor, mode, and automation tag", () => {
    for (const entry of tools) {
      expect(typeof entry.executor).toBe("function");
      expect(entry.mode).toBe("user");
      expect(entry.tags).toContain("automation");
    }
  });
});
