import type { Context, Message, TextContent } from "@mariozechner/pi-ai";
import { appendToTranscript } from "../session/transcript.js";
import { randomUUID } from "crypto";
import { writeSummaryToDailyLog, appendToDailyLog } from "./daily-logs.js";
import { summarizeWithFallback } from "./ai-summarization.js";
import { saveSessionMemory } from "../session/memory-hook.js";

import type { SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import {
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_SOFT_THRESHOLD_TOKENS,
  FALLBACK_SOFT_THRESHOLD_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_SUMMARY_TOKENS,
  MEMORY_FLUSH_RECENT_MESSAGES,
} from "../constants/limits.js";

export interface CompactionConfig {
  enabled: boolean;
  maxMessages?: number; // Trigger compaction after N messages
  maxTokens?: number; // Trigger compaction after N tokens (estimated)
  keepRecentMessages?: number; // Number of recent messages to preserve
  memoryFlushEnabled?: boolean; // Write memory to daily log before compaction
  softThresholdTokens?: number; // Token count to trigger pre-compaction flush
  logCompaction?: boolean; // Write compaction audit entry to daily log
  autoPreserve?: boolean; // Extract critical identifiers before compaction
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxMessages: COMPACTION_MAX_MESSAGES,
  maxTokens: DEFAULT_MAX_TOKENS,
  keepRecentMessages: COMPACTION_KEEP_RECENT,
  memoryFlushEnabled: true,
  softThresholdTokens: DEFAULT_SOFT_THRESHOLD_TOKENS,
  logCompaction: true,
  autoPreserve: true,
};

const log = createLogger("Memory");

function estimateContextTokens(context: Context): number {
  let charCount = 0;

  if (context.systemPrompt) {
    charCount += context.systemPrompt.length;
  }

  for (const message of context.messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        charCount += message.content.length;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text") charCount += block.text.length;
        }
      }
    } else if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") {
          charCount += block.text.length;
        }
      }
    }
  }

  return Math.ceil(charCount / 4);
}

export function shouldFlushMemory(
  context: Context,
  config: CompactionConfig,
  tokenCount?: number
): boolean {
  if (!config.enabled || !config.memoryFlushEnabled) {
    return false;
  }

  const tokens = tokenCount ?? estimateContextTokens(context);
  const softThreshold = config.softThresholdTokens ?? FALLBACK_SOFT_THRESHOLD_TOKENS;

  if (tokens >= softThreshold) {
    log.info(`Memory flush needed: ~${tokens} tokens (soft threshold: ${softThreshold})`);
    return true;
  }

  return false;
}

/**
 * Extract critical identifiers from messages that must survive compaction.
 * Scans for wallet addresses, transaction hashes, URLs, numbers, and similar
 * values that an LLM summariser might paraphrase rather than preserve verbatim.
 */
