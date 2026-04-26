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

  it("uses fake TLS transport for an ee-prefixed TLS-emulation hex secret", () => {
    const tlsDomainHex = Buffer.from("example.com", "utf-8").toString("hex");
    const secret = `ee${"c".repeat(32)}${tlsDomainHex}`;

    expect(getMtprotoProxySecretValidationError(secret)).toBeNull();
    const options = buildMtprotoProxyClientOptions({
      server: "proxy.example.com",
      port: 443,
      secret,
    });

    expect(options.proxy).toMatchObject({
      ip: "proxy.example.com",
      port: 443,
      secret: "c".repeat(32),
      mtprotoTransport: "tls-emulation",
      tlsDomainHex,
    });
    expect("MTProxy" in options.proxy).toBe(false);
    expect(options.connection).toBeTypeOf("function");
  });

  it("accepts Telegram base64url encoded fake TLS secrets", () => {
    const rawSecret = Buffer.concat([
      Buffer.from([0xee]),
      Buffer.from("d".repeat(32), "hex"),
      Buffer.from("example.com", "utf-8"),
    ]).toString("base64url");

    expect(getMtprotoProxySecretValidationError(rawSecret)).toBeNull();
    const options = buildMtprotoProxyClientOptions({
      server: "proxy.example.com",
      port: 443,
      secret: rawSecret,
    });

    expect(options.proxy).toMatchObject({
      secret: "d".repeat(32),
      mtprotoTransport: "tls-emulation",
      tlsDomainHex: Buffer.from("example.com", "utf-8").toString("hex"),
    });
  });

  it("rejects malformed secret lengths", () => {
    expect(getMtprotoProxySecretValidationError("aabbcc")).toContain("16 bytes");
  });
});
