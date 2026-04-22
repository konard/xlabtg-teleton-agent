/**
 * Scrypt-based salted hash for the WebUI auth token.
 *
 * Rationale (AUDIT-H7): storing the raw token in config.yaml means a
 * file-read primitive (backup leak, symlink, misconfigured mode) grants
 * API access. Hashing breaks that chain — compromise of the config no
 * longer grants the token.
 *
 * Format: `scrypt$<salt-hex>$<hash-hex>`
 *   - salt: 16 random bytes
 *   - hash: 64-byte scrypt output with default N=16384, r=8, p=1
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt$";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Hash a token with a random salt. Returns a self-describing string. */
export function hashToken(token: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(token, salt, KEY_BYTES);
  return `${HASH_PREFIX}${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Timing-safe verification of a token against a stored hash. */
export function verifyToken(token: string, stored: string): boolean {
  if (!token || !stored || !stored.startsWith(HASH_PREFIX)) return false;
  const parts = stored.slice(HASH_PREFIX.length).split("$");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const derived = scryptSync(token, salt, KEY_BYTES);
  return timingSafeEqual(derived, expected);
}

/** Quick check for the hash-prefix, without attempting to parse. */
export function isHashedToken(value: string | undefined | null): value is string {
  return typeof value === "string" && value.startsWith(HASH_PREFIX);
}
