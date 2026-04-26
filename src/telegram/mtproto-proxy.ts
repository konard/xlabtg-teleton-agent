import { createHmac, randomBytes, timingSafeEqual } from "crypto";
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
const BASE64_SECRET_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const FAKE_TLS_CLIENT_HELLO_LENGTH = 517;
const FAKE_TLS_MAX_CLIENT_RECORD_PAYLOAD = 2878;
const TLS_CHANGE_CIPHER_SPEC = Buffer.from("140303000101", "hex");
const TLS_HANDSHAKE_PREFIX = Buffer.from("160303", "hex");
const TLS_APPLICATION_DATA_PREFIX = Buffer.from("170303", "hex");
const MT_PROXY_INIT_FORBIDDEN_PREFIXES = [
  Buffer.from("50567247", "hex"), // PVrG
  Buffer.from("47455420", "hex"), // GET
  Buffer.from("504f5354", "hex"), // POST
  Buffer.from("48454144", "hex"), // HEAD
  Buffer.from("16030102", "hex"), // TLS ClientHello
  Buffer.from("dddddddd", "hex"),
  Buffer.from("eeeeeeee", "hex"),
];

type MtprotoSecretTransport = "abridged" | "randomized-intermediate" | "tls-emulation";

interface NormalizedMtprotoSecret {
  secretHex: string;
  transport: MtprotoSecretTransport;
  tlsDomainHex?: string;
}

interface DecodedMtprotoSecret {
  bytes: Buffer;
}

