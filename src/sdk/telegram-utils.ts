import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { isUserBridge } from "../telegram/bridge-guards.js";
import type { Api } from "telegram";
import type { SimpleMessage } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";

export function requireBridge(bridge: ITelegramBridge): void {
  if (!bridge.isAvailable()) {
    throw new PluginSDKError(
      "Telegram bridge not connected. SDK telegram methods can only be called at runtime (inside tool executors or start()), not during plugin loading.",
      "BRIDGE_NOT_CONNECTED"
    );
  }
}

export function getClient(bridge: ITelegramBridge) {
  if (!isUserBridge(bridge)) {
    throw new Error(
      "This tool requires user mode — it relies on an MTProto capability the Bot API does not provide."
    );
  }
  return bridge.getClient().getClient();
}

/** Canonical public-username rule for channels/groups (5-32 chars, no leading/trailing underscore). */
const CHANNEL_USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

/** Strip a leading "@" from a username. */
export function cleanUsername(input: string): string {
  return input.replace(/^@/, "");
}

/**
 * Validate a channel/group public username against the canonical Telegram rule.
 * Pass `allowEmpty` when an empty value is meaningful (e.g. removing a username).
 */
export function validateChannelUsername(
  input: string,
  options: { allowEmpty?: boolean } = {}
): { ok: true; clean: string } | { ok: false; error: string } {
  const clean = cleanUsername(input);
  const invalid = clean.length === 0 ? !options.allowEmpty : !CHANNEL_USERNAME_REGEX.test(clean);
  if (invalid) {
    return {
      ok: false,
      error:
        "Invalid username format. Must be 5-32 characters, alphanumeric and underscores only, cannot start/end with underscore.",
    };
  }
  return { ok: true, clean };
}

/** Convert a GramJS message to a SimpleMessage */
export function toSimpleMessage(msg: Api.Message): SimpleMessage {
  const fromId = msg.fromId;
  let senderId = 0;
  if (fromId) {
    if ("userId" in fromId) senderId = Number(fromId.userId);
    else if ("channelId" in fromId) senderId = Number(fromId.channelId);
    else if ("chatId" in fromId) senderId = Number(fromId.chatId);
  }
  return {
    id: msg.id,
    text: msg.message ?? "",
    senderId,
    timestamp: new Date(msg.date * 1000),
  };
}

/** Cached dynamic import of telegram Api (needed in files with type-only imports) */
let _Api: typeof Api;
export async function getApi(): Promise<typeof Api> {
  if (!_Api) {
    _Api = (await import("telegram")).Api;
  }
  return _Api;
}