export function extractCriticalIdentifiers(messages: Message[]): string {
  const found: string[] = [];

  // Patterns for values that must be preserved verbatim
  const patterns: Array<{ label: string; re: RegExp }> = [
    // Blockchain / crypto addresses (TON, ETH, BTC, etc.)
    { label: "TON address", re: /\bEQ[A-Za-z0-9_-]{46}\b/g },
    { label: "ETH address", re: /\b0x[0-9a-fA-F]{40}\b/g },
    // Transaction / hash identifiers
    { label: "tx hash", re: /\b[0-9a-fA-F]{64}\b/g },
    // URLs
    { label: "URL", re: /https?:\/\/[^\s"'<>]+/g },
    // Large numbers (likely amounts / IDs)
    { label: "number", re: /\b\d{6,}\b/g },
    // Telegram usernames
    { label: "username", re: /@[A-Za-z0-9_]{5,}/g },
  ];

  for (const msg of messages) {
    let text = "";
    if (msg.role === "user") {
      text = typeof msg.content === "string" ? msg.content : "";
    } else if (msg.role === "assistant") {
      text = msg.content
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    if (!text) continue;

    for (const { label, re } of patterns) {
      const matches = text.match(re);
      if (matches) {
        for (const m of matches) {
          found.push(`${label}: ${m}`);
        }
      }
    }
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return found
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    })
    .join("\n");
}

/**
 * Write a structured compaction audit entry to the daily log.
 * Captures what was compacted, when, and the resulting summary
 * so there is always an audit trail even after messages are discarded.
 */
function writeCompactionAuditLog(params: {
  sessionId: string;
  chatId?: string;
  messageCount: number;
  keptCount: number;
  summary: string;
  preservedIdentifiers: string;
}): void {
  const lines: string[] = [
    `### Compaction Audit`,
    ``,
    `**Session:** ${params.sessionId}`,
    params.chatId ? `**Chat:** ${params.chatId}` : "",
    `**Compacted:** ${params.messageCount} messages → kept ${params.keptCount} recent`,
    `**Time:** ${new Date().toISOString()}`,
    ``,
    `#### Summary`,
    params.summary,
  ].filter((l) => l !== undefined);

  if (params.preservedIdentifiers) {
    lines.push(``, `#### Preserved Identifiers`, params.preservedIdentifiers);
  }

  appendToDailyLog(lines.join("\n"));
  log.info(`Compaction audit written to daily log`);
}

function flushMemoryToDailyLog(context: Context): void {
  const recentMessages = context.messages.slice(-MEMORY_FLUSH_RECENT_MESSAGES);
  const summary: string[] = [];

  summary.push("**Recent Context:**\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex content]";
      summary.push(`- User: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextContent => b.type === "text");
      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || "";
        summary.push(`- Assistant: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
      }
    }
  }

  writeSummaryToDailyLog(summary.join("\n"));
  log.info(`Memory flushed to daily log`);
}

export function shouldCompact(
  context: Context,
  config: CompactionConfig,
  tokenCount?: number
): boolean {
  if (!config.enabled) {
    return false;
  }

  const messageCount = context.messages.length;

  if (config.maxMessages && messageCount >= config.maxMessages) {
    log.info(`Compaction needed: ${messageCount} messages (max: ${config.maxMessages})`);
    return true;
  }

  if (config.maxTokens) {
    const tokens = tokenCount ?? estimateContextTokens(context);
    if (tokens >= config.maxTokens) {
      log.info(`Compaction needed: ~${tokens} tokens (max: ${config.maxTokens})`);
      return true;
    }
  }

  return false;
}

/**
 * Compact context by AI-summarizing old messages.
 * Preserves recent messages and replaces old ones with a summary.
 */
export async function compactContext(
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  provider?: SupportedProvider,
  utilityModel?: string,
  sessionId?: string,
  chatId?: string
): Promise<Context> {
  const keepCount = config.keepRecentMessages ?? 10;

  if (context.messages.length <= keepCount) {
    return context;
  }

  let cutIndex = context.messages.length - keepCount;
  const collectToolUseIds = (msgs: Message[]): Set<string> => {
    const ids = new Set<string>();
    for (const msg of msgs) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "toolCall") {
            if (block.id) ids.add(block.id);
          }
        }
      }
    }
    return ids;
  };

  const hasOrphanedToolResults = (msgs: Message[]): boolean => {
    const toolUseIds = collectToolUseIds(msgs);
    for (const msg of msgs) {
      if (msg.role === "toolResult") {
        if (msg.toolCallId && !toolUseIds.has(msg.toolCallId)) {
          return true;
        }
      }
    }
    return false;
  };

  let iterations = 0;
  while (cutIndex > 0 && iterations < 50) {
    const keptMessages = context.messages.slice(cutIndex);
    if (!hasOrphanedToolResults(keptMessages)) {
      break;
    }
    cutIndex--;
    iterations++;
  }

  if (hasOrphanedToolResults(context.messages.slice(cutIndex))) {
    log.warn(`Compaction: couldn't find clean cut point, keeping all messages`);
    return context;
  }

  const recentMessages = context.messages.slice(cutIndex);
  const oldMessages = context.messages.slice(0, cutIndex);

  log.info(
    `Compacting ${oldMessages.length} old messages, keeping ${recentMessages.length} recent (cut at clean boundary)`
  );

  // Extract critical identifiers before they are summarised away
  const preservedIdentifiers =
    config.autoPreserve !== false ? extractCriticalIdentifiers(oldMessages) : "";

  if (preservedIdentifiers) {
    log.info(
      `Auto-preserve: extracted ${preservedIdentifiers.split("\n").length} identifiers from compacted messages`
    );
  }

  const preserveNote = preservedIdentifiers
    ? `\n\nIMPORTANT — preserve these verbatim in the summary:\n${preservedIdentifiers}`
    : "";

  try {
    const result = await summarizeWithFallback({
      messages: oldMessages,
      apiKey,
      contextWindow: config.maxTokens ?? DEFAULT_CONTEXT_WINDOW,
      maxSummaryTokens: DEFAULT_MAX_SUMMARY_TOKENS,
      customInstructions: `Output a structured summary using EXACTLY these sections:

## User Intent
What the user is trying to accomplish (1-2 sentences).

## Key Decisions
Bullet list of decisions made and commitments agreed upon.

## Important Context
Critical facts, preferences, constraints, or technical details needed for continuity.

## Actions Taken
What was done: tools used, messages sent, transactions made (with specific values/addresses if relevant).

## Open Items
Unfinished tasks, pending questions, or next steps.

Keep each section concise. Omit a section if empty. Preserve specific names, numbers, and identifiers.${preserveNote}`,
      provider,
      utilityModel,
    });

    log.info(`AI Summary: ${result.tokensUsed} tokens, ${result.chunksProcessed} chunks processed`);

    // Write compaction audit to daily log before discarding old messages
    if (config.logCompaction !== false) {
      writeCompactionAuditLog({
        sessionId: sessionId ?? "unknown",
        chatId,
        messageCount: oldMessages.length,
        keptCount: recentMessages.length,
        summary: result.summary,
        preservedIdentifiers,
      });
    }

    const summaryText = `[Auto-compacted ${oldMessages.length} messages]\n\n${result.summary}`;

    const summaryMessage: Message = {
      role: "user",
      content: summaryText,
      timestamp: oldMessages[0]?.timestamp ?? Date.now(),
    };

    return {
      ...context,
      messages: [summaryMessage, ...recentMessages],
    };
  } catch (error) {
    log.error({ err: error }, "AI summarization failed, using fallback");

    const summaryText = `[Auto-compacted: ${oldMessages.length} earlier messages from this conversation]`;

    // Still write audit log even on failure so there is a record
    if (config.logCompaction !== false) {
      writeCompactionAuditLog({
        sessionId: sessionId ?? "unknown",
        chatId,
        messageCount: oldMessages.length,
        keptCount: recentMessages.length,
        summary: `[AI summarization failed — ${oldMessages.length} messages discarded without summary]`,
        preservedIdentifiers,
      });
    }

    const summaryMessage: Message = {
      role: "user",
      content: summaryText,
      timestamp: oldMessages[0]?.timestamp ?? Date.now(),
    };

    return {
      ...context,
      messages: [summaryMessage, ...recentMessages],
    };
  }
}