interface CustomMtprotoProxy {
  ip: string;
  port: number;
  secret: string;
  mtprotoTransport: "randomized-intermediate" | "tls-emulation";
  tlsDomainHex?: string;
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

let paddedIntermediateConnection: typeof Connection | undefined;

function normalizeSecretInput(secret: string): string {
  return secret.trim();
}

function decodeBase64Secret(secret: string): Buffer | null {
  if (!BASE64_SECRET_RE.test(secret)) {
    return null;
  }

  const withoutPadding = secret.replace(/=+$/, "");
  if (withoutPadding.length < 22 || withoutPadding.length % 4 === 1) {
    return null;
  }

  const normalized = withoutPadding.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  const recoded = decoded
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const expected = withoutPadding.replace(/\+/g, "-").replace(/\//g, "_");

  return recoded === expected ? decoded : null;
}

function decodeMtprotoSecret(secret: string): DecodedMtprotoSecret {
  const normalized = normalizeSecretInput(secret);
  if (!normalized) {
    throw new Error("secret is required");
  }

  const hexCandidate = normalized.replace(/^0x/i, "");
  const isHex = HEX_SECRET_RE.test(hexCandidate);
  if (isHex && hexCandidate.length % 2 !== 0) {
    throw new Error("secret must contain complete bytes (even number of hex characters)");
  }
  if (isHex && hexCandidate.length >= 32) {
    return { bytes: Buffer.from(hexCandidate, "hex") };
  }

  const base64Decoded = decodeBase64Secret(normalized);
  if (base64Decoded) {
    return { bytes: base64Decoded };
  }

  if (isHex) {
    return { bytes: Buffer.from(hexCandidate, "hex") };
  }

  throw new Error("secret must be a hex or base64url string");
}

function validateFakeTlsDomain(domain: Buffer): string | null {
  if (domain.length === 0) {
    return "TLS-emulation secret must include a domain";
  }
  if (domain.length > 253) {
    return "TLS-emulation domain must be 253 bytes or shorter";
  }
  if (domain.includes(0)) {
    return "TLS-emulation domain must not contain NUL bytes";
  }
  return null;
}

function getDecodedMtprotoSecretValidationError(decoded: DecodedMtprotoSecret): string | null {
  const { bytes } = decoded;
  const byteLength = bytes.length;

  if (byteLength === 16 || byteLength === 17) {
    return null;
  }

  if (bytes[0] === 0xee && byteLength >= 21) {
    return validateFakeTlsDomain(bytes.subarray(17));
  }

  return (
    "secret must be 16 bytes, 17 bytes with a transport prefix, " +
    "or an ee-prefixed TLS-emulation secret with a domain"
  );
}

export function getMtprotoProxySecretValidationError(secret: string): string | null {
  try {
    return getDecodedMtprotoSecretValidationError(decodeMtprotoSecret(secret));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function normalizeMtprotoSecret(secret: string): NormalizedMtprotoSecret {
  const decoded = decodeMtprotoSecret(secret);
  const validationError = getDecodedMtprotoSecretValidationError(decoded);
  if (validationError) {
    throw new Error(`Invalid MTProto proxy secret: ${validationError}`);
  }

  if (decoded.bytes[0] === 0xee && decoded.bytes.length >= 21) {
    return {
      secretHex: decoded.bytes.subarray(1, 17).toString("hex"),
      transport: "tls-emulation",
      tlsDomainHex: decoded.bytes.subarray(17).toString("hex"),
    };
  }

  if (decoded.bytes.length === 17) {
    return {
      secretHex: decoded.bytes.subarray(1).toString("hex"),
      transport: "randomized-intermediate",
    };
  }

  return {
    secretHex: decoded.bytes.toString("hex"),
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
      connection: getConnectionTCPMTProxyPaddedIntermediate(),
    };
  }

  if (normalized.transport === "tls-emulation") {
    return {
      proxy: {
        ip: entry.server,
        port: entry.port,
        secret: normalized.secretHex,
        mtprotoTransport: "tls-emulation",
        tlsDomainHex: normalized.tlsDomainHex,
      } as unknown as ProxyInterface,
      connection: getConnectionTCPMTProxyPaddedIntermediate(),
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

interface FakeTlsClientHello {
  data: Buffer;
  digest: Buffer;
}

interface MtprotoSocketLike {
  readExactly: (n: number) => Promise<Buffer>;
  write: (data: Buffer) => void;
}

function uint16BE(value: number): Buffer {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(value, 0);
  return result;
}

function addGrease(parts: Buffer[], greases: Buffer, index: number): void {
  parts.push(Buffer.from([greases[index], greases[index]]));
}

function createGreases(): Buffer {
  const greases = randomBytes(7);
  for (let i = 0; i < greases.length; i++) {
    greases[i] = (greases[i] & 0xf0) + 0x0a;
  }
  for (let i = 1; i < greases.length; i += 2) {
    if (greases[i] === greases[i - 1]) {
      greases[i] ^= 0x10;
    }
  }
  return greases;
}

function timestampedHmacDigest(key: Buffer, data: Buffer): Buffer {
  const digest = createHmac("sha256", key).update(data).digest();
  const timestamp = Buffer.alloc(4);
  timestamp.writeInt32LE(Math.floor(Date.now() / 1000), 0);
  for (let i = 0; i < timestamp.length; i++) {
    digest[28 + i] ^= timestamp[i];
  }
  return digest;
}

function createFakeTlsClientHello(domain: Buffer, key: Buffer): FakeTlsClientHello {
  const greases = createGreases();
  const domainLength = domain.length;
  const parts: Buffer[] = [
    Buffer.from("1603010200010001fc0303", "hex"),
    Buffer.alloc(32),
    Buffer.from("20", "hex"),
    randomBytes(32),
    Buffer.from("0022", "hex"),
  ];

  addGrease(parts, greases, 0);
  parts.push(
    Buffer.from("130113021303c02bc02fc02cc030cca9cca8c013c014009c009d002f0035000a01000191", "hex")
  );
  addGrease(parts, greases, 2);
  parts.push(Buffer.from("00000000", "hex"), uint16BE(domainLength + 5));
  parts.push(uint16BE(domainLength + 3), Buffer.from("00", "hex"), uint16BE(domainLength), domain);
  parts.push(Buffer.from("00170000ff01000100000a000a0008", "hex"));
  addGrease(parts, greases, 4);
  parts.push(
    Buffer.from(
      "001d00170018000b00020100002300000010000e000c02683208687474702f312e310005" +
        "00050100000000000d001400120403080404010503080505010806060102010012000000" +
        "33002b0029",
      "hex"
    )
  );
  addGrease(parts, greases, 4);
  parts.push(Buffer.from("000100001d0020", "hex"), randomBytes(32));
  parts.push(Buffer.from("002d00020101002b000b0a", "hex"));
  addGrease(parts, greases, 6);
  parts.push(Buffer.from("0304030303020301001b0003020002", "hex"));
  addGrease(parts, greases, 3);
  parts.push(Buffer.from("0001000015", "hex"));

  const withoutPadding = Buffer.concat(parts);
  const paddingLength = FAKE_TLS_CLIENT_HELLO_LENGTH - 2 - withoutPadding.length;
  if (paddingLength < 0) {
    throw new Error("TLS-emulation domain is too long for ClientHello");
  }

  const data = Buffer.concat([
    withoutPadding,
    uint16BE(paddingLength),
    Buffer.alloc(paddingLength),
  ]);
  const digest = timestampedHmacDigest(key, data);
  digest.copy(data, 11);
  return { data, digest };
}

async function readTlsRecord(socket: MtprotoSocketLike, prefix: Buffer): Promise<Buffer> {
  const header = await socket.readExactly(5);
  if (!header.subarray(0, 3).equals(prefix)) {
    throw new Error("Invalid fake TLS record received from MTProto proxy");
  }
  const length = header.readUInt16BE(3);
  return Buffer.concat([header, await socket.readExactly(length)]);
}

function verifyFakeTlsServerHello(response: Buffer, clientDigest: Buffer, key: Buffer): void {
  if (response.length < 43 || !response.subarray(0, 3).equals(TLS_HANDSHAKE_PREFIX)) {
    throw new Error("Invalid fake TLS ServerHello received from MTProto proxy");
  }

  const serverDigest = Buffer.from(response.subarray(11, 43));
  const hmacInput = Buffer.concat([clientDigest, Buffer.from(response)]);
  hmacInput.fill(0, clientDigest.length + 11, clientDigest.length + 43);
  const expectedDigest = createHmac("sha256", key).update(hmacInput).digest();
  if (!timingSafeEqual(serverDigest, expectedDigest)) {
    throw new Error("Invalid fake TLS ServerHello digest from MTProto proxy");
  }
}

class FakeTlsRecordLayer {
  private incoming = Buffer.alloc(0);

  constructor(
    private readonly socket: MtprotoSocketLike,
    private readonly domain: Buffer,
    private readonly key: Buffer
  ) {}

  async init(): Promise<void> {
    const hello = createFakeTlsClientHello(this.domain, this.key);
    this.socket.write(hello.data);
    const serverHello = await readTlsRecord(this.socket, TLS_HANDSHAKE_PREFIX);
    const changeCipherSpec = await this.socket.readExactly(TLS_CHANGE_CIPHER_SPEC.length);
    if (!changeCipherSpec.equals(TLS_CHANGE_CIPHER_SPEC)) {
      throw new Error("Invalid fake TLS ChangeCipherSpec received from MTProto proxy");
    }
    const applicationData = await readTlsRecord(this.socket, TLS_APPLICATION_DATA_PREFIX);
    verifyFakeTlsServerHello(
      Buffer.concat([serverHello, changeCipherSpec, applicationData]),
      hello.digest,
      this.key
    );
  }

  wrapFirstPayload(data: Buffer): Buffer {
    return Buffer.concat([TLS_CHANGE_CIPHER_SPEC, this.wrapApplicationData(data)]);
  }

  write(data: Buffer): void {
    this.socket.write(this.wrapApplicationData(data));
  }

  async readExactly(n: number): Promise<Buffer> {
    while (this.incoming.length < n) {
      const record = await readTlsRecord(this.socket, TLS_APPLICATION_DATA_PREFIX);
      this.incoming = Buffer.concat([this.incoming, record.subarray(5)]);
    }
    const result = this.incoming.subarray(0, n);
    this.incoming = this.incoming.subarray(n);
    return result;
  }

  private wrapApplicationData(data: Buffer): Buffer {
    const records: Buffer[] = [];
    for (let offset = 0; offset < data.length; offset += FAKE_TLS_MAX_CLIENT_RECORD_PAYLOAD) {
      const chunk = data.subarray(offset, offset + FAKE_TLS_MAX_CLIENT_RECORD_PAYLOAD);
      records.push(TLS_APPLICATION_DATA_PREFIX, uint16BE(chunk.length), chunk);
    }
    return Buffer.concat(records);
  }
}

function getConnectionTCPMTProxyPaddedIntermediate(): typeof Connection {
  if (paddedIntermediateConnection) {
    return paddedIntermediateConnection;
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

    private readonly tls?: FakeTlsRecordLayer;

    constructor(connection: ConnectionTCPMTProxyPaddedIntermediate) {
      this.connection = connection.socket;
      this.packetClass = RandomizedIntermediatePacketCodec;
      this.secret = connection.secret;
      this.dcId = connection._dcId;
      this.tls = connection.tlsDomain
        ? new FakeTlsRecordLayer(this.connection, connection.tlsDomain, this.secret)
        : undefined;
    }

    async initHeader(): Promise<void> {
      await this.tls?.init();

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
      this.header = this.tls ? this.tls.wrapFirstPayload(random) : random;
    }

    async read(n: number): Promise<Buffer> {
      if (!this.decryptor) {
        throw new Error("MTProxy decryptor is not initialized");
      }
      const encrypted = this.tls
        ? await this.tls.readExactly(n)
        : await this.connection.readExactly(n);
      return this.decryptor.encrypt(encrypted);
    }

    write(data: Buffer): void {
      if (!this.encryptor) {
        throw new Error("MTProxy encryptor is not initialized");
      }
      const encrypted = this.encryptor.encrypt(data);
      if (this.tls) {
        this.tls.write(encrypted);
      } else {
        this.connection.write(encrypted);
      }
    }
  }

  class ConnectionTCPMTProxyPaddedIntermediate extends connectionModule.ObfuscatedConnection {
    ObfuscatedIO = MtprotoProxyObfuscatedIO;
    PacketCodecClass = gramjsPacketCodecClass;
    secret: Buffer;
    tlsDomain?: Buffer;

    constructor({ dcId, loggers, proxy, socket, testServers }: GramjsConnectionParams) {
      const mtprotoProxy = requireCustomMtprotoProxy(proxy);
      const reconnectProxy = {
        ...mtprotoProxy,
        MTProxy: true,
      } as ProxyInterface & CustomMtprotoProxy;
      super({
        ip: mtprotoProxy.ip,
        port: mtprotoProxy.port,
        dcId,
        loggers,
        proxy: reconnectProxy,
        socket,
        testServers,
      });
      this.secret = Buffer.from(mtprotoProxy.secret, "hex");
      this.tlsDomain = mtprotoProxy.tlsDomainHex
        ? Buffer.from(mtprotoProxy.tlsDomainHex, "hex")
        : undefined;
    }
  }

  const connectionClass = ConnectionTCPMTProxyPaddedIntermediate as unknown as typeof Connection;
  paddedIntermediateConnection = connectionClass;
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
