/**
 * Utility functions for deals system
 */

import { DEALS_CONFIG } from "./config.js";

/**
 * Generate a random deal ID (8 characters)
 */
export function generateDealId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "deal_";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Format asset for display
 */
export function formatAsset(
  type: "ton" | "gift",
  tonAmount?: number | null,
  giftSlug?: string | null
): string {
  if (type === "ton") {
    return `${tonAmount || 0} TON`;
  } else {
    return `Gift: ${giftSlug || "Unknown"}`;
  }
}

/**
 * Calculate deal expiry timestamp (2 minutes from now)
 */
export function calculateExpiry(): number {
  return Math.floor(Date.now() / 1000) + DEALS_CONFIG.expirySeconds;
}

/**
 * Format deal proposal message with inline buttons
 */
export function formatDealProposal(
  dealId: string,
  userGives: { type: "ton" | "gift"; tonAmount?: number; giftSlug?: string; valueTon: number },
  agentGives: { type: "ton" | "gift"; tonAmount?: number; giftSlug?: string; valueTon: number },
  _profit: number,
  _strategyCompliant: boolean
): string {
  const userGivesStr = formatAsset(userGives.type, userGives.tonAmount, userGives.giftSlug);
  const agentGivesStr = formatAsset(agentGives.type, agentGives.tonAmount, agentGives.giftSlug);

  return `📋 **Deal** #${dealId}

📤 You send: ${userGivesStr}
📥 You receive: ${agentGivesStr}
⏱ Expires in ${Math.round(DEALS_CONFIG.expirySeconds / 60)} minutes`;
}
