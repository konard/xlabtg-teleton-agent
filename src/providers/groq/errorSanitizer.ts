/**
 * Groq Error Body Sanitizer
 *
 * Shared helper for sanitizing upstream Groq error response bodies before
 * surfacing them through API responses. Truncates long bodies and strips
 * secret-looking tokens to avoid information disclosure (raw, untruncated
 * upstream detail / request echoes / internal identifiers).
 */

/** Matches secret-looking tokens (API keys, Bearer tokens) in error bodies. */
const SECRET_PATTERN = /(sk-|gsk_|Bearer )\S+/g;

/** Maximum length of an upstream error body before truncation. */
export const MAX_ERROR_BODY_LENGTH = 200;

/**
 * Truncate an upstream error body and redact secret-looking tokens.
 *
 * @param body - Raw upstream error response body
 * @returns Sanitized, length-bounded string safe to surface to clients
 */
export function sanitizeErrorBody(body: string): string {
  const truncated =
    body.length > MAX_ERROR_BODY_LENGTH ? body.slice(0, MAX_ERROR_BODY_LENGTH) + "…" : body;
  return truncated.replace(SECRET_PATTERN, "[REDACTED]");
}
