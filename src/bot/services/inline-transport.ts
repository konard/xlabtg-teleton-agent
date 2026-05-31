/**
 * Inline-message MTProto transport helpers.
 *
 * Low-level GramJS edit primitive shared by every "edit inline GramJS → fallback
 * Grammy" site (DealBot, inline-router plugin callbacks, bot SDK). Each caller keeps
 * its own divergent Grammy fallback; this only encapsulates the identical GramJS trunk
 * (parseHtml → toTLMarkup → editInlineMessageByStringId + swallow MESSAGE_NOT_MODIFIED).
 */

import type { GramJSBotClient } from "../gramjs-bot.js";
import { toTLMarkup, hasStyledButtons, parseHtml, type StyledButtonDef } from "../../sdk/formatting.js";
import { getGramJSErrorMessage } from "../../utils/errors.js";

/**
 * Edit an inline message via GramJS MTProto (styled buttons, custom emoji).
 *
 * Encapsulates the GramJS trunk common to all inline-edit sites:
 * parseHtml → toTLMarkup → editInlineMessageByStringId.
 *
 * @returns `true` if the edit succeeded (or was a no-op because the content was
 *   unchanged — MESSAGE_NOT_MODIFIED is swallowed). Throws on any other GramJS
 *   error so callers can run their own Grammy fallback.
 */
export async function editInlineViaGramJS(params: {
  gramjsBot: GramJSBotClient;
  inlineMessageId: string;
  html: string;
  buttons?: StyledButtonDef[][];
}): Promise<boolean> {
  const { gramjsBot, inlineMessageId, html, buttons } = params;

  try {
    const { text: plainText, entities } = parseHtml(html);
    const markup = buttons && hasStyledButtons(buttons) ? toTLMarkup(buttons) : undefined;

    await gramjsBot.editInlineMessageByStringId({
      inlineMessageId,
      text: plainText,
      entities: entities.length > 0 ? entities : undefined,
      replyMarkup: markup,
    });
    return true;
  } catch (error: unknown) {
    if (getGramJSErrorMessage(error) === "MESSAGE_NOT_MODIFIED") return true;
    throw error;
  }
}
