import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructedOptions: Array<Record<string, unknown>> = [];
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockInvoke = vi.fn();
const mockSessionSave = vi.fn(() => "session-string");

vi.mock("telegram", () => {
  class TelegramClient {
    session = { save: mockSessionSave };
    connected = true;
    connect = mockConnect;
    disconnect = mockDisconnect;
    invoke = mockInvoke;

    constructor(
      _session: unknown,
      _apiId: number,
      _apiHash: string,
      options: Record<string, unknown>
    ) {
      constructedOptions.push(options);
    }
  }

  const Api = {
    auth: {
      SendCode: class {
        constructor(public args: unknown) {}
      },
      SentCode: class SentCode {
        phoneCodeHash: string;
        type: unknown;
        constructor(args: { phoneCodeHash: string; type: unknown }) {
          this.phoneCodeHash = args.phoneCodeHash;
          this.type = args.type;
        }
      },
      SentCodeSuccess: class SentCodeSuccess {},
      SentCodeTypeApp: class SentCodeTypeApp {
        length: number;
        constructor(args: { length: number }) {
          this.length = args.length;
        }
      },
      SentCodeTypeFragmentSms: class SentCodeTypeFragmentSms {
        url: string;
        length: number;
        constructor(args: { url: string; length: number }) {
          this.url = args.url;
          this.length = args.length;
        }
      },
      SentCodeTypeSms: class SentCodeTypeSms {
        length: number;
        constructor(args: { length: number }) {
          this.length = args.length;
        }
      },
      ExportLoginToken: class {
        constructor(public args: unknown) {}
      },
      LoginToken: class LoginToken {
        token: Buffer;
        expires: number;
        constructor(args: { token: Buffer; expires: number }) {
          this.token = args.token;
          this.expires = args.expires;
        }
      },
      LoginTokenSuccess: class LoginTokenSuccess {
        authorization: unknown;
        constructor(args: { authorization: unknown }) {
          this.authorization = args.authorization;
        }
      },
      Authorization: class Authorization {
        user: unknown;
        constructor(args: { user: unknown }) {
          this.user = args.user;
        }
      },
    },
    User: class User {
      id: bigint;
      firstName: string;
      username?: string;
      constructor(args: { id: bigint; firstName: string; username?: string }) {
        this.id = args.id;
        this.firstName = args.firstName;
        this.username = args.username;
      }
    },
    CodeSettings: class {
      constructor(_args?: unknown) {}
    },
  };

  return { TelegramClient, Api };
});

vi.mock("telegram/sessions/index.js", () => ({
  StringSession: class {
    constructor(_s?: string) {}
  },
}));

vi.mock("telegram/Password.js", () => ({
  computeCheck: vi.fn(),
}));

vi.mock("telegram/extensions/Logger.js", () => ({
  Logger: class {
    constructor(_level: unknown) {}
  },
  LogLevel: { NONE: 0 },
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock("../../config/configurable-keys.js", () => ({
  readRawConfig: vi.fn(() => ({ telegram: {} })),
  writeRawConfig: vi.fn(),
}));

vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-test",
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { Api } from "telegram";
import { TelegramAuthManager } from "../setup-auth.js";
import type { MtprotoProxyEntry } from "../../config/schema.js";
import { readRawConfig, writeRawConfig } from "../../config/configurable-keys.js";
import { writeFileSync } from "fs";

function makeSentCode() {
  return new Api.auth.SentCode({
    phoneCodeHash: "phone-code-hash",
    type: new Api.auth.SentCodeTypeSms({ length: 5 }),
  });
}

const proxies: MtprotoProxyEntry[] = [
  { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
  { server: "proxy2.example.com", port: 8443, secret: "b".repeat(32) },
];

describe("TelegramAuthManager — MTProto proxy support", () => {
  let manager: TelegramAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    constructedOptions.length = 0;
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue(makeSentCode());
    manager = new TelegramAuthManager();
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  it("connects phone-code auth through the first configured MTProto proxy", async () => {
    await manager.sendCode(12345, "abcdef", "+15551234567", undefined, proxies);

    expect(constructedOptions[0]).toMatchObject({
      proxy: {
        ip: "proxy1.example.com",
        port: 443,
        secret: "a".repeat(32),
        MTProxy: true,
      },
    });
  });

  it("fails over to the next MTProto proxy during phone-code auth", async () => {
    mockConnect.mockReset();
    mockConnect.mockRejectedValueOnce(new Error("proxy down")).mockResolvedValueOnce(undefined);

    await manager.sendCode(12345, "abcdef", "+15551234567", undefined, proxies);

    expect(constructedOptions[0]).toMatchObject({
      proxy: {
        ip: "proxy1.example.com",
        port: 443,
        secret: "a".repeat(32),
        MTProxy: true,
      },
    });
    expect(constructedOptions[1]).toMatchObject({
      proxy: {
        ip: "proxy2.example.com",
        port: 8443,
        secret: "b".repeat(32),
        MTProxy: true,
      },
    });
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("connects QR auth through the first configured MTProto proxy", async () => {
    mockInvoke.mockResolvedValueOnce(
      new Api.auth.LoginToken({
        token: Buffer.from("qr-token"),
        expires: 1_800_000_000,
      })
    );

    await manager.startQrSession(12345, "abcdef", undefined, proxies);

    expect(constructedOptions[0]).toMatchObject({
      proxy: {
        ip: "proxy1.example.com",
        port: 443,
        secret: "a".repeat(32),
        MTProxy: true,
      },
    });
  });

  it("returns authenticated from QR refresh when setup config has not been saved yet", async () => {
    mockInvoke.mockResolvedValueOnce(
      new Api.auth.LoginToken({
        token: Buffer.from("qr-token"),
        expires: 1_800_000_000,
      })
    );
    const start = await manager.startQrSession(12345, "abcdef");
    vi.mocked(readRawConfig).mockImplementationOnce(() => {
      throw new Error(
        "Config file not found: /tmp/teleton-test/config.yaml\nRun 'teleton setup' to create one."
      );
    });
    mockInvoke.mockResolvedValueOnce(
      new Api.auth.LoginTokenSuccess({
        authorization: new Api.auth.Authorization({
          user: new Api.User({ id: BigInt(123), firstName: "Setup", username: "setupuser" }),
        }),
      })
    );

    const result = await manager.refreshQrToken(start.authSessionId);

    expect(result.status).toBe("authenticated");
    expect(result.user).toEqual({ id: 123, firstName: "Setup", username: "setupuser" });
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/teleton-test/telegram_session.txt",
      "session-string",
      { mode: 0o600 }
    );
    expect(writeRawConfig).not.toHaveBeenCalled();
  });
});
