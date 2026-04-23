import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../services/audit.js", () => ({
  getAuditInstance: () => null,
}));

vi.mock("../tx-lock.js", () => ({
  withTxLock: (fn: () => unknown) => fn(),
}));

const mocks = vi.hoisted(() => ({
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
  invalidateTonClientCache: vi.fn(),
  addressParse: vi.fn(),
  walletCreate: vi.fn(),
  toNano: vi.fn(),
  internal: vi.fn(),
}));

vi.mock("../wallet-service.js", () => ({
  getKeyPair: mocks.getKeyPair,
  getCachedTonClient: mocks.getCachedTonClient,
  invalidateTonClientCache: mocks.invalidateTonClientCache,
}));

vi.mock("@ton/core", () => ({
  Address: { parse: mocks.addressParse },
  SendMode: { PAY_GAS_SEPARATELY: 1 },
}));

vi.mock("@ton/ton", () => ({
  WalletContractV5R1: { create: mocks.walletCreate },
  toNano: mocks.toNano,
  internal: mocks.internal,
}));

// ─── Imports (after mocks) ────────────────────────────────────────

import { sendTon } from "../transfer.js";

// ─── Helpers ──────────────────────────────────────────────────────

const REAL_TX_HASH = "a".repeat(64);
const REAL_TX_HASH_BUF = Buffer.from(REAL_TX_HASH, "hex");

function makeFakeAddress(str = "EQWallet") {
  return { toString: () => str };
}

function makeOutboundTx(nowSec: number) {
  return {
    now: nowSec,
    outMessages: { size: 1 },
    hash: () => REAL_TX_HASH_BUF,
  };
}

function makeInboundOnlyTx(nowSec: number) {
  return {
    now: nowSec,
    outMessages: { size: 0 },
    hash: () => REAL_TX_HASH_BUF,
  };
}

function setupDefaults(getTransactionsImpl: Mock) {
  const fakeKeyPair = {
    publicKey: Buffer.alloc(32, 1),
    secretKey: Buffer.alloc(64, 2),
  };
  const fakeWalletAddress = makeFakeAddress();
  const fakeContract = {
    getSeqno: vi.fn().mockResolvedValue(42),
    sendTransfer: vi.fn().mockResolvedValue(undefined),
  };
  const fakeClient = { getTransactions: getTransactionsImpl, open: () => fakeContract };
  const fakeWallet = { address: fakeWalletAddress };

  mocks.getKeyPair.mockResolvedValue(fakeKeyPair);
  mocks.walletCreate.mockReturnValue(fakeWallet);
  mocks.getCachedTonClient.mockResolvedValue(fakeClient);
  mocks.addressParse.mockReturnValue(makeFakeAddress("EQRecipient"));
  mocks.toNano.mockReturnValue(1_000_000_000n);
  mocks.internal.mockReturnValue({});

  return { fakeContract, fakeClient };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("sendTon()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for invalid amount (zero)", async () => {
    const result = await sendTon({ toAddress: "EQRecipient", amount: 0 });
    expect(result).toBeNull();
  });

  it("returns null for invalid amount (negative)", async () => {
    const result = await sendTon({ toAddress: "EQRecipient", amount: -1 });
    expect(result).toBeNull();
  });

  it("returns null when wallet is not initialized", async () => {
    mocks.getKeyPair.mockResolvedValue(null);
    mocks.addressParse.mockReturnValue(makeFakeAddress());
    const result = await sendTon({ toAddress: "EQRecipient", amount: 1 });
    expect(result).toBeNull();
  });

  it("returns confirmed status with real tx hash when getTransactions finds outbound tx", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const getTransactions = vi.fn().mockResolvedValue([makeOutboundTx(nowSec + 3)]);
    const { fakeContract } = setupDefaults(getTransactions);

    // Advance time so the first poll fires after broadcast
    const sendPromise = sendTon({ toAddress: "EQRecipient", amount: 1.5 });
    // Allow microtasks (sendTransfer) to settle then advance past first poll interval (2s)
    await vi.runAllTimersAsync();

    const result = await sendPromise;

    expect(fakeContract.sendTransfer).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result!.status).toBe("confirmed");
    expect(result!.txHash).toBe(REAL_TX_HASH);
    // Must NOT be a pseudo-hash
    expect(result!.txHash).not.toMatch(/^\d+_\d+_/);
  });

  it("returns pending status when getTransactions returns no outbound tx within timeout", async () => {
    // Always returns a tx that is older than broadcastedAt (i.e., from before the transfer)
    const pastSec = Math.floor(Date.now() / 1000) - 120;
    const getTransactions = vi.fn().mockResolvedValue([makeOutboundTx(pastSec)]);
    setupDefaults(getTransactions);

    const sendPromise = sendTon({ toAddress: "EQRecipient", amount: 1.5 });
    // Fast-forward past the full 60s timeout
    await vi.runAllTimersAsync();

    const result = await sendPromise;

    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.txHash).toBeNull();
  });

  it("returns pending when getTransactions returns only inbound txs (no outMessages)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Only inbound tx (no outMessages) — should not match
    const getTransactions = vi.fn().mockResolvedValue([makeInboundOnlyTx(nowSec + 3)]);
    setupDefaults(getTransactions);

    const sendPromise = sendTon({ toAddress: "EQRecipient", amount: 1.5 });
    await vi.runAllTimersAsync();

    const result = await sendPromise;

    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.txHash).toBeNull();
  });

  it("returns pending when getTransactions returns empty list", async () => {
    const getTransactions = vi.fn().mockResolvedValue([]);
    setupDefaults(getTransactions);

    const sendPromise = sendTon({ toAddress: "EQRecipient", amount: 1.5 });
    await vi.runAllTimersAsync();

    const result = await sendPromise;

    expect(result!.status).toBe("pending");
    expect(result!.txHash).toBeNull();
  });

  it("continues polling when a getTransactions call throws, then confirms on success", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const getTransactions = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue([makeOutboundTx(nowSec + 5)]);
    setupDefaults(getTransactions);

    const sendPromise = sendTon({ toAddress: "EQRecipient", amount: 1.5 });
    await vi.runAllTimersAsync();

    const result = await sendPromise;

    expect(result!.status).toBe("confirmed");
    expect(result!.txHash).toBe(REAL_TX_HASH);
    expect(getTransactions).toHaveBeenCalledTimes(2);
  });

  it("throws and invalidates client cache on sendTransfer 429 error", async () => {
    const getTransactions = vi.fn().mockResolvedValue([]);
    const { fakeContract } = setupDefaults(getTransactions);

    const err429 = Object.assign(new Error("too many requests"), { status: 429 });
    fakeContract.sendTransfer.mockRejectedValue(err429);

    await expect(sendTon({ toAddress: "EQRecipient", amount: 1 })).rejects.toThrow(
      "too many requests"
    );

    expect(mocks.invalidateTonClientCache).toHaveBeenCalledOnce();
  });
});
