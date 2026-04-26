/**
 * Tests for the Bot API proxy wiring on DealBot.
 *
 * Verifies that:
 * - When botApiProxyUrl is provided, Grammy's Bot is constructed with a
 *   `client.baseFetchConfig.agent` so HTTPS calls to api.telegram.org
 *   tunnel through the proxy.
 * - When botApiProxyUrl is omitted, no proxy options are passed.
 * - Invalid proxy URLs are reported and the bot still constructs.
 *
 * MTProxy alone cannot tunnel HTTPS, so this is required for the agent to
 * function in regions where Bot API endpoints are also blocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

const { mockBotConstructor, mockBotOn, mockBotUse, mockBotCatch, mockBotStart, mockBotStop } =
  vi.hoisted(() => ({
    mockBotConstructor: vi.fn(),
    mockBotOn: vi.fn(),
    mockBotUse: vi.fn(),
    mockBotCatch: vi.fn(),
    mockBotStart: vi.fn(),
    mockBotStop: vi.fn(),
  }));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("grammy", () => {
  class Bot {
    api = { editMessageTextInline: vi.fn() };
    botInfo = { id: 123, username: "tony_idbot", first_name: "Tony" };
    on = mockBotOn;
    use = mockBotUse;
    catch = mockBotCatch;
    start = mockBotStart;
    stop = mockBotStop;

    constructor(token: string, opts?: unknown) {
      mockBotConstructor(token, opts);
    }
  }

  class InlineKeyboard {
    row = vi.fn(() => this);
    text = vi.fn(() => this);
    copyText = vi.fn(() => this);
  }

  return { Bot, InlineKeyboard };
});

vi.mock("../gramjs-bot.js", () => ({
  GramJSBotClient: class {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    isConnected = vi.fn().mockReturnValue(false);
    answerInlineQuery = vi.fn();
    editInlineMessageByStringId = vi.fn();
  },
}));

import { DealBot } from "../index.js";

describe("DealBot Bot API proxy wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBotStart.mockResolvedValue(undefined);
    mockBotStop.mockResolvedValue(undefined);
  });

  it("does not pass any client options when botApiProxyUrl is undefined", () => {
    new DealBot(
      {
        token: "123:ABC",
        username: "tony_idbot",
      },
      {} as Database.Database
    );

    expect(mockBotConstructor).toHaveBeenCalledTimes(1);
    const [token, opts] = mockBotConstructor.mock.calls[0];
    expect(token).toBe("123:ABC");
    expect(opts).toEqual({});
  });

  it("passes a node-fetch agent through baseFetchConfig for an HTTP proxy URL", () => {
    new DealBot(
      {
        token: "123:ABC",
        username: "tony_idbot",
        botApiProxyUrl: "http://proxy.example.com:8080",
      },
      {} as Database.Database
    );

    const [, opts] = mockBotConstructor.mock.calls[0] as [string, Record<string, unknown>];
    const client = opts.client as { baseFetchConfig: { agent: unknown } } | undefined;
    expect(client?.baseFetchConfig?.agent).toBeDefined();
    expect(client?.baseFetchConfig?.agent).toMatchObject({ proxy: expect.anything() });
  });

  it("passes a node-fetch agent through baseFetchConfig for a SOCKS5 proxy URL", () => {
    new DealBot(
      {
        token: "123:ABC",
        username: "tony_idbot",
        botApiProxyUrl: "socks5://proxy.example.com:1080",
      },
      {} as Database.Database
    );

    const [, opts] = mockBotConstructor.mock.calls[0] as [string, Record<string, unknown>];
    const client = opts.client as { baseFetchConfig: { agent: unknown } } | undefined;
    expect(client?.baseFetchConfig?.agent).toBeDefined();
  });

  it("ignores an invalid proxy URL and constructs the bot without a proxy", () => {
    new DealBot(
      {
        token: "123:ABC",
        username: "tony_idbot",
        botApiProxyUrl: "not-a-real-url",
      },
      {} as Database.Database
    );

    const [, opts] = mockBotConstructor.mock.calls[0];
    expect(opts).toEqual({});
  });

  it("ignores a proxy URL with an unsupported scheme", () => {
    new DealBot(
      {
        token: "123:ABC",
        username: "tony_idbot",
        botApiProxyUrl: "ftp://proxy.example.com",
      },
      {} as Database.Database
    );

    const [, opts] = mockBotConstructor.mock.calls[0];
    expect(opts).toEqual({});
  });
});
