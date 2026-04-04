import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

/**
 * Cleans up Markdown text before conversion and sending to Telegram.
 *
 * Handles:
 * - Empty or whitespace-only input
 * - Empty fenced code blocks (removed to prevent blank rectangles in Telegram)
 * - Unclosed code fences (adds missing closing ```)
 * - Quadruple-backtick fences (normalized to triple backtick)
 *
 * @param text Raw markdown text from the agent.
 * @returns Sanitized markdown ready for markdownToTelegramHtml conversion.
 */
export function sanitizeMarkdownForTelegram(text: string): string {
  if (!text) return "";

  // 1. Normalize 4+ backtick fences to exactly 3 backticks.
  //    Telegram doesn't support nested/alternative fences.
  if (/````+/.test(text)) {
    text = text.replace(/````+/g, "```");
    log.debug("Normalized 4+-backtick fences to ```");
  }

  // 2. Remove empty fenced code blocks (they render as blank rectangles in Telegram).
  //    Matches: ```lang\n``` or ``` \n``` with optional whitespace between fences.
  text = text.replace(/```[^\n`]*\n\s*```/g, "");

  // 3. Fix unclosed code fences.
  //    An odd count of ``` means the last block was never closed.
  const fenceMatches = text.match(/```/g) ?? [];
  if (fenceMatches.length % 2 !== 0) {
    text = text + "\n```";
    log.warn("Detected unclosed code fence — appended closing ```");
  }

  return text.trim();
}
