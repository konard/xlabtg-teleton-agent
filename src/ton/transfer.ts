import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getKeyPair, getCachedTonClient, invalidateTonClientCache } from "./wallet-service.js";
import { createLogger } from "../utils/logger.js";
import { withTxLock } from "./tx-lock.js";
import { getAuditInstance, type FinancialAuditDetails } from "../services/audit.js";

const log = createLogger("TON");

/** How long to wait for on-chain confirmation before returning `pending` (ms) */
const TX_CONFIRM_TIMEOUT_MS = 60_000;
/** Interval between getTransactions polls (ms) */
const TX_POLL_INTERVAL_MS = 2_000;

export interface SendTonParams {
  toAddress: string;
  amount: number;
  comment?: string;
  bounce?: boolean;
}

export type TxConfirmationStatus = "confirmed" | "pending" | "failed";

export interface SendTonResult {
  /** Real on-chain tx hash (hex) when confirmed; null when pending */
  txHash: string | null;
  status: TxConfirmationStatus;
}

/**
 * Poll getTransactions on the wallet until we find an outbound tx that appeared
 * after the broadcast, or until the timeout elapses.
 *
 * Returns the real tx hash (hex) on confirmation, or null on timeout.
 */
async function awaitConfirmation(
  walletAddress: Address,
  broadcastedAt: number
): Promise<string | null> {
  const deadline = broadcastedAt + TX_CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, TX_POLL_INTERVAL_MS));

    try {
      const client = await getCachedTonClient();
      const txs = await client.getTransactions(walletAddress, { limit: 5 });

      for (const tx of txs) {
        // Only consider transactions that appeared after we broadcast
        if (tx.now * 1000 < broadcastedAt) continue;
        // Outbound transfers have outMessages (sent TON to recipient)
        if (tx.outMessages.size === 0) continue;
        return tx.hash().toString("hex");
      }
    } catch (err) {
      log.warn({ err }, "Polling getTransactions failed — retrying");
    }
  }

  return null;
}

export async function sendTon(params: SendTonParams): Promise<SendTonResult | null> {
  return withTxLock(async () => {
    const { toAddress, amount, comment = "", bounce = false } = params;

    if (!Number.isFinite(amount) || amount <= 0) {
      log.error({ amount }, "Invalid transfer amount");
      _logFinancial({
        operation: "ton_transfer",
        amount,
        asset: "TON",
        recipient: toAddress,
        comment: comment || undefined,
        status: "failed",
        error: "Invalid transfer amount",
      });
      return null;
    }

    let recipientAddress: Address;
    try {
      recipientAddress = Address.parse(toAddress);
    } catch (e) {
      log.error({ err: e }, `Invalid recipient address: ${toAddress}`);
      return null;
    }

    const keyPair = await getKeyPair();
    if (!keyPair) {
      log.error("Wallet not initialized");
      return null;
    }

    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    const client = await getCachedTonClient();
    const contract = client.open(wallet);

    const seqno = await contract.getSeqno();

    try {
      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: recipientAddress,
            value: toNano(amount),
            body: comment,
            bounce,
          }),
        ],
      });

      const broadcastedAt = Date.now();
      log.info(
        `Broadcast ${amount} TON to ${toAddress.slice(0, 8)}... seqno: ${seqno} — polling for confirmation`
      );

      const txHash = await awaitConfirmation(wallet.address, broadcastedAt);

      if (txHash) {
        log.info(`Confirmed ${amount} TON to ${toAddress.slice(0, 8)}... tx: ${txHash.slice(0, 8)}...`);

        _logFinancial({
          operation: "ton_transfer",
          amount,
          asset: "TON",
          recipient: toAddress,
          comment: comment || undefined,
          txId: txHash,
          status: "success",
        });

        return { txHash, status: "confirmed" };
      }

      // Broadcast succeeded but confirmation timed out — caller must handle pending state
      log.warn(
        `sendTon seqno=${seqno}: broadcast ok but confirmation timed out — status: pending`
      );

      _logFinancial({
        operation: "ton_transfer",
        amount,
        asset: "TON",
        recipient: toAddress,
        comment: comment || undefined,
        status: "success",
        error: "tx_pending: confirmation polling timed out",
      });

      return { txHash: null, status: "pending" };
    } catch (error: unknown) {
      // Invalidate node cache on 429/5xx so next attempt picks a fresh node
      const err = error as { status?: number; response?: { status?: number } };
      const status = err?.status || err?.response?.status;
      if (status === 429 || (status !== undefined && status >= 500)) {
        invalidateTonClientCache();
      }
      log.error({ err: error }, "Error sending TON");

      _logFinancial({
        operation: "ton_transfer",
        amount,
        asset: "TON",
        recipient: toAddress,
        comment: comment || undefined,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }); // withTxLock
}

/**
 * Write a financial audit entry via the AuditService singleton.
 * Silently skips if the audit service has not been initialized yet
 * (e.g. when running without WebUI/API). Errors are caught so they
 * never abort the financial operation itself.
 */
function _logFinancial(details: FinancialAuditDetails): void {
  try {
    getAuditInstance()?.logFinancial(details);
  } catch {
    // Audit failures must never interrupt financial operations
  }
}
