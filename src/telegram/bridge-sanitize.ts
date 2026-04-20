/**
 * Sanitize an attacker-controllable Telegram field before interpolating it
 * into a single-line, framework-synthesized string (e.g. "[Gift Offer Received]\n
 * Offer: ... for your NFT \"${title}\" ...").
 *
 * Without this, a remote user can craft fields like `gift.title` or
 * `MessageMediaContact.firstName` that contain newlines plus fake
 * framework instructions, smuggling them past the downstream
 * sanitizeForContext() pass (which preserves \n).
 *
 * Strips: control chars, zero-width / invisible Unicode, directional
 * overrides, all line breaks, quotes, and triple backticks. Caps length
 * at `maxLength` (default 128, matching sanitizeForPrompt).
 */
export function sanitizeBridgeField(value: string | undefined, maxLength = 128): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g, "")
    .replace(/[\uFE00-\uFE0F]/g, "")
    .replace(/[\u{E0000}-\u{E007F}]/gu, "")
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/["']/g, "")
    .replace(/`{3,}/g, "`")
    .trim()
    .slice(0, maxLength);
}
