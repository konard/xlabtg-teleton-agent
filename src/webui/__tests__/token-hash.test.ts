import { describe, it, expect } from "vitest";
import { hashToken, verifyToken, isHashedToken } from "../middleware/token-hash.js";

describe("token-hash", () => {
  it("produces a self-describing scrypt$<salt>$<hash> string", () => {
    const hash = hashToken("swordfish");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.split("$")).toHaveLength(3);
  });

  it("uses a fresh salt per call — same input yields different hashes", () => {
    const a = hashToken("swordfish");
    const b = hashToken("swordfish");
    expect(a).not.toBe(b);
    // But both still verify against the original token.
    expect(verifyToken("swordfish", a)).toBe(true);
    expect(verifyToken("swordfish", b)).toBe(true);
  });

  it("verifies only the correct token", () => {
    const hash = hashToken("correct-horse-battery-staple");
    expect(verifyToken("correct-horse-battery-staple", hash)).toBe(true);
    expect(verifyToken("correct-horse-battery-stapl", hash)).toBe(false);
    expect(verifyToken("", hash)).toBe(false);
  });

  it("rejects malformed or non-hash inputs", () => {
    expect(verifyToken("x", "")).toBe(false);
    expect(verifyToken("x", "plain-token")).toBe(false);
    expect(verifyToken("x", "scrypt$zzz")).toBe(false);
    expect(verifyToken("x", "scrypt$not-hex$also-not-hex")).toBe(false);
  });

  it("isHashedToken detects only scrypt$-prefixed strings", () => {
    expect(isHashedToken("scrypt$abc$def")).toBe(true);
    expect(isHashedToken("plain")).toBe(false);
    expect(isHashedToken(undefined)).toBe(false);
    expect(isHashedToken(null)).toBe(false);
  });
});
