import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from "@ton/crypto";
import { WalletContractV5R1, TonClient, fromNano } from "@ton/ton";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { loadConfig } from "../config/loader.js";
import { getCachedHttpEndpoint, invalidateEndpointCache, getToncenterApiKey } from "./endpoint.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { tonapiFetch, COINGECKO_API_URL } from "../constants/api-endpoints.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("TON");

const WALLET_FILE = join(TELETON_ROOT, "wallet.json");

// ─── Singleton Caches ────────────────────────────────────────────────
/** Cached wallet data (invalidated on saveWallet) */
let _walletCache: WalletData | null | undefined; // undefined = not yet loaded

/** Cached key pair derived from mnemonic */
let _keyPairCache: { publicKey: Buffer; secretKey: Buffer } | null = null;

/** Cached TonClient — invalidated when endpoint rotates */
let _tonClientCache: { client: TonClient; endpoint: string } | null = null;

export interface WalletData {
  version: "w5r1";
  address: string;
  publicKey: string;
  mnemonic: string[];
  createdAt: string;
}

// ─── Encrypted wallet file format ───────────────────────────────────
interface EncryptedWalletFile {
  encrypted: true;
  version: "w5r1";
  address: string;
  publicKey: string;
  createdAt: string;
  /** AES-256-GCM IV, hex-encoded (12 bytes = 24 hex chars) */
  iv: string;
  /** AES-256-GCM auth tag, hex-encoded (16 bytes = 32 hex chars) */
  tag: string;
  /** Encrypted mnemonic (JSON array), hex-encoded ciphertext */
  ciphertext: string;
}

// ─── Encryption helpers ──────────────────────────────────────────────

/**
 * Resolve the wallet encryption key from env or config.
 * Returns a 32-byte Buffer or null when encryption is not configured.
 */
