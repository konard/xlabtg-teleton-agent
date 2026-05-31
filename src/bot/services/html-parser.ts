/**
 * HTML → MessageEntity parser — re-exported from the shared sdk/formatting layer.
 *
 * The implementation now lives in src/sdk/formatting.ts (pure, reusable) so the
 * SDK layer no longer depends on bot/ for it. This shim preserves the existing
 * bot-layer import paths.
 */

export { parseHtml, stripCustomEmoji } from "../../sdk/formatting.js";
export type { ParsedMessage } from "../../sdk/formatting.js";
