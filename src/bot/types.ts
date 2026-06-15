/**
 * Types for the deals inline bot
 */

import type { MtprotoProxyEntry } from "../config/schema.js";

export interface BotConfig {
  token: string;
  username: string;
  apiId?: number;
  apiHash?: string;
  gramjsSessionPath?: string;
  /** MTProto proxy servers (tried in order, failover to next on connection error) */
  mtprotoProxies?: MtprotoProxyEntry[];
  /** HTTP/HTTPS/SOCKS proxy URL for Telegram Bot API HTTPS calls to api.telegram.org */
  botApiProxyUrl?: string;
}

export interface DealContext {
  dealId: string;
  userId: number;
  username?: string;
  chatId: string;
  userGivesType: "ton" | "gift";
  userGivesTonAmount?: number;
  userGivesGiftSlug?: string;
  userGivesValueTon: number;
  agentGivesType: "ton" | "gift";
  agentGivesTonAmount?: number;
  agentGivesGiftSlug?: string;
  agentGivesValueTon: number;
  profitTon: number;
  status: DealStatus;
  createdAt: number;
  expiresAt: number;
  inlineMessageId?: string;
  paymentClaimedAt?: number;
  verifiedAt?: number;
  completedAt?: number;
  agentWallet?: string;
}

export type DealStatus =
  | "proposed"
  | "accepted"
  | "payment_claimed"
  | "verified"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled"
  | "failed";

export type MessageState =
  | "proposal" // Accept/Decline buttons
  | "accepted" // Payment/gift instructions + "I've sent"
  | "payment_claimed" // Verifying...
  | "verified" // Sending agent's part...
  | "completed" // Final recap
  | "declined" // Declined message
  | "expired" // Expired message
  | "failed"; // Error message

export interface CallbackData {
  action: "accept" | "decline" | "sent" | "copy_addr" | "copy_memo" | "refresh";
  dealId: string;
}

/**
 * Split a `prefix:rest` string on its first colon.
 * Returns null if there is no colon, or the colon is the first character
 * (i.e. there is no non-empty prefix). The `rest` may itself contain colons.
 *
 * Shared routing primitive: the inline-router uses this to peel a plugin prefix
 * off inline queries / callback data / chosen-result ids before dispatch.
 */
export function splitPrefix(raw: string): { prefix: string; rest: string } | null {
  const colonIdx = raw.indexOf(":");
  if (colonIdx <= 0) return null;
  return { prefix: raw.slice(0, colonIdx), rest: raw.slice(colonIdx + 1) };
}

export function encodeCallback(data: CallbackData): string {
  return `${data.action}:${data.dealId}`;
}

/**
 * Callback-data routing contract (Grammy `callback_query:data` middleware chain).
 *
 * Two prefix conventions co-route in the same Grammy dispatch, distinguished by
 * the first `:`-delimited segment:
 *
 *   - DealBot RESERVES these six action prefixes, decoded here as `action:dealId`
 *     (exactly one colon): accept · decline · sent · copy_addr · copy_memo · refresh.
 *     decodeCallback returns null for anything else, so DealBot ignores it.
 *   - Every OTHER prefix belongs to a registered plugin and is claimed by the
 *     InlineRouter middleware (installed BEFORE DealBot) via its `prefix:rest`
 *     split; unmatched prefixes fall through to DealBot.
 *
 * New DealBot actions must be added to BOTH the union below and the whitelist in
 * decodeCallback; plugins must avoid these reserved prefixes to prevent collisions.
 */
export function decodeCallback(raw: string): CallbackData | null {
  const parts = raw.split(":");
  if (parts.length !== 2) return null;

  const action = parts[0] as CallbackData["action"];
  const dealId = parts[1];

  if (!["accept", "decline", "sent", "copy_addr", "copy_memo", "refresh"].includes(action)) {
    return null;
  }

  return { action, dealId };
}
