import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (before imports) ───────────────────────────────────────────────

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
  }

  const Api = {
    auth: {
      SendCode: class {
        constructor(public args: unknown) {}
      },
      SignIn: class {
        constructor(public args: unknown) {}
      },
      ResendCode: class {
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
      Authorization: class Authorization {
        user: unknown;
        constructor(args: { user: unknown }) {
          this.user = args.user;
        }
      },
    },
    CodeSettings: class {
      constructor(_args?: unknown) {}
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
    account: {
      GetPassword: class {
        constructor() {}
      },
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
  readFileSync: vi.fn(() => "telegram:\n  api_id: 0\n  api_hash: ''\n  phone: ''\n"),
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

// ── Imports (after mocks) ────────────────────────────────────────────────

import { TelegramAuthManager } from "../setup-auth.js";
import { Api } from "telegram";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeSentCode(type: unknown, phoneCodeHash = "hash-abc") {
  return new Api.auth.SentCode({ phoneCodeHash, type });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("TelegramAuthManager — TTL / session expiry", () => {
  let manager: TelegramAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new TelegramAuthManager();
  });

  afterEach(async () => {
    await manager.cleanup();
    vi.useRealTimers();
  });

  describe("getSession TTL enforcement", () => {
    it("returns the session when it is within TTL", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));

      const { authSessionId } = await manager.sendCode(12345, "abcdef", "+1234567890");

      // Still within 5 minute TTL — verifyCode should recognise session
      mockInvoke.mockResolvedValueOnce(
        new Api.auth.Authorization({
          user: new Api.User({ id: BigInt(1), firstName: "Alice" }),
        })
      );
      const result = await manager.verifyCode(authSessionId, "12345");
      expect(result.status).toBe("authenticated");
    });

    it("returns expired when session TTL has elapsed", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));

      const { authSessionId } = await manager.sendCode(12345, "abcdef", "+1234567890");

      // Advance time past SESSION_TTL_MS (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = await manager.verifyCode(authSessionId, "12345");
      expect(result.status).toBe("expired");
    });

    it("returns expired for verifyPassword when session TTL has elapsed", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));

      const { authSessionId } = await manager.sendCode(12345, "abcdef", "+1234567890");

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = await manager.verifyPassword(authSessionId, "mypassword");
      expect(result.status).toBe("expired");
    });

    it("returns null for resendCode when session TTL has elapsed", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));

      const { authSessionId } = await manager.sendCode(12345, "abcdef", "+1234567890");

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = await manager.resendCode(authSessionId);
      expect(result).toBeNull();
    });

    it("cancelSession does not act on expired session (session already cleaned up by timer)", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));

      const { authSessionId } = await manager.sendCode(12345, "abcdef", "+1234567890");

      // Advance time so TTL expires — this also fires the setTimeout cleanup
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      // cancelSession must not throw and should be a no-op on an already-expired session
      await expect(manager.cancelSession(authSessionId)).resolves.toBeUndefined();
    });

    it("rejects expired session id that does not match current session", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));
      await manager.sendCode(12345, "abcdef", "+1234567890");

      // Use a different (unknown) session id
      const result = await manager.verifyCode("unknown-session-id", "12345");
      expect(result.status).toBe("expired");
    });
  });
});
