import { createRequire } from "module";
import type { ProxyInterface } from "telegram/network/connection/TCPMTProxy.js";
import type * as GramjsConnectionModule from "telegram/network/connection/Connection.js";
import type { Connection } from "telegram/network/connection/Connection.js";
import type { AbridgedPacketCodec as GramjsAbridgedPacketCodec } from "telegram/network/connection/TCPAbridged.js";
import type { Logger, PromisedNetSockets, PromisedWebSockets } from "telegram/extensions/index.js";
import { generateRandomBytes, sha256 } from "telegram/Helpers.js";
import { CTR } from "telegram/crypto/CTR.js";
import type { MtprotoProxyEntry } from "../config/schema.js";

const require = createRequire(import.meta.url);
const HEX_SECRET_RE = /^[0-9a-f]+$/i;
const MT_PROXY_INIT_FORBIDDEN_PREFIXES = [
  Buffer.from("50567247", "hex"), // PVrG
  Buffer.from("47455420", "hex"), // GET
  Buffer.from("504f5354", "hex"), // POST
  Buffer.from("48454144", "hex"), // HEAD
  Buffer.from("16030102", "hex"), // TLS ClientHello
  Buffer.from("dddddddd", "hex"),
  Buffer.from("eeeeeeee", "hex"),
];

type MtprotoSecretTransport = "abridged" | "randomized-intermediate";

interface NormalizedMtprotoSecret {
  secretHex: string;
  transport: MtprotoSecretTransport;
}

interface CustomMtprotoProxy {
  ip: string;
  port: number;
  secret: string;
  mtprotoTransport: "randomized-intermediate";
}

interface GramjsConnectionParams {
  ip: string;
  port: number;
  dcId: number;
  loggers: Logger;
  proxy?: ProxyInterface | CustomMtprotoProxy;
  socket: typeof PromisedNetSockets | typeof PromisedWebSockets;
  testServers: boolean;
}

export interface MtprotoProxyClientOptions {
  proxy: ProxyInterface;
  connection?: typeof Connection;
}

let randomizedIntermediateConnection: typeof Connection | undefined;

function normalizeHexSecret(secret: string): string {
  return secret.trim().replace(/^0x/i, "");
}

export function getMtprotoProxySecretValidationError(secret: string): string | null {
  const normalized = normalizeHexSecret(secret);
  if (!normalized) {
    return "secret is required";
  }
  if (!HEX_SECRET_RE.test(normalized) || normalized.length % 2 !== 0) {
    return "secret must be a hex string";
  }

  const byteLength = normalized.length / 2;
  if (byteLength === 16 || byteLength === 17) {
    return null;
  }

  if (normalized.toLowerCase().startsWith("ee") && byteLength > 17) {
    return (
      "TLS-emulation MTProto secrets (ee-prefixed secrets with a domain) are not supported; " +
      "use a 32-character hex secret or a 34-character transport-prefixed secret"
    );
  }

  return "secret must be 16 bytes (32 hex characters) or 17 bytes (34 hex characters) with a transport prefix";
}

function normalizeMtprotoSecret(secret: string): NormalizedMtprotoSecret {
  const normalized = normalizeHexSecret(secret);
  const validationError = getMtprotoProxySecretValidationError(normalized);
  if (validationError) {
    throw new Error(`Invalid MTProto proxy secret: ${validationError}`);
  }

  if (normalized.length === 34) {
    return {
      secretHex: normalized.slice(2),
      transport: "randomized-intermediate",
    };
  }

  return {
    secretHex: normalized,
    transport: "abridged",
  };
}

export function buildMtprotoProxyClientOptions(
  entry: MtprotoProxyEntry
): MtprotoProxyClientOptions {
  const normalized = normalizeMtprotoSecret(entry.secret);

  if (normalized.transport === "randomized-intermediate") {
    return {
      proxy: {
        ip: entry.server,
        port: entry.port,
        secret: normalized.secretHex,
        mtprotoTransport: "randomized-intermediate",
      } as unknown as ProxyInterface,
      connection: getConnectionTCPMTProxyRandomizedIntermediate(),
    };
  }

  return {
    proxy: {
      ip: entry.server,
      port: entry.port,
      secret: normalized.secretHex,
      MTProxy: true,
    } as ProxyInterface,
  };
}

