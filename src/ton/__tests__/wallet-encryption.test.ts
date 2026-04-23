import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config loader — encryption key injection happens via env in unit tests
vi.mock("../../config/loader.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

// Mock workspace paths
vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-test-wallet-enc",
}));

// Mock @ton/crypto so tests run without real TON deps
vi.mock("@ton/crypto", () => ({
  mnemonicNew: vi.fn(async () => Array.from({ length: 24 }, (_, i) => `word${i + 1}`)),
  mnemonicToPrivateKey: vi.fn(async () => ({
    publicKey: Buffer.alloc(32, 0x01),
    secretKey: Buffer.alloc(64, 0x02),
  })),
  mnemonicValidate: vi.fn(async () => true),
}));

vi.mock("@ton/ton", () => ({
  WalletContractV5R1: {
    create: vi.fn(() => ({
      address: {
        toString: vi.fn(() => "EQDummyAddressForTest"),
      },
    })),
  },
  TonClient: vi.fn(),
  fromNano: vi.fn(),
}));

vi.mock("../endpoint.js", () => ({
  getCachedHttpEndpoint: vi.fn(),
  invalidateEndpointCache: vi.fn(),
  getToncenterApiKey: vi.fn(() => null),
}));

vi.mock("../../utils/fetch.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock("../../constants/api-endpoints.js", () => ({
  tonapiFetch: vi.fn(),
  COINGECKO_API_URL: "https://api.coingecko.com/api/v3",
}));

// Mock filesystem — controlled per test
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mockFs.existsSync,
  mkdirSync: mockFs.mkdirSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  encryptMnemonic,
  decryptMnemonic,
  resolveEncryptionKey,
  saveWallet,
  loadWallet,
  getKeyPair,
  clearKeyPair,
  _resetWalletCacheForTesting,
  type WalletData,
} from "../wallet-service.js";

import { mnemonicToPrivateKey } from "@ton/crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKey(): Buffer {
  return randomBytes(32);
}

const TEST_MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);

const TEST_WALLET: WalletData = {
  version: "w5r1",
  address: "EQDummyAddressForTest",
  publicKey: "aabbccdd",
  mnemonic: TEST_MNEMONIC,
  createdAt: "2024-01-01T00:00:00.000Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("encryptMnemonic / decryptMnemonic", () => {
  it("round-trips the mnemonic correctly", () => {
    const key = makeKey();
    const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key);
    const result = decryptMnemonic(ciphertext, iv, tag, key);
    expect(result).toEqual(TEST_MNEMONIC);
  });

  it("produces different ciphertext for each call (random IV)", () => {
    const key = makeKey();
    const r1 = encryptMnemonic(TEST_MNEMONIC, key);
    const r2 = encryptMnemonic(TEST_MNEMONIC, key);
    expect(r1.iv).not.toBe(r2.iv);
    expect(r1.ciphertext).not.toBe(r2.ciphertext);
  });

  it("throws when decrypting with wrong key", () => {
    const key1 = makeKey();
    const key2 = makeKey();
    const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key1);
    expect(() => decryptMnemonic(ciphertext, iv, tag, key2)).toThrow();
  });

  it("throws when ciphertext is tampered", () => {
    const key = makeKey();
    const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key);
    // Flip one byte in the ciphertext
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === "ff" ? "00" : "ff");
    expect(() => decryptMnemonic(tampered, iv, tag, key)).toThrow();
  });

  it("throws when auth tag is tampered", () => {
    const key = makeKey();
    const { iv, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key);
    const badTag = "00".repeat(16);
    expect(() => decryptMnemonic(ciphertext, iv, badTag, key)).toThrow();
  });
});

describe("resolveEncryptionKey", () => {
  const origEnv = process.env.TELETON_WALLET_KEY;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.TELETON_WALLET_KEY;
    } else {
      process.env.TELETON_WALLET_KEY = origEnv;
    }
  });

  it("returns null when no key is configured", () => {
    delete process.env.TELETON_WALLET_KEY;
    expect(resolveEncryptionKey()).toBeNull();
  });

  it("returns a 32-byte Buffer from a valid env var", () => {
    const hex = randomBytes(32).toString("hex");
    process.env.TELETON_WALLET_KEY = hex;
    const key = resolveEncryptionKey();
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
    expect(key!.toString("hex")).toBe(hex);
  });

  it("throws for an invalid (non-hex) env key", () => {
    process.env.TELETON_WALLET_KEY = "not-hex-at-all-and-also-wrong-length";
    expect(() => resolveEncryptionKey()).toThrow(/64-character hex/);
  });

  it("throws for a correct-length but non-hex env key", () => {
    process.env.TELETON_WALLET_KEY = "z".repeat(64);
    expect(() => resolveEncryptionKey()).toThrow(/64-character hex/);
  });
});

