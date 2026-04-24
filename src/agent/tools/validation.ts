import type { Database } from "better-sqlite3";
import type { ToolContext } from "./types.js";
import { ApprovalGate } from "../../services/approval-gate.js";
import { PolicyEngine, type PolicyAction } from "../../services/policy-engine.js";
import { getNotificationService, notificationBus } from "../../services/notifications.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ToolValidation");

export interface ToolValidationInput {
  db: Database;
  tool: string;
  params: unknown;
  context: ToolContext;
  module?: string | null;
}

export interface ToolValidationResult {
  decision: PolicyAction;
  reason: string;
  approvalId?: string;
}

export async function validateToolExecution(
  input: ToolValidationInput
): Promise<ToolValidationResult> {
  const policyEngine = new PolicyEngine(input.db);
  const approvalGate = new ApprovalGate(input.db);
  const evaluation = policyEngine.evaluate({
    tool: input.tool,
    params: input.params,
    senderId: input.context.senderId,
    chatId: input.context.chatId,
    module: input.module ?? null,
  });

  if (evaluation.action === "allow") {
    policyEngine.recordValidation({
      tool: input.tool,
      params: input.params,
      action: "allow",
      reason: evaluation.reason,
      policy: evaluation.policy,
    });
    return { decision: "allow", reason: evaluation.reason };
  }

  if (evaluation.action === "deny") {
    policyEngine.recordValidation({
      tool: input.tool,
      params: input.params,
      action: "deny",
      reason: evaluation.reason,
      policy: evaluation.policy,
    });
    return { decision: "deny", reason: evaluation.reason };
  }

  const approved = approvalGate.consumeApproved({
    tool: input.tool,
    params: input.params,
    requesterId: input.context.senderId,
  });
  if (approved) {
    const reason = `Approved by ${approved.resolved_by ?? "an approver"}`;
    policyEngine.recordValidation({
      tool: input.tool,
      params: input.params,
      action: "allow",
      reason,
      policy: evaluation.policy,
      approvalId: approved.id,
    });
    return { decision: "allow", reason };
  }

  const approval = approvalGate.create({
    tool: input.tool,
    params: input.params,
    requesterId: input.context.senderId,
    chatId: input.context.chatId,
    reason: evaluation.reason,
    policyId: evaluation.policy?.id ?? null,
    policyName: evaluation.policy?.name ?? null,
  });
  await notifyApprovalRequest(input.context, input.tool, approval.id, evaluation.reason);

  policyEngine.recordValidation({
    tool: input.tool,
    params: input.params,
    action: "require_approval",
    reason: evaluation.reason,
    policy: evaluation.policy,
    approvalId: approval.id,
  });

  return {
    decision: "require_approval",
    reason: evaluation.reason,
    approvalId: approval.id,
  };
}

async function notifyApprovalRequest(
  context: ToolContext,
  tool: string,
  approvalId: string,
  reason: string
): Promise<void> {
  const text = [
    "Tool execution requires approval.",
    `Tool: ${tool}`,
    `Approval: ${approvalId}`,
    `Reason: ${reason}`,
  ].join("\n");

  const adminIds = context.config?.telegram.admin_ids ?? [];
  for (const adminId of adminIds) {
    try {
      await context.bridge.sendMessage({
        chatId: String(adminId),
        text,
      });
    } catch (err) {
      log.warn({ err, adminId, approvalId }, "failed to notify Telegram approver");
    }
  }

  try {
    const svc = getNotificationService(context.db);
    svc.add("warning", "Tool approval required", `${tool}: ${reason}`);
    notificationBus.emit("update", svc.unreadCount());
    notificationBus.emit("approval", { approvalId, tool, reason });
  } catch (err) {
    log.warn({ err, approvalId }, "failed to record approval notification");
  }
}