export async function compactAndSaveTranscript(
  sessionId: string,
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  chatId?: string,
  provider?: SupportedProvider,
  utilityModel?: string
): Promise<string> {
  const newSessionId = randomUUID();

  log.info(`Creating compacted transcript: ${sessionId} → ${newSessionId}`);

  if (chatId) {
    await saveSessionMemory({
      oldSessionId: sessionId,
      newSessionId,
      context,
      chatId,
      apiKey,
      provider,
      utilityModel,
    });
  }

  const compactedContext = await compactContext(
    context,
    config,
    apiKey,
    provider,
    utilityModel,
    sessionId,
    chatId
  );

  for (const message of compactedContext.messages) {
    appendToTranscript(newSessionId, message);
  }

  return newSessionId;
}

export class CompactionManager {
  private config: CompactionConfig;

  constructor(config: CompactionConfig = DEFAULT_COMPACTION_CONFIG) {
    this.config = config;
  }

  async checkAndCompact(
    sessionId: string,
    context: Context,
    apiKey: string,
    chatId?: string,
    provider?: SupportedProvider,
    utilityModel?: string
  ): Promise<string | null> {
    const tokenCount = estimateContextTokens(context);

    if (shouldFlushMemory(context, this.config, tokenCount)) {
      flushMemoryToDailyLog(context);
    }

    if (!shouldCompact(context, this.config, tokenCount)) {
      return null;
    }

    if (this.config.memoryFlushEnabled) {
      flushMemoryToDailyLog(context);
    }

    log.info(`Auto-compacting session ${sessionId}`);
    const newSessionId = await compactAndSaveTranscript(
      sessionId,
      context,
      this.config,
      apiKey,
      chatId,
      provider,
      utilityModel
    );
    log.info(`Compaction complete: ${newSessionId}`);

    return newSessionId;
  }

  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }
}