function getConnectionTCPMTProxyRandomizedIntermediate(): typeof Connection {
  if (randomizedIntermediateConnection) {
    return randomizedIntermediateConnection;
  }

  // GramJS connection submodules have CJS initialization ordering assumptions.
  // Loading the package root first avoids a circular export failure.
  require("telegram");
  const connectionModule =
    require("telegram/network/connection/Connection.js") as typeof GramjsConnectionModule;

  class RandomizedIntermediatePacketCodec extends connectionModule.PacketCodec {
    static tag = Buffer.from("dddddddd", "hex");
    static obfuscateTag = Buffer.from("dddddddd", "hex");
    tag = RandomizedIntermediatePacketCodec.tag;
    obfuscateTag = RandomizedIntermediatePacketCodec.obfuscateTag;

    encodePacket(data: Buffer): Buffer {
      const paddingLength = Math.floor(Math.random() * 4);
      const padding = paddingLength > 0 ? generateRandomBytes(paddingLength) : Buffer.alloc(0);
      const packet = Buffer.concat([data, padding]);
      const length = Buffer.alloc(4);
      length.writeInt32LE(packet.length, 0);
      return Buffer.concat([length, packet]);
    }

    async readPacket(reader: { read: (n: number) => Promise<Buffer> }): Promise<Buffer> {
      const length = (await reader.read(4)).readInt32LE(0);
      const packet = await reader.read(length);
      const paddingLength = packet.length % 4;
      return paddingLength > 0 ? packet.slice(0, -paddingLength) : packet;
    }
  }
  const gramjsPacketCodecClass =
    RandomizedIntermediatePacketCodec as unknown as typeof GramjsAbridgedPacketCodec;

  class MtprotoProxyObfuscatedIO {
    header?: Buffer;
    private readonly connection: {
      readExactly: (n: number) => Promise<Buffer>;
      write: (data: Buffer) => void;
    };
    private readonly packetClass: typeof RandomizedIntermediatePacketCodec;
    private readonly secret: Buffer;
    private readonly dcId: number;
    private encryptor?: CTR;
    private decryptor?: CTR;

    constructor(connection: ConnectionTCPMTProxyRandomizedIntermediate) {
      this.connection = connection.socket;
      this.packetClass = RandomizedIntermediatePacketCodec;
      this.secret = connection.secret;
      this.dcId = connection._dcId;
    }

    async initHeader(): Promise<void> {
      let random: Buffer;
      do {
        random = generateRandomBytes(64);
      } while (!isValidMtproxyInitPayload(random));

      const randomReversed = Buffer.from(random.slice(8, 56)).reverse();
      const encryptKey = await sha256(Buffer.concat([random.slice(8, 40), this.secret]));
      const encryptIv = random.slice(40, 56);
      const decryptKey = await sha256(Buffer.concat([randomReversed.slice(0, 32), this.secret]));
      const decryptIv = randomReversed.slice(32, 48);

      this.encryptor = new CTR(encryptKey, encryptIv);
      this.decryptor = new CTR(decryptKey, decryptIv);

      this.packetClass.obfuscateTag.copy(random, 56);
      random.writeInt16LE(this.dcId, 60);

      const encryptedRandom = this.encryptor.encrypt(random);
      encryptedRandom.copy(random, 56, 56, 64);
      this.header = random;
    }

    async read(n: number): Promise<Buffer> {
      if (!this.decryptor) {
        throw new Error("MTProxy decryptor is not initialized");
      }
      return this.decryptor.encrypt(await this.connection.readExactly(n));
    }

    write(data: Buffer): void {
      if (!this.encryptor) {
        throw new Error("MTProxy encryptor is not initialized");
      }
      this.connection.write(this.encryptor.encrypt(data));
    }
  }

  class ConnectionTCPMTProxyRandomizedIntermediate extends connectionModule.ObfuscatedConnection {
    ObfuscatedIO = MtprotoProxyObfuscatedIO;
    PacketCodecClass = gramjsPacketCodecClass;
    secret: Buffer;

    constructor({ dcId, loggers, proxy, socket, testServers }: GramjsConnectionParams) {
      const mtprotoProxy = requireCustomMtprotoProxy(proxy);
      super({
        ip: mtprotoProxy.ip,
        port: mtprotoProxy.port,
        dcId,
        loggers,
        proxy: {
          ip: mtprotoProxy.ip,
          port: mtprotoProxy.port,
          secret: mtprotoProxy.secret,
          MTProxy: true,
        } as ProxyInterface,
        socket,
        testServers,
      });
      this.secret = Buffer.from(mtprotoProxy.secret, "hex");
    }
  }

  const connectionClass =
    ConnectionTCPMTProxyRandomizedIntermediate as unknown as typeof Connection;
  randomizedIntermediateConnection = connectionClass;
  return connectionClass;
}

function isValidMtproxyInitPayload(random: Buffer): boolean {
  if (random[0] === 0xef) {
    return false;
  }
  if (random.slice(4, 8).equals(Buffer.alloc(4))) {
    return false;
  }
  return !MT_PROXY_INIT_FORBIDDEN_PREFIXES.some((prefix) => random.slice(0, 4).equals(prefix));
}

function requireCustomMtprotoProxy(
  proxy: ProxyInterface | CustomMtprotoProxy | undefined
): CustomMtprotoProxy {
  if (!proxy || !("mtprotoTransport" in proxy)) {
    throw new Error("No MTProto proxy info specified for prefixed-secret transport");
  }
  return proxy;
}
