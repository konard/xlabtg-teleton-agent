import { describe, expect, it } from "vitest";
import {
  buildMtprotoProxyClientOptions,
  getMtprotoProxySecretValidationError,
} from "../mtproto-proxy.js";

describe("MTProto proxy client options", () => {
  it("uses the GramJS MTProxy path for a 16-byte hex secret", () => {
    const options = buildMtprotoProxyClientOptions({
      server: "proxy.example.com",
      port: 443,
      secret: "a".repeat(32),
    });

    expect(options.proxy).toEqual({
      ip: "proxy.example.com",
      port: 443,
      secret: "a".repeat(32),
      MTProxy: true,
    });
    expect(options.connection).toBeUndefined();
  });

  it("uses randomized intermediate transport for a 17-byte prefixed secret", () => {
    const options = buildMtprotoProxyClientOptions({
      server: "proxy.example.com",
      port: 443,
      secret: `dd${"b".repeat(32)}`,
    });

    expect(options.proxy).toMatchObject({
      ip: "proxy.example.com",
      port: 443,
      secret: "b".repeat(32),
      mtprotoTransport: "randomized-intermediate",
    });
    expect("MTProxy" in options.proxy).toBe(false);
    expect(options.connection).toBeTypeOf("function");
  });

  it("rejects TLS-emulation secrets with a clear validation error", () => {
    const secret = `ee${"c".repeat(32)}6578616d706c652e636f6d`;

    expect(getMtprotoProxySecretValidationError(secret)).toContain("TLS-emulation");
    expect(() =>
      buildMtprotoProxyClientOptions({
        server: "proxy.example.com",
        port: 443,
        secret,
      })
    ).toThrow("TLS-emulation");
  });

  it("rejects malformed secret lengths", () => {
    expect(getMtprotoProxySecretValidationError("aabbcc")).toContain("16 bytes");
  });
});
