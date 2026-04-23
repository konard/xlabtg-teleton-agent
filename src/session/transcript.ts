import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import type { Message, AssistantMessage } from "@mariozechner/pi-ai";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";
import { WeightedLRUCache } from "../utils/weighted-lru-cache.js";

const log = createLogger("Session");

const SESSIONS_DIR = join(TELETON_ROOT, "sessions");

/** Maximum messages kept per live transcript before auto-archive is triggered. */
export const MAX_TRANSCRIPT_MESSAGES = 5_000;

// ── In-memory transcript cache (LRU, capped by session count) ──────────────
// Avoids re-reading + re-parsing JSONL from disk on every message.
// Evicts least-recently-used sessions so multi-chat deployments don't OOM.
// Invalidated on delete/archive; updated on append.
const transcriptCache = new WeightedLRUCache<string, (Message | AssistantMessage)[]>({
  adaptiveSize: { low: 20, normal: 50, high: 100 },
  ttlMs: 2 * 60 * 60 * 1000, // 2 h TTL per session
  frequencyWeightMs: 60_000, // bias eviction away from frequently-accessed sessions
});

export function getTranscriptPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function appendToTranscript(sessionId: string, message: Message | AssistantMessage): void {
  ensureSessionsDir();

  const transcriptPath = getTranscriptPath(sessionId);
  const line = JSON.stringify(message) + "\n";

  try {
    appendFileSync(transcriptPath, line, { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    log.error({ err: error }, `Failed to append to transcript ${sessionId}`);
  }

  // Update in-memory cache (append without re-reading disk)
  const cached = transcriptCache.get(sessionId);
  if (cached) {
    cached.push(message);

    // Auto-archive when the in-memory cap is exceeded
    if (cached.length > MAX_TRANSCRIPT_MESSAGES) {
      log.info(
        `Transcript ${sessionId} exceeded ${MAX_TRANSCRIPT_MESSAGES} messages – auto-archiving`
      );
      archiveTranscript(sessionId);
    }
  }
}

function extractToolCallIds(msg: Message | AssistantMessage): Set<string> {
  const ids = new Set<string>();
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "toolCall") {
        if (block.id) ids.add(block.id);
      }
    }
  }
  return ids;
}

/**
 * Sanitize messages to remove orphaned or out-of-order toolResults.
 * Anthropic API requires tool_results IMMEDIATELY follow their corresponding tool_use.
 * Removes: 1) tool_results referencing non-existent tool_uses, 2) out-of-order tool_results.
 */
function sanitizeMessages(
  messages: (Message | AssistantMessage)[]
): (Message | AssistantMessage)[] {
  const sanitized: (Message | AssistantMessage)[] = [];
  let pendingToolCallIds = new Set<string>(); // IDs waiting for their results
  let removedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant") {
      const newToolIds = extractToolCallIds(msg);

      if (pendingToolCallIds.size > 0 && newToolIds.size > 0) {
        log.warn(`Found ${pendingToolCallIds.size} pending tool results that were never received`);
      }

      pendingToolCallIds = newToolIds;
      sanitized.push(msg);
    } else if (msg.role === "toolResult") {
      const toolCallId = msg.toolCallId;

      if (!toolCallId || typeof toolCallId !== "string") {
        removedCount++;
        log.warn(`Removing toolResult with missing/invalid toolCallId`);
        continue;
      }

      if (pendingToolCallIds.has(toolCallId)) {
        pendingToolCallIds.delete(toolCallId);
        sanitized.push(msg);
      } else {
        removedCount++;
        log.warn(`Removing orphaned toolResult: ${toolCallId.slice(0, 20)}...`);
        continue;
      }
    } else if (msg.role === "user") {
      if (pendingToolCallIds.size > 0) {
        log.warn(
          `User message arrived while ${pendingToolCallIds.size} tool results pending - marking them as orphaned`
        );
        pendingToolCallIds.clear();
      }
      sanitized.push(msg);
    } else {
      sanitized.push(msg);
    }
  }

  if (removedCount > 0) {
    log.info(`Sanitized ${removedCount} orphaned/out-of-order toolResult(s) from transcript`);
  }

  return sanitized;
}

export function readTranscript(sessionId: string): (Message | AssistantMessage)[] {
  // Return shallow copy of cached array (callers may mutate via push)
  const cached = transcriptCache.get(sessionId);
  if (cached) return [...cached];

  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return [];
  }

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());

    // Cap the number of lines parsed to avoid unbounded memory growth.
    // For oversized files, only the most-recent MAX_TRANSCRIPT_MESSAGES are returned.
    const oversized = allLines.length > MAX_TRANSCRIPT_MESSAGES;
    const lines = oversized ? allLines.slice(-MAX_TRANSCRIPT_MESSAGES) : allLines;

    if (oversized) {
      log.info(
        `Transcript ${sessionId} has ${allLines.length} lines on disk; serving last ${MAX_TRANSCRIPT_MESSAGES}`
      );
    }

    let corruptCount = 0;
    const messages = lines
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          corruptCount++;
          log.warn(`Skipping corrupt line ${i + 1} in transcript ${sessionId}`);
          return null;
        }
      })
      .filter(Boolean);

    if (corruptCount > 0) {
      log.warn(`${corruptCount} corrupt line(s) skipped in transcript ${sessionId}`);
    }

    const sanitized = sanitizeMessages(messages);
    transcriptCache.set(sessionId, sanitized);
    return [...sanitized];
  } catch (error) {
    log.error({ err: error }, `Failed to read transcript ${sessionId}`);
    return [];
  }
}

export function transcriptExists(sessionId: string): boolean {
  return existsSync(getTranscriptPath(sessionId));
}

export function getTranscriptSize(sessionId: string): number {
  try {
    const messages = readTranscript(sessionId);
    return messages.length;
  } catch {
    return 0;
  }
}

export function deleteTranscript(sessionId: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return false;
  }

  try {
    unlinkSync(transcriptPath);
    transcriptCache.delete(sessionId);
    log.info(`Deleted transcript: ${sessionId}`);
    return true;
  } catch (error) {
    log.error({ err: error }, `Failed to delete transcript ${sessionId}`);
    return false;
  }
}

/**
 * Archive a transcript (rename with timestamped .archived suffix).
 */
export function archiveTranscript(sessionId: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId);
  const timestamp = Date.now();
  const archivePath = `${transcriptPath}.${timestamp}.archived`;

  if (!existsSync(transcriptPath)) {
    return false;
  }

  try {
    renameSync(transcriptPath, archivePath);
    transcriptCache.delete(sessionId);
    log.info(`Archived transcript: ${sessionId} → ${timestamp}.archived`);
    return true;
  } catch (error) {
    log.error({ err: error }, `Failed to archive transcript ${sessionId}`);
    return false;
  }
}

/**
 * Delete transcript and archived files older than maxAgeDays.
 */
export function cleanupOldTranscripts(maxAgeDays: number = 30): number {
  if (!existsSync(SESSIONS_DIR)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  try {
    for (const file of readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith(".jsonl") && !file.endsWith(".archived")) continue;
      const filePath = join(SESSIONS_DIR, file);
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (mtime < cutoff) {
          unlinkSync(filePath);
          deleted++;
        }
      } catch {}
    }
  } catch (error) {
    log.error({ err: error }, "Failed to cleanup old transcripts");
  }

  if (deleted > 0) {
    log.info(`Cleaned up ${deleted} transcript(s) older than ${maxAgeDays} days`);
  }

  return deleted;
}
