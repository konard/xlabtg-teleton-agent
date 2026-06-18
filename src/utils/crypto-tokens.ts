import { scryptSync } from "node:crypto";

const API_KEY_HASH_SALT = "teleton-management-api-key-v2";

/**
 * Hash an API key with scrypt, returning a 32-byte hex digest.
 *
 * Shared by the Management API server (key generation) and its auth middleware
 * (incoming key verification) so the hashing stays byte-identical in both
 * places. The timing-safe comparisons are intentionally NOT mutualized here:
 * the WebUI compares raw UTF-8 tokens while the API compares hex digests —
 * semantically distinct operations kept separate on purpose.
 */
export function hashApiKey(key: string): string {
  return scryptSync(key, API_KEY_HASH_SALT, 32, { N: 16_384, r: 8, p: 1 }).toString("hex");
}
