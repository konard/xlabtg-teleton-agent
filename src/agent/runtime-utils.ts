import type { Context, TextContent, ToolCall } from "@mariozechner/pi-ai";

export function isContextOverflowError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("prompt is too long") ||
    lower.includes("context length exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("too many tokens") ||
    lower.includes("request_too_large") ||
    (lower.includes("exceeds") && lower.includes("maximum")) ||
    (lower.includes("context") && lower.includes("limit"))
  );
}

/**
 * Parse a Retry-After hint (in seconds) from a provider error string, if present.
 * Mirrors the precedent in flood-retry.ts. Returns milliseconds (capped at 60s), or null.
 */
export function parseRetryAfterMs(errorMessage?: string): number | null {
  if (!errorMessage) return null;
  const match = errorMessage.match(/retry[-\s]?after[:\s]+(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, 60_000);
}

export function isTrivialMessage(text: string): boolean {
  const stripped = text.trim();
  if (!stripped) return true;
  if (!/[a-zA-Z0-9а-яА-ЯёЁ]/.test(stripped)) return true;
  const trivial =
    /^(ok|okay|k|oui|non|yes|no|yep|nope|sure|thanks|merci|thx|ty|lol|haha|cool|nice|wow|bravo|top|parfait|d'accord|alright|fine|got it|np|gg)\.?!?$/i;
  return trivial.test(stripped);
}

/** Compact summary of tool params for the iteration log line. */
export function summarizeToolParams(toolName: string, params: Record<string, unknown>): string {
  const MAX = 60;
  let hint = "";

  if (toolName === "exec_run" && typeof params.command === "string") {
    hint = params.command;
  } else if (toolName === "web_fetch" && typeof params.url === "string") {
    hint = params.url;
  } else if (toolName.startsWith("telegram_") && typeof params.message === "string") {
    hint = params.message;
  } else if (typeof params.query === "string") {
    hint = params.query;
  } else if (typeof params.section === "string") {
    hint = params.section;
  }

  if (!hint) return "";
  if (hint.length > MAX) hint = hint.slice(0, MAX) + "…";
  return `(${hint})`;
}

export function enrichRAGQuery(query: string): string {
  if (!query) return query;
  const tags: string[] = [];
  const lower = query.toLowerCase();

  if (/\.ton\b/i.test(query)) tags.push("TON blockchain domain DNS resolution");
  if (/\b(EQ|UQ)[A-Za-z0-9_-]{46}\b/.test(query)) tags.push("TON wallet address blockchain");
  if (/\bt\.me\/nft\/\S+/i.test(query)) tags.push("Telegram unique gift collectible NFT");
  if (/\b(swap|trade|exchange)\b/i.test(query) && /\b(token|jetton|ton|usdt|usdc)\b/i.test(lower)) {
    tags.push("DEX swap jetton trade");
  }
  if (/\bsticker\b/i.test(query)) tags.push("Telegram sticker pack send");
  if (/\b(invoice|deal|payment|escrow)\b/i.test(query)) tags.push("trade deal invoice");
  if (/\b(gift|collectible)\b/i.test(query) && /\b(buy|send|transfer|resale)\b/i.test(query)) {
    tags.push("Telegram gift NFT collectible");
  }

  return tags.length > 0 ? `${query} ${tags.join(" ")}` : query;
}

export function extractContextSummary(context: Context, maxMessages: number = 10): string {
  const recentMessages = context.messages.slice(-maxMessages);
  const summaryParts: string[] = [];

  summaryParts.push("### Session Summary (Auto-saved before overflow reset)\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex]";
      const bodyMatch = content.match(/\] (.+)/s);
      const body = bodyMatch ? bodyMatch[1] : content;
      summaryParts.push(`- **User**: ${body.substring(0, 150)}${body.length > 150 ? "..." : ""}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextContent => b.type === "text");
      const toolBlocks = msg.content.filter((b): b is ToolCall => b.type === "toolCall");

      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || "";
        summaryParts.push(
          `- **Agent**: ${text.substring(0, 150)}${text.length > 150 ? "..." : ""}`
        );
      }

      if (toolBlocks.length > 0) {
        const toolNames = toolBlocks.map((b) => b.name).join(", ");
        summaryParts.push(`  - *Tools used: ${toolNames}*`);
      }
    } else if (msg.role === "toolResult") {
      const status = msg.isError ? "ERROR" : "OK";
      summaryParts.push(`  - *Tool result: ${msg.toolName} → ${status}*`);
    }
  }

  return summaryParts.join("\n");
}
