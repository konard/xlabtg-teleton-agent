/**
 * Styled keyboard helpers — re-exported from the shared sdk/formatting layer.
 *
 * The implementations now live in src/sdk/formatting.ts (pure, reusable) so the
 * SDK layer no longer depends on bot/ for them. This shim preserves the existing
 * bot-layer import paths.
 */

export {
  toTLMarkup,
  toGrammyKeyboard,
  hasStyledButtons,
  prefixButtons,
} from "../../sdk/formatting.js";
export type { ButtonStyle, StyledButtonDef, DealMessage } from "../../sdk/formatting.js";
