import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../config/loader.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-test-doctor",
}));

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
      address: { toString: vi.fn(() => "EQDummyAddressForTest") },
    })),
  },
  TonClient: vi.fn(),
  fromNano: vi.fn(),
}));

vi.mock("../../../ton/endpoint.js", () => ({
  getCachedHttpEndpoint: vi.fn(),
  invalidateEndpointCache: vi.fn(),
  getToncenterApiKey: vi.fn(() => null),
}));

vi.mock("../../../utils/fetch.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock("../../../constants/api-endpoints.js", () => ({
  tonapiFetch: vi.fn(),
  COINGECKO_API_URL: "https://api.coingecko.com/api/v3",
}));

vi.mock("yaml", () => ({
  parse: vi.fn(() => ({})),
}));

vi.mock("../../../config/schema.js", () => ({
  ConfigSchema: { safeParse: vi.fn(() => ({ success: true })) },
}));

vi.mock("../../../config/providers.js", () => ({
  getProviderMetadata: vi.fn(() => ({
    displayName: "Anthropic",
    defaultModel: "claude-3-5-sonnet",
  })),
  validateApiKeyFormat: vi.fn(() => null),
}));

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 1024, mtimeMs: Date.now() })),
}));

vi.mock("fs", () => ({
  existsSync: mockFs.existsSync,
  mkdirSync: mockFs.mkdirSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
  statSync: mockFs.statSync,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { encryptMnemonic, _resetWalletCacheForTesting } from "../../../ton/wallet-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
const TEST_ADDRESS = "EQDummyAddressForTest123456";

function makePlaintextWalletJson(): string {
  return JSON.stringify({
    version: "w5r1",
    address: TEST_ADDRESS,
    publicKey: "aabbccdd",
    mnemonic: TEST_MNEMONIC,
    createdAt: "2024-01-01T00:00:00.000Z",
  });
}

function makeEncryptedWalletJson(key: Buffer): string {
  const { iv, tag, ciphertext } = encryptMnemonic(TEST_MNEMONIC, key);
  return JSON.stringify({
    encrypted: true,
    version: "w5r1",
    address: TEST_ADDRESS,
    publicKey: "aabbccdd",
    createdAt: "2024-01-01T00:00:00.000Z",
    iv,
    tag,
    ciphertext,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("doctorCommand checkWallet integration", () => {
  const origEnv = process.env.TELETON_WALLET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetWalletCacheForTesting();
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.TELETON_WALLET_KEY;
    } else {
      process.env.TELETON_WALLET_KEY = origEnv;
    }
    _resetWalletCacheForTesting();
  });

  it("returns warn for a plaintext (legacy) wallet", async () => {
    delete process.env.TELETON_WALLET_KEY;

    // wallet.json exists and is plaintext
    mockFs.existsSync.mockImplementation((p: string) => (p.endsWith("wallet.json") ? true : false));
    mockFs.readFileSync.mockReturnValue(makePlaintextWalletJson());

    // Import doctorCommand after mocks are set up
    const { doctorCommand } = await import("../doctor.js");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await doctorCommand();
    } finally {
      console.log = origLog;
    }

    const walletLine = output.find((l) => l.includes("TON wallet"));
    expect(walletLine).toBeDefined();
    // warn state renders the yellow ⚠ icon
    expect(walletLine).toContain("⚠");
    expect(walletLine).toContain("plaintext mnemonic");
  });

  it("returns ok for a valid encrypted wallet with correct key", async () => {
    const key = randomBytes(32);
    process.env.TELETON_WALLET_KEY = key.toString("hex");

    mockFs.existsSync.mockImplementation((p: string) => (p.endsWith("wallet.json") ? true : false));
    mockFs.readFileSync.mockReturnValue(makeEncryptedWalletJson(key));

    const { doctorCommand } = await import("../doctor.js");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await doctorCommand();
    } finally {
      console.log = origLog;
    }

    const walletLine = output.find((l) => l.includes("TON wallet"));
    expect(walletLine).toBeDefined();
    // ok state renders the green ✓ icon
    expect(walletLine).toContain("✓");
    expect(walletLine).not.toContain("plaintext");
    expect(walletLine).not.toContain("error");
  });

  it("returns error for an encrypted wallet with a wrong key", async () => {
    const encryptKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    process.env.TELETON_WALLET_KEY = wrongKey.toString("hex");

    mockFs.existsSync.mockImplementation((p: string) => (p.endsWith("wallet.json") ? true : false));
    mockFs.readFileSync.mockReturnValue(makeEncryptedWalletJson(encryptKey));

    const { doctorCommand } = await import("../doctor.js");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await doctorCommand();
    } finally {
      console.log = origLog;
    }

    const walletLine = output.find((l) => l.includes("TON wallet"));
    expect(walletLine).toBeDefined();
    // error state renders the red ✗ icon
    expect(walletLine).toContain("✗");
    expect(walletLine).toMatch(/[Dd]ecryption failed|wrong key|corrupted/);
  });
});