export function resolveEncryptionKey(): Buffer | null {
  // Environment variable takes precedence (allows Docker secrets / CI)
  const envKey = process.env.TELETON_WALLET_KEY;
  if (envKey) {
    if (envKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(envKey)) {
      throw new Error(
        "TELETON_WALLET_KEY must be a 64-character hex string (32 bytes). " +
          "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    return Buffer.from(envKey, "hex");
  }

  // Config file key (encryption is optional — silently skipped if config not available yet)
  try {
    const cfg = loadConfig();
    if (cfg?.wallet_encryption_key) {
      const cfgKey = cfg.wallet_encryption_key;
      if (cfgKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(cfgKey)) {
        throw new Error(
          "wallet_encryption_key in config must be a 64-character hex string (32 bytes)."
        );
      }
      return Buffer.from(cfgKey, "hex");
    }
  } catch (err) {
    // Config not available yet (e.g. first-time setup) — encryption is optional
    if (err instanceof Error && err.message.includes("wallet_encryption_key")) throw err;
  }

  return null;
}

/**
 * Encrypt the mnemonic array with AES-256-GCM.
 * Returns iv, tag, and ciphertext as hex strings.
 */
export function encryptMnemonic(
  mnemonic: string[],
  key: Buffer
): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(mnemonic);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

/**
 * Decrypt the mnemonic array with AES-256-GCM.
 * Throws if the key is wrong or the data is tampered.
 */
export function decryptMnemonic(
  ciphertext: string,
  iv: string,
  tag: string,
  key: Buffer
): string[] {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as string[];
}

/**
 * Generate a new TON wallet (W5R1)
 */
export async function generateWallet(): Promise<WalletData> {
  // Generate new mnemonic (24 words)
  const mnemonic = await mnemonicNew(24);

  // Derive keys from mnemonic
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  // Create W5R1 wallet contract
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const address = wallet.address.toString({ bounceable: true, testOnly: false });

  return {
    version: "w5r1",
    address,
    publicKey: keyPair.publicKey.toString("hex"),
    mnemonic,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Save wallet to ~/.teleton/wallet.json.
 * When an encryption key is configured the mnemonic is stored encrypted
 * with AES-256-GCM; otherwise it is stored as plaintext (legacy behaviour).
 */
export function saveWallet(wallet: WalletData): void {
  const dir = dirname(WALLET_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let key: Buffer | null = null;
  try {
    key = resolveEncryptionKey();
  } catch (err) {
    log.error({ err }, "Invalid wallet encryption key — wallet NOT saved");
    throw err;
  }

  let fileContent: string;
  if (key) {
    const { iv, tag, ciphertext } = encryptMnemonic(wallet.mnemonic, key);
    const encrypted: EncryptedWalletFile = {
      encrypted: true,
      version: wallet.version,
      address: wallet.address,
      publicKey: wallet.publicKey,
      createdAt: wallet.createdAt,
      iv,
      tag,
      ciphertext,
    };
    fileContent = JSON.stringify(encrypted, null, 2);
    log.debug("Saving wallet with AES-256-GCM encrypted mnemonic");
  } else {
    fileContent = JSON.stringify(wallet, null, 2);
    log.debug("Saving wallet with plaintext mnemonic (no encryption key configured)");
  }

  writeFileSync(WALLET_FILE, fileContent, { encoding: "utf-8", mode: 0o600 });

  // Invalidate caches so next loadWallet()/getKeyPair() re-reads
  _walletCache = undefined;
  _keyPairCache = null;
}

/**
 * Load wallet from ~/.teleton/wallet.json (cached after first read).
 * Supports both plaintext (legacy) and AES-256-GCM encrypted formats.
 * When an encryption key is configured and the file is still plaintext,
 * the wallet is transparently re-encrypted and saved.
 */
export function loadWallet(): WalletData | null {
  if (_walletCache !== undefined) return _walletCache;

  if (!existsSync(WALLET_FILE)) {
    _walletCache = null;
    return null;
  }

  try {
    const content = readFileSync(WALLET_FILE, "utf-8");
    const parsed = JSON.parse(content);

    let mnemonic: string[];

    if (parsed.encrypted === true) {
      // ── Encrypted format ──────────────────────────────────────────
      let key: Buffer | null = null;
      try {
        key = resolveEncryptionKey();
      } catch (err) {
        log.error({ err }, "Invalid wallet encryption key — cannot load wallet");
        _walletCache = null;
        return null;
      }

      if (!key) {
        log.error(
          "wallet.json is encrypted but no encryption key is configured. " +
            "Set TELETON_WALLET_KEY or wallet_encryption_key in config.yaml."
        );
        _walletCache = null;
        return null;
      }

      try {
        mnemonic = decryptMnemonic(parsed.ciphertext, parsed.iv, parsed.tag, key);
      } catch (err) {
        log.error({ err }, "Failed to decrypt wallet.json — wrong key or corrupted file");
        _walletCache = null;
        return null;
      }
    } else {
      // ── Plaintext (legacy) format ─────────────────────────────────
      if (!parsed.mnemonic || !Array.isArray(parsed.mnemonic) || parsed.mnemonic.length !== 24) {
        throw new Error("Invalid wallet.json: mnemonic must be a 24-word array");
      }
      mnemonic = parsed.mnemonic as string[];

      // Transparently migrate to encrypted format if key is now configured
      let key: Buffer | null = null;
      try {
        key = resolveEncryptionKey();
      } catch {
        // Ignore key errors during migration attempt — log and continue plaintext
      }
      if (key) {
        log.info("Encryption key detected — migrating plaintext wallet.json to encrypted format");
        try {
          const walletToMigrate: WalletData = {
            version: parsed.version ?? "w5r1",
            address: parsed.address,
            publicKey: parsed.publicKey,
            mnemonic,
            createdAt: parsed.createdAt,
          };
          saveWallet(walletToMigrate);
          // loadWallet() is recursively called by saveWallet cache reset, so just load from cache
        } catch (err) {
          log.error(
            { err },
            "Failed to migrate wallet to encrypted format — continuing with plaintext"
          );
        }
      }
    }

    if (mnemonic.length !== 24) {
      throw new Error("Invalid wallet.json: mnemonic must be a 24-word array");
    }

    _walletCache = {
      version: parsed.version ?? "w5r1",
      address: parsed.address,
      publicKey: parsed.publicKey,
      mnemonic,
      createdAt: parsed.createdAt,
    } as WalletData;

    return _walletCache;
  } catch (error) {
    log.error({ err: error }, "Failed to load wallet");
    _walletCache = null;
    return null;
  }
}

/**
 * Check if wallet exists
 */
export function walletExists(): boolean {
  return existsSync(WALLET_FILE);
}

/**
 * Reset in-memory caches (for testing only).
 * @internal
 */
export function _resetWalletCacheForTesting(): void {
  _walletCache = undefined;
  _keyPairCache = null;
  _tonClientCache = null;
}

/**
 * Import a wallet from an existing 24-word mnemonic
 */
export async function importWallet(mnemonic: string[]): Promise<WalletData> {
  const valid = await mnemonicValidate(mnemonic);
  if (!valid) {
    throw new Error("Invalid mnemonic: words do not form a valid TON seed phrase");
  }

  const keyPair = await mnemonicToPrivateKey(mnemonic);

  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const address = wallet.address.toString({ bounceable: true, testOnly: false });

  return {
    version: "w5r1",
    address,
    publicKey: keyPair.publicKey.toString("hex"),
    mnemonic,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get wallet address
 */
export function getWalletAddress(): string | null {
  const wallet = loadWallet();
  return wallet?.address || null;
}

/**
 * Get (or create) a cached TonClient.
 * Re-creates only when the endpoint URL rotates (60s TTL on endpoint).
 */
export async function getCachedTonClient(): Promise<TonClient> {
  const endpoint = await getCachedHttpEndpoint();
  if (_tonClientCache && _tonClientCache.endpoint === endpoint) {
    return _tonClientCache.client;
  }
  const apiKey = getToncenterApiKey();
  const client = new TonClient({ endpoint, ...(apiKey && { apiKey }) });
  _tonClientCache = { client, endpoint };
  return client;
}

/**
 * Invalidate the TonClient cache and the endpoint cache.
 * Call this when a node returns a 5xx error so the next call picks a fresh node.
 */
export function invalidateTonClientCache(): void {
  _tonClientCache = null;
  invalidateEndpointCache();
}

/**
 * Get cached KeyPair (derives from mnemonic once, then reuses).
 * Returns null if no wallet is configured.
 */
export async function getKeyPair(): Promise<{ publicKey: Buffer; secretKey: Buffer } | null> {
  if (_keyPairCache) return _keyPairCache;

  const wallet = loadWallet();
  if (!wallet) return null;

  _keyPairCache = await mnemonicToPrivateKey(wallet.mnemonic);
  return _keyPairCache;
}

/**
 * Get wallet balance from TON Center API
 */
export async function getWalletBalance(address: string): Promise<{
  balance: string;
  balanceNano: string;
} | null> {
  try {
    const client = await getCachedTonClient();

    // Import Address from @ton/core
    const { Address } = await import("@ton/core");
    const addressObj = Address.parse(address);

    // Get balance
    const balance = await client.getBalance(addressObj);
    const balanceFormatted = fromNano(balance);

    return {
      balance: balanceFormatted,
      balanceNano: balance.toString(),
    };
  } catch (error) {
    log.error({ err: error }, "Failed to get balance");
    return null;
  }
}

/** Cached TON price (30s TTL) */
const TON_PRICE_CACHE_TTL_MS = 30_000;
let _tonPriceCache: { usd: number; source: string; timestamp: number } | null = null;

/**
 * Get TON/USD price from TonAPI (primary) with CoinGecko fallback
 * Results cached for 30s to reduce API calls
 */
export async function getTonPrice(): Promise<{
  usd: number;
  source: string;
  timestamp: number;
} | null> {
  // Return cached value if fresh
  if (_tonPriceCache && Date.now() - _tonPriceCache.timestamp < TON_PRICE_CACHE_TTL_MS) {
    return { ..._tonPriceCache };
  }

  // Primary: TonAPI /v2/rates (uses configured API key if available)
  try {
    const response = await tonapiFetch(`/rates?tokens=ton&currencies=usd`);

    if (response.ok) {
      const data = await response.json();
      const price = data?.rates?.TON?.prices?.USD;
      if (typeof price === "number" && price > 0) {
        _tonPriceCache = { usd: price, source: "TonAPI", timestamp: Date.now() };
        return _tonPriceCache;
      }
    }
  } catch {
    // Fall through to CoinGecko
  }

  // Fallback: CoinGecko
  try {
    const response = await fetchWithTimeout(
      `${COINGECKO_API_URL}/simple/price?ids=the-open-network&vs_currencies=usd`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const price = data["the-open-network"]?.usd;
    if (typeof price === "number" && price > 0) {
      _tonPriceCache = { usd: price, source: "CoinGecko", timestamp: Date.now() };
      return _tonPriceCache;
    }
  } catch (error) {
    log.error({ err: error }, "Failed to get TON price");
  }

  return null;
}
