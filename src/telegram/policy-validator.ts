import type { TelegramConfig } from "../config/schema.js";
import type { TelegramMessage } from "./bridge.js";

export interface PolicyDecision {
  shouldRespond: boolean;
  reason?: string;
}

const ALLOW: PolicyDecision = { shouldRespond: true };

function deny(reason: string): PolicyDecision {
  return { shouldRespond: false, reason };
}

export function validateDM(
  config: TelegramConfig,
  message: TelegramMessage,
  isAdmin: boolean
): PolicyDecision {
  switch (config.dm_policy) {
    case "disabled":
      return deny("DMs disabled");
    case "admin-only":
      return isAdmin ? ALLOW : deny("DMs restricted to admins");
    case "allowlist":
      if (isAdmin || config.allow_from.includes(message.senderId)) return ALLOW;
      return deny("Not in allowlist");
    case "open":
      return ALLOW;
  }
}

export function validateGroup(
  config: TelegramConfig,
  message: TelegramMessage,
  isAdmin: boolean
): PolicyDecision {
  const policyDecision = validateGroupPolicy(config, message, isAdmin);
  if (!policyDecision.shouldRespond) return policyDecision;

  if (config.require_mention && !message.mentionsMe) {
    return deny("Not mentioned");
  }

  return ALLOW;
}

function validateGroupPolicy(
  config: TelegramConfig,
  message: TelegramMessage,
  isAdmin: boolean
): PolicyDecision {
  switch (config.group_policy) {
    case "disabled":
      return deny("Groups disabled");
    case "admin-only":
      return isAdmin ? ALLOW : deny("Groups restricted to admins");
    case "allowlist": {
      const chatIdNum = Number(message.chatId);
      if (!Number.isInteger(chatIdNum) || !config.group_allow_from.includes(chatIdNum)) {
        return deny("Group not in allowlist");
      }
      return ALLOW;
    }
    case "open":
      return ALLOW;
  }
}
