import { describe, it, expect } from "vitest";
import { TelegramError, wrapTelegramError } from "../errors.js";

describe("TelegramError", () => {
  it("captures message, code, and context", () => {
    const err = new TelegramError("boom", "AUTH_FAILED", { attempt: 2 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TelegramError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.context).toEqual({ attempt: 2 });
  });

  it("context is optional", () => {
    const err = new TelegramError("boom", "AUTH_FAILED");
    expect(err.context).toBeUndefined();
  });
});

describe("wrapTelegramError", () => {
  it("prefixes the operation and preserves the original error", () => {
    const original = new Error("network down");
    const wrapped = wrapTelegramError("connect", original, "PROXY_TIMEOUT", { proxy: 1 });

    expect(wrapped).toBeInstanceOf(TelegramError);
    expect(wrapped.message).toBe("connect failed: network down");
    expect(wrapped.code).toBe("PROXY_TIMEOUT");
    expect(wrapped.context).toEqual({ proxy: 1, originalError: original });
  });

  it("stringifies non-Error values", () => {
    const wrapped = wrapTelegramError("sendMessage", "oops", "AUTH_FAILED");
    expect(wrapped.message).toBe("sendMessage failed: oops");
    expect(wrapped.context).toEqual({ originalError: "oops" });
  });
});
