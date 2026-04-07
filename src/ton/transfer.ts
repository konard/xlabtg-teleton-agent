import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getKeyPair, getCachedTonClient, invalidateTonClientCache } from "./wallet-service.js";
import { createLogger } from "../utils/logger.js";
import { withTxLock } from "./tx-lock.js";
import { getAuditInstance, type FinancialAuditDetails } from "../services/audit.js";

const log = createLogger("TON");

export interface SendTonParams {
  toAddress: string;
  amount: number;
  comment?: string;
  bounce?: boolean;
}

export async function sendTon(params: SendTonParams): Promise<string | null> {
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

      const pseudoHash = `${seqno}_${Date.now()}_${amount.toFixed(2)}`;

      log.info(`Sent ${amount} TON to ${toAddress.slice(0, 8)}... - seqno: ${seqno}`);

      _logFinancial({
        operation: "ton_transfer",
        amount,
        asset: "TON",
        recipient: toAddress,
        comment: comment || undefined,
        txId: pseudoHash,
        status: "success",
      });

      return pseudoHash;
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
