/**
 * Tests for the interactive authentication flow in TelegramUserClient:
 * SendCode → SignIn → 2FA password path. Verifies that error handling
 * uses TelegramError with stable codes and that SESSION_PASSWORD_NEEDED
 * transparently switches to the 2FA branch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../formatting.js", () => ({
  markdownToTelegramHtml: (s: string) => s,
}));

vi.mock("../flood-retry.js", () => ({
  withFloodRetry: (fn: () => unknown) => fn(),
}));

const { mockConnect, mockDisconnect, mockGetMe, mockInvoke, mockExistsSync, mockPromptInput } =
  vi.hoisted(() => ({
    mockConnect: vi.fn(),
    mockDisconnect: vi.fn().mockResolvedValue(undefined),
    mockGetMe: vi.fn(),
    mockInvoke: vi.fn(),
    mockExistsSync: vi.fn(),
    mockPromptInput: vi.fn(),
  }));

vi.mock("telegram", () => {
  class MockTelegramClient {
    session: { save: () => string };
    constructor(_session: unknown, _apiId: number, _apiHash: string) {
      this.session = { save: () => "" };
    }
    connect = mockConnect;
    disconnect = mockDisconnect;
    getMe = mockGetMe;
    invoke = mockInvoke;
    connected = true;
    addEventHandler = vi.fn();
  }

  class SentCode {
    phoneCodeHash = "hash123";
    type: unknown;
    constructor(type?: unknown) {
      this.type = type;
    }
  }
  class SentCodeSuccess {}
  class SentCodeTypeFragmentSms {
    url?: string;
    constructor(url?: string) {
      this.url = url;
    }
  }
  class SendCode {}
  class SignIn {}
  class CheckPassword {}
  class GetPassword {}
  class CodeSettings {}
  class User {}

  return {
    TelegramClient: MockTelegramClient,
    Api: {
      User,
      auth: { SendCode, SentCode, SentCodeSuccess, SentCodeTypeFragmentSms, SignIn, CheckPassword },
      account: { GetPassword },
      CodeSettings,
      messages: { SetTyping: class {} },
      SendMessageTypingAction: class {},
      contacts: { ResolveUsername: class {} },
    },
  };
});

vi.mock("telegram/extensions/Logger.js", () => ({
  Logger: class {},
  LogLevel: { NONE: 0 },
}));

vi.mock("telegram/sessions/index.js", () => ({
  StringSession: class {
    constructor(public value: string = "") {}
    save() {
      return this.value;
    }
  },
}));

vi.mock("telegram/events/index.js", () => ({
  NewMessage: class {},
}));

vi.mock("telegram/Password.js", () => ({
  computeCheck: vi.fn().mockResolvedValue("srp-result"),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("path", () => ({
  dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
}));

vi.mock("readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (answer: string) => void) => cb(mockPromptInput()),
    close: () => {},
  }),
}));

vi.mock("../../constants/timeouts.js", () => ({
  MTPROTO_PROXY_CONNECT_TIMEOUT_MS: 100,
}));

import { TelegramUserClient } from "../client.js";
import { TelegramError } from "../errors.js";

const BASE_CONFIG = {
  apiId: 12345,
  apiHash: "testhash",
  phone: "+1234567890",
  sessionPath: "/test/session.txt",
};

const MOCK_ME = {
  id: { toString: () => "12345" },
  username: "testuser",
  firstName: "Test",
  lastName: undefined,
  phone: "+1234567890",
  bot: false,
};

describe("TelegramUserClient — auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockGetMe.mockResolvedValue(MOCK_ME);
    mockExistsSync.mockReturnValue(false); // no session → auth flow runs
  });

  it("signs in on first valid code", async () => {
    // First invoke: SendCode → SentCode
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCode();
    });
    // Second invoke: SignIn → success
    mockInvoke.mockResolvedValueOnce(undefined);

    mockPromptInput.mockReturnValue("12345");

    const client = new TelegramUserClient(BASE_CONFIG);
    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("returns early on SentCodeSuccess (session migration)", async () => {
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCodeSuccess();
    });

    mockPromptInput.mockReturnValue("");

    const client = new TelegramUserClient(BASE_CONFIG);
    await client.connect();

    // Only SendCode was called — SignIn was skipped.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);
  });

  it("throws TelegramError AUTH_UNEXPECTED_RESPONSE on unknown auth response", async () => {
    mockInvoke.mockResolvedValueOnce({}); // not SentCode or SentCodeSuccess

    mockPromptInput.mockReturnValue("");

    const client = new TelegramUserClient(BASE_CONFIG);

    try {
      await client.connect();
      expect.fail("expected TelegramError");
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramError);
      expect((err as TelegramError).code).toBe("AUTH_UNEXPECTED_RESPONSE");
    }
  });

  it("throws TelegramError AUTH_INVALID_CODE after too many invalid attempts", async () => {
    // SendCode returns SentCode
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCode();
    });
    // Three SignIn attempts all fail with PHONE_CODE_INVALID
    const phoneCodeInvalid = { errorMessage: "PHONE_CODE_INVALID" };
    mockInvoke
      .mockRejectedValueOnce(phoneCodeInvalid)
      .mockRejectedValueOnce(phoneCodeInvalid)
      .mockRejectedValueOnce(phoneCodeInvalid);

    mockPromptInput.mockReturnValue("00000");

    const client = new TelegramUserClient(BASE_CONFIG);

    try {
      await client.connect();
      expect.fail("expected TelegramError");
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramError);
      expect((err as TelegramError).code).toBe("AUTH_INVALID_CODE");
      expect((err as TelegramError).context).toMatchObject({ maxAttempts: 3 });
    }
    // SendCode + 3 SignIn attempts = 4 invocations
    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });

  it("switches to 2FA password flow on SESSION_PASSWORD_NEEDED", async () => {
    // SendCode → SentCode
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCode();
    });
    // SignIn → SESSION_PASSWORD_NEEDED
    mockInvoke.mockRejectedValueOnce({ errorMessage: "SESSION_PASSWORD_NEEDED" });
    // GetPassword → srp params
    mockInvoke.mockResolvedValueOnce({ currentAlgo: "algo" });
    // CheckPassword → success
    mockInvoke.mockResolvedValueOnce(undefined);

    mockPromptInput.mockReturnValueOnce("12345").mockReturnValueOnce("my-2fa-password");

    const client = new TelegramUserClient(BASE_CONFIG);
    await client.connect();

    // SendCode + SignIn + GetPassword + CheckPassword = 4 invocations
    expect(mockInvoke).toHaveBeenCalledTimes(4);
    expect(client.isConnected()).toBe(true);
  });

  it("re-throws unknown SignIn errors as-is", async () => {
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCode();
    });
    const unknownErr = new Error("boom: something else");
    mockInvoke.mockRejectedValueOnce(unknownErr);

    mockPromptInput.mockReturnValue("12345");

    const client = new TelegramUserClient(BASE_CONFIG);

    await expect(client.connect()).rejects.toBe(unknownErr);
  });

  it("retries with a new code after one PHONE_CODE_INVALID then succeeds", async () => {
    mockInvoke.mockImplementationOnce(async () => {
      const { Api } = await import("telegram");
      return new Api.auth.SentCode();
    });
    mockInvoke.mockRejectedValueOnce({ errorMessage: "PHONE_CODE_INVALID" });
    mockInvoke.mockResolvedValueOnce(undefined); // second SignIn succeeds

    mockPromptInput.mockReturnValueOnce("wrong").mockReturnValueOnce("right");

    const client = new TelegramUserClient(BASE_CONFIG);
    await client.connect();

    // SendCode + 2 SignIn attempts
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(client.isConnected()).toBe(true);
  });
});
