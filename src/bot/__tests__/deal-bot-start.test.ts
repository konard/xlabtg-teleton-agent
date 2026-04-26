import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

const {
  mockBotInit,
  mockBotStart,
  mockBotStop,
  mockBotOn,
  mockBotUse,
  mockBotCatch,
  mockGramjsConnect,
  mockGramjsDisconnect,
  mockGramjsIsConnected,
} = vi.hoisted(() => ({
  mockBotInit: vi.fn(),
  mockBotStart: vi.fn(),
  mockBotStop: vi.fn(),
  mockBotOn: vi.fn(),
  mockBotUse: vi.fn(),
  mockBotCatch: vi.fn(),
  mockGramjsConnect: vi.fn(),
  mockGramjsDisconnect: vi.fn(),
  mockGramjsIsConnected: vi.fn(),
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
    api = {
      editMessageTextInline: vi.fn(),
    };
    botInfo = { id: 123456, username: "tony_idbot", first_name: "Tony" };
    on = mockBotOn;
    use = mockBotUse;
    catch = mockBotCatch;
    init = mockBotInit;
    start = mockBotStart;
    stop = mockBotStop;
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
    connect = mockGramjsConnect;
    disconnect = mockGramjsDisconnect;
    isConnected = mockGramjsIsConnected;
    answerInlineQuery = vi.fn();
    editInlineMessageByStringId = vi.fn();
  },
}));

import { DealBot } from "../index.js";

function nextMacrotask(): Promise<"blocked"> {
  return new Promise((resolve) => setTimeout(() => resolve("blocked"), 0));
}

describe("DealBot startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBotInit.mockResolvedValue(undefined);
    mockBotStart.mockResolvedValue(undefined);
    mockBotStop.mockResolvedValue(undefined);
    mockGramjsConnect.mockResolvedValue(undefined);
    mockGramjsDisconnect.mockResolvedValue(undefined);
    mockGramjsIsConnected.mockReturnValue(false);
  });

  it("does not block Bot API startup while the optional GramJS MTProto bot connection hangs", async () => {
    mockGramjsConnect.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Simulate a proxy path that never finishes connecting.
        })
    );

    const bot = new DealBot(
      {
        token: "123456:ABC-DEF",
        username: "tony_idbot",
        apiId: 12345,
        apiHash: "hash",
        gramjsSessionPath: "/tmp/gramjs-bot-session",
        mtprotoProxies: [{ server: "proxy.example.com", port: 443, secret: "a".repeat(32) }],
      },
      {} as Database.Database
    );

    const result = await Promise.race([
      bot.start().then(() => "resolved" as const),
      nextMacrotask(),
    ]);

    expect(result).toBe("resolved");
    expect(mockGramjsConnect).toHaveBeenCalledWith("123456:ABC-DEF");
    expect(mockBotInit).toHaveBeenCalledTimes(1);
    expect(mockBotStart).toHaveBeenCalledTimes(1);
  });
});
