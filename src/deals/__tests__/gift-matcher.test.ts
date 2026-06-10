import { describe, expect, it } from "vitest";
import { verifyGiftPayment } from "../gift-matcher.js";
import type { Deal, ReceivedGift } from "../types.js";

/**
 * Regression for WORK4-013: gift-based payment verification could never match
 * because the sender (fromId) was missing and timestamps mixed seconds/ms.
 * These tests pin the matching contract: same slug + same buyer + received
 * after deal creation, all compared in milliseconds.
 */
describe("verifyGiftPayment", () => {
  const nowSeconds = 1_700_000_000; // deal.created_at is epoch seconds

  const deal: Pick<Deal, "user_gives_gift_slug" | "user_telegram_id" | "created_at"> = {
    user_gives_gift_slug: "PlushPepe-1",
    user_telegram_id: 123,
    created_at: nowSeconds,
  };

  const matchingGift: ReceivedGift = {
    msgId: "10",
    slug: "PlushPepe-1",
    name: "Plush Pepe",
    fromUserId: 123,
    receivedAt: nowSeconds * 1000 + 5_000, // ms, just after deal creation
  };

  it("verifies a deal when a matching gift arrives from the buyer", () => {
    const result = verifyGiftPayment(deal, [matchingGift]);
    expect(result.verified).toBe(true);
    expect(result.gift).toBe(matchingGift);
  });

  it("rejects a gift sent by a different user", () => {
    const wrongSender: ReceivedGift = { ...matchingGift, fromUserId: 999 };
    expect(verifyGiftPayment(deal, [wrongSender]).verified).toBe(false);
  });

  it("rejects a gift with a different slug", () => {
    const wrongSlug: ReceivedGift = { ...matchingGift, slug: "OtherGift-2" };
    expect(verifyGiftPayment(deal, [wrongSlug]).verified).toBe(false);
  });

  it("rejects a gift received before the deal was created", () => {
    const tooEarly: ReceivedGift = {
      ...matchingGift,
      receivedAt: nowSeconds * 1000 - 1_000,
    };
    expect(verifyGiftPayment(deal, [tooEarly]).verified).toBe(false);
  });

  it("does not match when a seconds-valued timestamp leaks in (unit guard)", () => {
    // If receivedAt were left in seconds it would be far below created_at*1000
    // and must NOT verify — this guards against the original unit bug.
    const secondsTimestamp: ReceivedGift = {
      ...matchingGift,
      receivedAt: nowSeconds + 5,
    };
    expect(verifyGiftPayment(deal, [secondsTimestamp]).verified).toBe(false);
  });
});