describe("saveWallet / loadWallet (encryption integration)", () => {
  const origEnv = process.env.TELETON_WALLET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level singleton caches between tests
    _resetWalletCacheForTesting();
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.TELETON_WALLET_KEY;
    } else {
      process.env.TELETON_WALLET_KEY = origEnv;
    }
  });

  it("saves plaintext when no encryption key is set", () => {
    delete process.env.TELETON_WALLET_KEY;
    mockFs.existsSync.mockReturnValue(true);

    saveWallet(TEST_WALLET);

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    // Plaintext format: mnemonic array is visible
    expect(parsed.encrypted).toBeUndefined();
    expect(Array.isArray(parsed.mnemonic)).toBe(true);
    expect(parsed.mnemonic).toEqual(TEST_MNEMONIC);
  });

  it("saves encrypted format when key is set", () => {
    const hex = randomBytes(32).toString("hex");
    process.env.TELETON_WALLET_KEY = hex;
    mockFs.existsSync.mockReturnValue(true);

    saveWallet(TEST_WALLET);

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    // Encrypted format: no plaintext mnemonic
    expect(parsed.encrypted).toBe(true);
    expect(parsed.mnemonic).toBeUndefined();
    expect(typeof parsed.iv).toBe("string");
    expect(typeof parsed.tag).toBe("string");
    expect(typeof parsed.ciphertext).toBe("string");
  });

  it("encrypted wallet round-trips through save/load", () => {
    const hex = randomBytes(32).toString("hex");
    process.env.TELETON_WALLET_KEY = hex;

    let savedContent = "";
    mockFs.existsSync.mockReturnValue(true);
    mockFs.writeFileSync.mockImplementation((_path, content) => {
      savedContent = content as string;
    });
    mockFs.readFileSync.mockImplementation(() => savedContent);

    saveWallet(TEST_WALLET);

    // Simulate a fresh load (clear module cache indirectly via exported fn)
    // We call loadWallet after resetting _walletCache via saveWallet's side-effect
    const loaded = loadWallet();
    expect(loaded).not.toBeNull();
    expect(loaded!.mnemonic).toEqual(TEST_MNEMONIC);
    expect(loaded!.address).toBe(TEST_WALLET.address);
    expect(loaded!.version).toBe(TEST_WALLET.version);
  });

  it("loadWallet returns null when file is encrypted but no key configured", () => {
    delete process.env.TELETON_WALLET_KEY;

    const hex = randomBytes(32).toString("hex");
    const key = Buffer.from(hex, "hex");
    const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key);
    const encryptedFile = JSON.stringify({
      encrypted: true,
      version: "w5r1",
      address: TEST_WALLET.address,
      publicKey: TEST_WALLET.publicKey,
      createdAt: TEST_WALLET.createdAt,
      iv,
      tag,
      ciphertext,
    });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(encryptedFile);

    const loaded = loadWallet();
    expect(loaded).toBeNull();
  });

  it("loadWallet returns null when decryption fails (wrong key)", () => {
    const keyUsedToEncrypt = randomBytes(32);
    const wrongKeyHex = randomBytes(32).toString("hex");
    process.env.TELETON_WALLET_KEY = wrongKeyHex;

    const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, keyUsedToEncrypt);
    const encryptedFile = JSON.stringify({
      encrypted: true,
      version: "w5r1",
      address: TEST_WALLET.address,
      publicKey: TEST_WALLET.publicKey,
      createdAt: TEST_WALLET.createdAt,
      iv,
      tag,
      ciphertext,
    });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(encryptedFile);

    const loaded = loadWallet();
    expect(loaded).toBeNull();
  });
});

// ─── Issue #319 regression: clearKeyPair() zeroizes and evicts the cache ─────

describe("clearKeyPair (AUDIT-FULL-L3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetWalletCacheForTesting();
    delete process.env.TELETON_WALLET_KEY;
  });

  it("clearKeyPair() zeroizes secretKey and removes the cache entry", async () => {
    // Arrange: load a plaintext wallet so the cache can be populated
    const plaintext = JSON.stringify(TEST_WALLET);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(plaintext);

    const kp = await getKeyPair();
    expect(kp).not.toBeNull();
    const secretKeyRef = kp!.secretKey;

    // Act
    clearKeyPair();

    // Assert: Buffer has been zeroed in place
    expect(secretKeyRef.every((b) => b === 0)).toBe(true);

    // Assert: cache is evicted — next getKeyPair() triggers re-derivation
    const deriveSpy = vi.mocked(mnemonicToPrivateKey);
    const callsBefore = deriveSpy.mock.calls.length;
    await getKeyPair();
    expect(deriveSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("clearKeyPair() is idempotent when cache is already empty", () => {
    // Should not throw even when called with no cached key pair
    expect(() => clearKeyPair()).not.toThrow();
  });

  it("after clearKeyPair() (simulating /pause), subsequent getKeyPair() re-derives the key", async () => {
    const plaintext = JSON.stringify(TEST_WALLET);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(plaintext);

    await getKeyPair();

    const deriveSpy = vi.mocked(mnemonicToPrivateKey);
    const countAfterFirstCall = deriveSpy.mock.calls.length;

    // Simulate /pause
    clearKeyPair();

    // Next transfer would call getKeyPair() again — it must re-derive
    await getKeyPair();
    expect(deriveSpy.mock.calls.length).toBe(countAfterFirstCall + 1);
  });
});
