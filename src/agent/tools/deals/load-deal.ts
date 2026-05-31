import type Database from "better-sqlite3";
import type { Deal } from "../../../deals/types.js";

export type LoadDealResult = { ok: true; deal: Deal } | { ok: false; error: string };

/**
 * Load a deal by id and enforce owner/admin access in one place. `action` fills
 * the scoping error ("⛔ You can only <action> your own deals."), e.g. "cancel".
 */
export function loadDealForActor(
  db: Database.Database,
  dealId: string,
  senderId: number,
  adminIds: number[],
  action: string
): LoadDealResult {
  const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) as Deal | undefined;
  if (!deal) {
    return { ok: false, error: `Deal #${dealId} not found` };
  }
  if (senderId !== deal.user_telegram_id && !adminIds.includes(senderId)) {
    return { ok: false, error: `⛔ You can only ${action} your own deals.` };
  }
  return { ok: true, deal };
}
