import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

const OFFSET_FILE = join(TELETON_ROOT, "telegram-offset.json");

interface OffsetState {
  version: number;
  /** Per-chat message offsets */
  perChat: Record<string, number>;
  accountId?: string;
}

const STORE_VERSION = 2;

// In-memory cache for fast access
let offsetCache: OffsetState | null = null;

/**
 * Deferred flush: batches disk writes so that bursts of messages in the same
 * second result in a single fsync instead of one per message.  The in-memory
 * state is always authoritative; the disk is purely a durability store.
 */
const FLUSH_DEBOUNCE_MS = 500;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDiskFlush(state: OffsetState): void {
  if (flushTimer !== null) return; // already scheduled
  flushTimer = setTimeout(() => {
    flushTimer = null;
    saveStateToDisk(state);
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Load offset state from disk (or cache)
 */
function loadState(): OffsetState {
  if (offsetCache) return offsetCache;

  try {
    if (!existsSync(OFFSET_FILE)) {
      offsetCache = { version: STORE_VERSION, perChat: {} };
      return offsetCache;
    }

    const raw = readFileSync(OFFSET_FILE, "utf-8");
    const state = JSON.parse(raw);

    // Migrate from v1 (global offset) to v2 (per-chat)
    if (state.version === 1 || !state.perChat) {
      offsetCache = { version: STORE_VERSION, perChat: {} };
      return offsetCache;
    }

    offsetCache = state as OffsetState;
    return offsetCache;
  } catch (error) {
    log.warn({ err: error }, "Failed to read offset store");
    offsetCache = { version: STORE_VERSION, perChat: {} };
    return offsetCache;
  }
}

/**
 * Flush in-memory state to disk immediately (atomic rename).
 * Called by the debounce timer and by flushOffsets() for graceful shutdown.
 */
function saveStateToDisk(state: OffsetState): void {
  try {
    const dir = dirname(OFFSET_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename (POSIX atomic)
    const tmpFile = OFFSET_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpFile, OFFSET_FILE);
  } catch (error) {
    log.error({ err: error }, "Failed to write offset store");
  }
}

/**
 * Read the last processed message ID for a specific chat
 */
export function readOffset(chatId?: string): number | null {
  const state = loadState();
  if (!chatId) return null;
  return state.perChat[chatId] ?? null;
}

/**
 * Write the last processed message ID for a specific chat.
 * Updates the in-memory state immediately for correctness, then schedules a
 * debounced disk flush to avoid a synchronous file write per message.
 */
export function writeOffset(messageId: number, chatId?: string): void {
  if (!chatId) return;

  const state = loadState();
  const currentOffset = state.perChat[chatId] ?? 0;

  // Only update if new message ID is higher
  if (messageId > currentOffset) {
    state.perChat[chatId] = messageId;
    offsetCache = state;
    scheduleDiskFlush(state);
  }
}

/**
 * Flush any pending offset writes to disk immediately.
 * Should be called during graceful shutdown to avoid losing the last offset.
 */
export function flushOffsets(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (offsetCache) {
    saveStateToDisk(offsetCache);
  }
}

/**
 * Get all chat offsets (for debugging)
 */
export function getAllOffsets(): Record<string, number> {
  return loadState().perChat;
}
