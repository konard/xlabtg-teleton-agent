import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

const {
  mockBotStart,
  mockBotStop,
  mockBotOn,
  mockBotUse,
  mockBotCatch,
  mockGramjsConnect,
  mockGramjsDisconnect,
  mockGramjsIsConnected,
  mockLogError,
  mockLogInfo,
  mockLogWarn,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockBotStart: vi.fn(),
  mockBotStop: vi.fn(),
  mockBotOn: vi.fn(),
  mockBotUse: vi.fn(),
  mockBotCatch: vi.fn(),
  mockGramjsConnect: vi.fn(),
  mockGramjsDisconnect: vi.fn(),
  mockGramjsIsConnected: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
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

describe("DealBot shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBotStop.mockResolvedValue(undefined);
    mockGramjsConnect.mockResolvedValue(undefined);
    mockGramjsDisconnect.mockResolvedValue(undefined);
    mockGramjsIsConnected.mockReturnValue(false);
  });

  function makeBot(): DealBot {
    return new DealBot(
      {
        token: "123456:ABC-DEF",
        username: "tony_idbot",
        apiId: 12345,
        apiHash: "hash",
        gramjsSessionPath: "/tmp/gramjs-bot-session",
      },
      {} as Database.Database
    );
  }

  it("does not log a Polling error when bot.start() rejects after stop() is called", async () => {
    // Simulate Grammy's behavior: bot.start() rejects with "Aborted delay" once bot.stop() runs.
    let rejectStart: ((err: Error) => void) | undefined;
    mockBotStart.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    mockBotStop.mockImplementationOnce(async () => {
      // Grammy aborts the polling loop's pending delay
      rejectStart?.(new Error("Aborted delay"));
    });

    const bot = makeBot();
    await bot.start();
    await bot.stop();
    // Allow the bot.start() rejection to propagate to its .catch handler.
    await new Promise((r) => setTimeout(r, 0));

    const polling = mockLogError.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("Polling error"))
    );
    expect(polling).toBeUndefined();
  });

  it("still logs Polling error when bot.start() rejects without an explicit stop()", async () => {
    let rejectStart: ((err: Error) => void) | undefined;
    mockBotStart.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );

    const bot = makeBot();
    await bot.start();
    rejectStart?.(new Error("Connection refused"));
    await new Promise((r) => setTimeout(r, 0));

    const polling = mockLogError.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("Polling error"))
    );
    expect(polling).toBeDefined();
  });
});
