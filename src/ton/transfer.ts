import { WalletContractV5R1, toNano, internal, type TonClient } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getKeyPair, getCachedTonClient, invalidateTonClientCache } from "./wallet-service.js";
import { createLogger } from "../utils/logger.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { withTxLock } from "./tx-lock.js";
import { TON_CONFIRM_TIMEOUT_MS, TON_CONFIRM_POLL_INTERVAL_MS } from "../constants/timeouts.js";

const log = createLogger("TON");

export interface SendTonParams {
  toAddress: string;
  amount: number;
  comment?: string;
  bounce?: boolean;
}

export interface SendTonResult {
  /** Real on-chain account-transaction hash (hex) — verifiable on TON explorers. */
  hash: string;
  /** Wallet seqno consumed by this transfer. */
  seqno: number;
  /** Unix-ms timestamp of the confirmed transaction. */
  at: number;
}

/** Explorer link for a confirmed transaction (endpoints are mainnet — see endpoint.ts). */
export function tonExplorerTxUrl(hash: string): string {
  return `https://tonviewer.com/transaction/${hash}`;
}

function isServerError(error: unknown): boolean {
  const err = error as { status?: number; response?: { status?: number } };
  const status = err?.status ?? err?.response?.status;
  return status === 429 || (status !== undefined && status >= 500);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Locate the wallet's own outgoing transaction and confirm it committed.
 *
 * Our transfer is the newest `external-in` transaction with `lt` past the pre-send
 * snapshot: incoming payments are `internal`, and the tx-lock guarantees only one of
 * our sends is in flight, so the match is unambiguous. A successful seqno bump is not
 * enough — the action phase must also succeed, otherwise the funds never left the
 * wallet (e.g. insufficient balance). Returns the real on-chain hash, or null if the
 * transfer is not confirmed within the finality window.
 */
async function confirmOutgoing(
  client: TonClient,
  walletAddress: Address,
  sinceLt: bigint
): Promise<{ hash: string; at: number } | null> {
  const deadline = Date.now() + TON_CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const txs = await client.getTransactions(walletAddress, { limit: 10 });
      const ours = txs.find((tx) => tx.inMessage?.info.type === "external-in" && tx.lt > sinceLt);

      if (ours) {
        const d = ours.description;
        if (d.type !== "generic") {
          log.error({ type: d.type }, "Unexpected transfer transaction type");
          return null;
        }
        const computeOk = d.computePhase.type === "vm" && d.computePhase.success;
        const actionOk = d.actionPhase?.success === true;
        if (!computeOk || !actionOk) {
          log.error(
            {
              exitCode: d.computePhase.type === "vm" ? d.computePhase.exitCode : undefined,
              actionResult: d.actionPhase?.resultCode,
              noFunds: d.actionPhase?.noFunds,
            },
            "Transfer failed on-chain — funds did not leave the wallet"
          );
          return null;
        }
        return { hash: ours.hash().toString("hex"), at: ours.now * 1000 };
      }
    } catch (error) {
      log.debug({ err: error }, "Confirm poll failed; retrying");
    }
    await sleep(TON_CONFIRM_POLL_INTERVAL_MS);
  }

  return null;
}

/**
 * Send TON and return the real, explorer-verifiable transaction once it has committed
 * on-chain. Returns null when the transfer cannot be confirmed (invalid params, wallet
 * not initialized, or not committed within the finality window) — never an optimistic
 * success. Serialized via the wallet tx-lock so the seqno read → send → confirm sequence
 * is atomic.
 */
export async function sendTon(params: SendTonParams): Promise<SendTonResult | null> {
  return withTxLock(async () => {
    const { toAddress, amount, comment = "", bounce = false } = params;

    if (!Number.isFinite(amount) || amount <= 0) {
      log.error({ amount }, "Invalid transfer amount");
      return null;
    }

    let recipientAddress: Address;
    try {
      recipientAddress = Address.parse(toAddress);
    } catch (error) {
      log.error({ err: error }, `Invalid recipient address: ${toAddress}`);
      return null;
    }

    const keyPair = await getKeyPair();
    if (!keyPair) {
      log.error("Wallet not initialized");
      return null;
    }

    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const client = await getCachedTonClient();
    const contract = client.open(wallet);

    // Snapshot wallet state before sending so we can identify our own transaction.
    let seqno: number;
    let sinceLt: bigint;
    try {
      seqno = await withBlockchainRetry(() => contract.getSeqno(), "getSeqno");
      const recent = await withBlockchainRetry(
        () => client.getTransactions(wallet.address, { limit: 1 }),
        "getTransactions"
      );
      sinceLt = recent[0]?.lt ?? 0n;
    } catch (error) {
      log.error({ err: error }, "Failed to read wallet state before transfer");
      throw error;
    }

    // Broadcast once. The external message may be accepted even if the RPC response
    // errors, and re-broadcasting the same seqno is a no-op once consumed, so the chain
    // — not this call's outcome — is the source of truth. Confirm regardless.
    let broadcastError: unknown;
    try {
      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({ to: recipientAddress, value: toNano(amount), body: comment, bounce }),
        ],
      });
    } catch (error) {
      broadcastError = error;
      if (isServerError(error)) invalidateTonClientCache();
      log.warn({ err: error }, "Broadcast errored — verifying on-chain whether it landed");
    }

    const confirmed = await confirmOutgoing(client, wallet.address, sinceLt);

    if (!confirmed) {
      if (broadcastError) throw broadcastError;
      log.error({ toAddress, amount, seqno }, "Transfer not confirmed on-chain within timeout");
      return null;
    }

    log.info(
      `Sent ${amount} TON to ${toAddress.slice(0, 8)}... — seqno ${seqno}, tx ${confirmed.hash.slice(0, 8)}...`
    );
    return { hash: confirmed.hash, seqno, at: confirmed.at };
  });
}
