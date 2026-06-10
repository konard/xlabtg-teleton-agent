import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("telegram", () => {
  class GetStarGifts {
    constructor(args: unknown) {
      Object.assign(this, args);
    }
  }
  class GetSavedStarGifts {
    constructor(args: unknown) {
      Object.assign(this, args);
    }
  }
  class InputPeerSelf {}
  return {
    Api: {
      payments: { GetStarGifts, GetSavedStarGifts },
      InputPeerSelf,
    },
  };
});

import { Api } from "telegram";
import { telegramGetMyGiftsExecutor } from "../get-my-gifts.js";
import type { ToolContext } from "../../../types.js";

describe("telegram_get_my_gifts compactGift sender", () => {
  it("exposes fromId, fromUsername and a normalized sender", async () => {
    const savedGift = {
      date: 1_700_000_000,
      msgId: 55,
      savedId: { toString: () => "999" },
      fromId: { userId: 123n },
      gift: {
        className: "StarGift",
        id: { toString: () => "5" },
        stars: { toString: () => "100" },
      },
    };

    const invoke = vi.fn(async (req: unknown) => {
      if (req instanceof Api.payments.GetStarGifts) {
        return { gifts: [], hash: 1 };
      }
      return {
        gifts: [savedGift],
        count: 1,
        users: [{ id: 123n, username: "buyer" }],
      };
    });

    const gramJsClient = {
      invoke,
      getEntity: vi.fn(async () => ({})),
    };

    const context = {
      bridge: { getClient: () => ({ getClient: () => gramJsClient }) },
      senderId: 1,
    } as unknown as ToolContext;

    const result = await telegramGetMyGiftsExecutor({ userId: "777" }, context);

    expect(result.success).toBe(true);
    const gifts = (result.data as { gifts: Record<string, unknown>[] }).gifts;
    expect(gifts).toHaveLength(1);
    expect(gifts[0].fromId).toBe("123");
    expect(gifts[0].fromUsername).toBe("buyer");
    expect(gifts[0].sender).toEqual({ id: "123", username: "buyer" });
  });
});
