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

  it.each([
    {
      name: "randomized intermediate",
      secret: `dd${"b".repeat(32)}`,
      expectedProxy: {
        mtprotoTransport: "randomized-intermediate",
        secret: "b".repeat(32),
      },
    },
    {
      name: "fake TLS",
      secret: `ee${"c".repeat(32)}${Buffer.from("example.com", "utf-8").toString("hex")}`,
      expectedProxy: {
        mtprotoTransport: "tls-emulation",
        secret: "c".repeat(32),
        tlsDomainHex: Buffer.from("example.com", "utf-8").toString("hex"),
      },
    },
  ])("preserves $name proxy metadata for GramJS reconnects", ({ secret, expectedProxy }) => {
    const options = buildMtprotoProxyClientOptions({
      server: "proxy.example.com",
      port: 443,
      secret,
    });

    class MockSocket {
      constructor(_proxy?: unknown) {}
    }

    type ConnectionParams = {
      ip: string;
      port: number;
      dcId: number;
      loggers: unknown;
      proxy: unknown;
      socket: new (proxy?: unknown) => unknown;
      testServers: boolean;
    };
    type ReconnectableConnection = {
      _ip: string;
      _port: number;
      _dcId: number;
      _log: unknown;
      _proxy: unknown;
      _testServers: boolean;
      constructor: new (params: ConnectionParams) => ReconnectableConnection;
    };

    const ConnectionClass = options.connection as unknown as new (
      params: ConnectionParams
    ) => ReconnectableConnection;
    const connection = new ConnectionClass({
      ip: "149.154.167.50",
      port: 80,
      dcId: 2,
      loggers: {},
      proxy: options.proxy,
      socket: MockSocket,
      testServers: false,
    });

    expect(connection._proxy).toMatchObject(expectedProxy);
    expect(() => {
      new connection.constructor({
        ip: connection._ip,
        port: connection._port,
        dcId: connection._dcId,
        loggers: connection._log,
        proxy: connection._proxy,
        socket: MockSocket,
        testServers: connection._testServers,
      });
    }).not.toThrow();
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
