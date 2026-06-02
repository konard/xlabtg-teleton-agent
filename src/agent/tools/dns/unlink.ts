import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet, getCachedTonClient } from "../../../ton/wallet-service.js";
import { toNano, internal, beginCell } from "@ton/ton";
import { Address } from "@ton/core";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { withTxLock } from "../../../ton/tx-lock.js";
import { openWallet } from "../../../ton/wallet-open.js";
import { sendWalletTx, tonExplorerTxUrl } from "../../../ton/confirm.js";

const log = createLogger("Tools");

// Op code for change_dns_record
const DNS_CHANGE_RECORD_OP = 0x4eb1f0f9;

// sha256("wallet") - record key for wallet address
const WALLET_RECORD_KEY = BigInt(
  "0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b"
);
interface DnsUnlinkParams {
  domain: string;
}
export const dnsUnlinkTool: Tool = {
  name: "dns_unlink",
  description: "Remove the wallet link from a .ton domain you own.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
  }),
};
export const dnsUnlinkExecutor: ToolExecutor<DnsUnlinkParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    let { domain } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Get domain info from TonAPI
    const dnsResponse = await tonapiFetch(`/dns/${fullDomain}`);

    if (dnsResponse.status === 404) {
      return {
        success: false,
        error: `Domain ${fullDomain} does not exist or is not minted yet.`,
      };
    }

    if (!dnsResponse.ok) {
      return {
        success: false,
        error: `TonAPI error: ${dnsResponse.status}`,
      };
    }

    const dnsInfo = await dnsResponse.json();

    // Get NFT address
    const nftAddress = dnsInfo.item?.address;
    if (!nftAddress) {
      return {
        success: false,
        error: `Could not determine NFT address for ${fullDomain}`,
      };
    }

    // Verify ownership - only owner can change DNS records
    const ownerAddress = dnsInfo.item?.owner?.address;
    if (!ownerAddress) {
      return {
        success: false,
        error: `Domain ${fullDomain} has no owner (still in auction?)`,
      };
    }

    // Normalize addresses for comparison
    const ownerNormalized = Address.parse(ownerAddress).toString();
    const agentNormalized = Address.parse(walletData.address).toString();

    if (ownerNormalized !== agentNormalized) {
      return {
        success: false,
        error: `You don't own ${fullDomain}. Owner: ${ownerAddress}`,
      };
    }

    const client = await getCachedTonClient();
    const opened = await openWallet(client);
    if (!opened) {
      return { success: false, error: "Wallet key derivation failed." };
    }
    const { keyPair, contract } = opened;

    const sent = await withTxLock(async () => {
      // Build change_dns_record message body WITHOUT value cell (triggers deletion)
      // Contract checks: if (slice_refs() > 0) set record, else delete record
      const body = beginCell()
        .storeUint(DNS_CHANGE_RECORD_OP, 32) // op = change_dns_record
        .storeUint(0, 64) // query_id
        .storeUint(WALLET_RECORD_KEY, 256) // key = sha256("wallet")
        // NO storeRef() - absence of value cell triggers deletion
        .endCell();

      return sendWalletTx(client, contract, {
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to: Address.parse(nftAddress),
            value: toNano("0.05"), // Gas for DNS record update
            body,
            bounce: true,
          }),
        ],
      });
    });

    if (!sent) {
      return { success: false, error: "DNS update failed or could not be confirmed on-chain." };
    }

    return {
      success: true,
      data: {
        domain: fullDomain,
        nftAddress,
        from: walletData.address,
        txHash: sent.hash,
        message: `Unlinked wallet from ${fullDomain} — confirmed on-chain\n  NFT: ${nftAddress}\n  tx ${sent.hash}\n  ${tonExplorerTxUrl(sent.hash)}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dns_unlink");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
