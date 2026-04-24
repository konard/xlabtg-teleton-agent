import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { PolicyEngine } from "../../../services/policy-engine.js";
import { ApprovalGate } from "../../../services/approval-gate.js";
import { validateToolExecution } from "../validation.js";
import type { ToolContext } from "../types.js";

describe("validateToolExecution", () => {
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(() => {
    db = new Database(":memory:");
    context = {
      bridge: { sendMessage: vi.fn(async () => undefined) } as never,
      db,
      chatId: "dm",
      senderId: 123,
      isGroup: false,
      config: {
        telegram: { admin_ids: [999] },
      } as never,
    };
  });

  afterEach(() => {
    db.close();
  });

  it("allows tool execution by default", async () => {
    const result = await validateToolExecution({
      db,
      tool: "workspace_read",
      params: { path: "notes.md" },
      context,
    });

    expect(result.decision).toBe("allow");
  });

  it("denies matching policies before execution", async () => {
    new PolicyEngine(db).createPolicy({
      name: "block-exec",
      match: { tool: "exec_run" },
      action: "deny",
      reason: "exec is disabled",
    });

    const result = await validateToolExecution({
      db,
      tool: "exec_run",
      params: { command: "ls" },
      context,
    });

    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("exec is disabled");
  });

  it("creates an approval request and allows an approved retry once", async () => {
    new PolicyEngine(db).createPolicy({
      name: "approve-writes",
      match: { tool: "workspace_write" },
      action: "require_approval",
      reason: "File writes require approval",
    });

    const first = await validateToolExecution({
      db,
      tool: "workspace_write",
      params: { path: "notes.md", content: "hello" },
      context,
    });

    expect(first.decision).toBe("require_approval");
    expect(first.approvalId).toBeTruthy();

    const gate = new ApprovalGate(db);
    gate.approve(first.approvalId!, { resolvedBy: 999 });

    const second = await validateToolExecution({
      db,
      tool: "workspace_write",
      params: { path: "notes.md", content: "hello" },
      context,
    });
    const third = await validateToolExecution({
      db,
      tool: "workspace_write",
      params: { path: "notes.md", content: "hello" },
      context,
    });

    expect(second.decision).toBe("allow");
    expect(second.reason).toContain("Approved");
    expect(third.decision).toBe("require_approval");
  });
});
