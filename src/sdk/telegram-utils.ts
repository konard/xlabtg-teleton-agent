import type { ITelegramBridge } from "../telegram/bridge-interface.js";
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
  if (bridge.getMode() !== "user") {
    throw new Error(
      "This tool requires user mode — it relies on an MTProto capability the Bot API does not provide."
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- user-only escape hatch, cast to GramJS client
  return (bridge.getRawClient() as any).getClient();
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
