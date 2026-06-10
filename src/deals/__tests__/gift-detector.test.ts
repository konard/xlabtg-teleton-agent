import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const { mockExecutor } = vi.hoisted(() => ({ mockExecutor: vi.fn() }));

vi.mock("../../agent/tools/telegram/gifts/get-my-gifts.js", () => ({
  telegramGetMyGiftsExecutor: mockExecutor,
}));

import { GiftDetector } from "../gift-detector.js";
import type { ToolContext } from "../../agent/tools/types.js";

const context = {} as ToolContext;

describe("GiftDetector.detectNewGifts", () => {
  beforeEach(() => {
    mockExecutor.mockReset();
  });

  it("populates fromUserId and normalizes date (seconds) to ms", async () => {
    const dateSeconds = 1_700_000_000;
    mockExecutor.mockResolvedValue({
      success: true,
      data: {
        gifts: [
          {
            msgId: "1",
            slug: "PlushPepe-1",
            title: "Plush Pepe",
            fromId: "123",
            fromUsername: "buyer",
            date: dateSeconds,
          },
        ],
      },
    });

    const detector = new GiftDetector();
    const gifts = await detector.detectNewGifts(42, context);

    expect(gifts).toHaveLength(1);
    expect(gifts[0].fromUserId).toBe(123);
    expect(gifts[0].fromUsername).toBe("buyer");
    // receivedAt must be in milliseconds, not raw seconds
    expect(gifts[0].receivedAt).toBe(dateSeconds * 1000);
  });

  it("returns only previously unseen gifts on subsequent polls", async () => {
    mockExecutor.mockResolvedValue({
      success: true,
      data: {
        gifts: [{ msgId: "1", slug: "g", title: "g", fromId: "123", date: 1 }],
      },
    });

    const detector = new GiftDetector();
    expect(await detector.detectNewGifts(42, context)).toHaveLength(1);
    expect(await detector.detectNewGifts(42, context)).toHaveLength(0);
  });
});
