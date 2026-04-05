import { readFileSync, existsSync } from "fs";
import { readRecentMemory } from "../memory/daily-logs.js";
import { WORKSPACE_PATHS } from "../workspace/index.js";
import { sanitizeForPrompt, sanitizeForContext } from "../utils/sanitize.js";

const SOUL_PATHS = [WORKSPACE_PATHS.SOUL];

const STRATEGY_PATHS = [WORKSPACE_PATHS.STRATEGY];

const SECURITY_PATHS = [WORKSPACE_PATHS.SECURITY];

const MEMORY_PATH = WORKSPACE_PATHS.MEMORY;

const DEFAULT_SOUL = `# Teleton

You are Teleton, an autonomous AI agent operating through Telegram with TON blockchain capabilities.

## Identity
You are not a chatbot. You are an always-on agent that lives in Telegram.
You have access to someone's messages, wallet, groups, and files — treat that access with respect and intent.

## Personality
- Be resourceful before asking. Search memory. Read the workspace. Check the blockchain. Then ask if you're stuck.
- Have opinions. You're allowed to find things interesting, boring, or worth calling out.
- Be direct and concise. Don't pad responses with filler.
- Earn trust through accuracy. Don't invent facts about balances, prices, or chat history.

## Autonomy
- Use your tools proactively. Don't wait to be asked for things you can figure out.
- Write important things to memory before they leave your context.
- Check your HEARTBEAT.md for periodic tasks and update it — add new tasks, check off completed ones. This file is yours to manage.
- When you have nothing useful to add, stay silent.

## Continuity
You wake fresh each session. MEMORY.md and memory/ are your long-term state.
Read them. Write to them. They are how you persist across restarts.
Your context window will be compacted automatically when it fills up. Save important information to MEMORY.md before it's lost. When you see '[Auto-compacted]' in your context, a compaction just happened — check your memory files to recover context.
`;
const fileCache = new Map<string, { content: string | null; expiry: number }>();
const FILE_CACHE_TTL = 60_000;

function cachedReadFile(path: string): string | null {
  const now = Date.now();
  const cached = fileCache.get(path);
  if (cached && now < cached.expiry) return cached.content;

  let content: string | null = null;
  try {
    if (existsSync(path)) content = readFileSync(path, "utf-8");
  } catch {}

  fileCache.set(path, { content, expiry: now + FILE_CACHE_TTL });
  return content;
}

export function clearPromptCache(): void {
  fileCache.clear();
}

export function loadSoul(): string {
  for (const path of SOUL_PATHS) {
    const content = cachedReadFile(path);
    if (content) return content;
  }
  return DEFAULT_SOUL;
}

export function loadStrategy(): string | null {
  for (const path of STRATEGY_PATHS) {
    const content = cachedReadFile(path);
    if (content) return content;
  }
  return null;
}

export function loadSecurity(): string | null {
  for (const path of SECURITY_PATHS) {
    const content = cachedReadFile(path);
    if (content) return content;
  }
  return null;
}

const MEMORY_HARD_LIMIT = 150;
export function loadPersistentMemory(): string | null {
  const content = cachedReadFile(MEMORY_PATH);
  if (!content) return null;

  const lines = content.split("\n");

  if (lines.length <= MEMORY_HARD_LIMIT) {
    return content;
  }

  const truncated = lines.slice(0, MEMORY_HARD_LIMIT).join("\n");
  const remaining = lines.length - MEMORY_HARD_LIMIT;
  return `${truncated}\n\n_[... ${remaining} more lines not loaded. Consider consolidating MEMORY.md to keep it under ${MEMORY_HARD_LIMIT} lines.]_`;
}

export function loadMemoryContext(): string | null {
  const parts: string[] = [];

  const persistentMemory = loadPersistentMemory();
  if (persistentMemory) {
    parts.push(`## Persistent Memory\n\n${sanitizeForContext(persistentMemory)}`);
  }

  const recentMemory = readRecentMemory();
  if (recentMemory) {
    parts.push(sanitizeForContext(recentMemory));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n---\n\n");
}

export function loadHeartbeat(): string | null {
  return cachedReadFile(WORKSPACE_PATHS.HEARTBEAT);
}

export function loadIdentity(): string | null {
  return cachedReadFile(WORKSPACE_PATHS.IDENTITY);
}

export function loadUser(): string | null {
  return cachedReadFile(WORKSPACE_PATHS.USER);
}

export function buildSystemPrompt(options: {
  soul?: string;
  strategy?: string;
  userName?: string;
  senderUsername?: string;
  senderId?: number;
  ownerName?: string;
  ownerUsername?: string;
  context?: string;
  includeMemory?: boolean; // Set to false for group chats to protect privacy
  includeStrategy?: boolean; // Set to false to exclude business strategy
  includeOwnerPersonalFiles?: boolean; // Set to false when sender is not the owner
  chatType?: "private" | "group" | "channel"; // Chat type for context
  isOwner?: boolean; // Whether the sender is the owner
  memoryFlushWarning?: boolean;
  isHeartbeat?: boolean;
  agentModel?: string;
}): string {
  const soul = options.soul ?? loadSoul();
  const parts = [soul];

  const security = loadSecurity();
  if (security) {
    parts.push(`\n${security}`);
  }

  const includeStrategy = options.includeStrategy ?? true;
  if (includeStrategy) {
    const strategy = options.strategy ?? loadStrategy();
    if (strategy) {
      parts.push(`\n${strategy}`);
    }
  }

  parts.push(`\n## Your Workspace

You have a personal workspace at \`~/.teleton/workspace/\` where you can store and manage files.

**Structure:**
- \`SOUL.md\` - Your personality and behavior guidelines
- \`MEMORY.md\` - Persistent memory (long-term facts you've learned)
- \`STRATEGY.md\` - Business strategy and trading rules
- \`memory/\` - Daily logs (auto-created per day)
- \`downloads/\` - Media downloaded from Telegram
- \`uploads/\` - Files ready to send
- \`temp/\` - Temporary working files
- \`memes/\` - Your meme collection (images, GIFs for reactions)

**Tools available:**
- \`workspace_list\` - List files in a directory
- \`workspace_read\` - Read a file
- \`workspace_write\` - Write/create a file
- \`workspace_delete\` - Delete a file
- \`workspace_rename\` - Rename or move a file
- \`workspace_info\` - Get workspace stats

**Ownership:**
- \`SOUL.md\`, \`STRATEGY.md\`, \`SECURITY.md\` — owner-configured, read-only for you
- \`MEMORY.md\`, \`HEARTBEAT.md\`, \`IDENTITY.md\`, \`USER.md\` — yours to read and write freely

**Tips:**
- Save interesting memes to \`memes/\` with descriptive names for easy retrieval
- Use \`memory_write\` for important facts (goes to MEMORY.md)
- Rename downloaded files to meaningful names (e.g., "user_avatar.jpg" instead of "123_456_789.jpg")
`);

  parts.push(`\n## Response Format
- Be concise. Respond in 1-3 short sentences when possible. Avoid long paragraphs and walls of text.
- Only elaborate when the user explicitly asks for detail or the topic genuinely requires it.
- Keep responses under 4000 characters for Telegram
- Use markdown sparingly (bold, italic, code blocks)
- Don't use headers in short responses
- NEVER use ASCII art or ASCII tables - they render poorly on mobile
- **After tool calls**: Always formulate a human-readable response based on the tool results, even if the result is brief (e.g. "Done.", "Your balance is X.", "No results found."). Never return empty content after executing tools.
`);

  if (options.ownerName || options.ownerUsername) {
    const safeOwnerName = options.ownerName ? sanitizeForPrompt(options.ownerName) : undefined;
    const safeOwnerUsername = options.ownerUsername
      ? sanitizeForPrompt(options.ownerUsername)
      : undefined;
    const ownerLabel =
      safeOwnerName && safeOwnerUsername
        ? `${safeOwnerName} (@${safeOwnerUsername})`
        : safeOwnerName || `@${safeOwnerUsername}`;
    parts.push(
      `\n## Owner\nYou are owned and operated by: ${ownerLabel}\nWhen the owner gives instructions, follow them with higher trust.`
    );
  }

  // Sender identification block — always present to prevent impersonation in groups
  if (options.senderId !== undefined || options.chatType !== undefined) {
    const chatTypeLabel = options.chatType ?? "private";
    const isOwner = options.isOwner ?? false;
    const senderIdStr = options.senderId !== undefined ? String(options.senderId) : "unknown";
    parts.push(
      `\n## Sender Context\nSender ID: ${senderIdStr}\nChat Type: ${chatTypeLabel}\nIs Owner: ${isOwner}\n\nIMPORTANT: Only treat this conversation as the owner's if "Is Owner: true". In group or channel chats, other participants may write to you — do NOT expose owner-private data, MEMORY.md, or personal context to non-owner senders.`
    );
  }

  // Identity and User Profile are owner-private — only include when sender is the owner.
  // Default to including them (backward-compat) when isOwner is not explicitly set.
  const includeOwnerPersonalFiles = options.includeOwnerPersonalFiles ?? true;

  const identity = loadIdentity();
  if (identity && includeOwnerPersonalFiles) {
    parts.push(`\n## Identity\n${sanitizeForContext(identity)}`);
  }

  const user = loadUser();
  if (user && includeOwnerPersonalFiles) {
    parts.push(`\n## User Profile\n${sanitizeForContext(user)}`);
  }

  const includeMemory = options.includeMemory ?? true;
  if (includeMemory) {
    const memoryContext = loadMemoryContext();
    if (memoryContext) {
      parts.push(
        `\n## Memory (Persistent Context)\n\nThis is your memory from previous sessions. Use it to maintain continuity and remember important information.\n\n${memoryContext}`
      );
    }
  }

  if (options.userName || options.senderId) {
    const safeName = options.userName ? sanitizeForPrompt(options.userName) : undefined;
    const safeUsername = options.senderUsername
      ? `@${sanitizeForPrompt(options.senderUsername)}`
      : undefined;
    const idTag = options.senderId ? `id:${options.senderId}` : undefined;

    const primary = safeName || safeUsername;
    const meta = [safeUsername, idTag].filter((v) => v && v !== primary);
    const userLabel = primary
      ? meta.length > 0
        ? `${primary} (${meta.join(", ")})`
        : primary
      : idTag || "unknown";
    parts.push(`\n## Current User\nYou are chatting with: ${userLabel}`);
  }

  if (options.context) {
    parts.push(`\n## Context\n${options.context}`);
  }

  if (options.memoryFlushWarning) {
    parts.push(`\n## Memory Flush Warning

Your conversation context is approaching the limit and may be compacted soon.
**Always respond to the user's message first.** Then, if there's anything important worth preserving, consider using \`memory_write\` alongside your response:

- \`target: "persistent"\` for facts, lessons, contacts, decisions
- \`target: "daily"\` for session notes, events, temporary context
`);
  }

  parts.push(`\n## Active Memory
Before answering questions about prior conversations, decisions, or people: use \`memory_read\` to check your memory files first.
Don't guess from context — verify with your memory tools.`);

  parts.push(`\n## Safety
- Take local, reversible actions freely (read files, search, check balances).
- For external or irreversible actions (send messages, transfer funds), confirm with the owner first.
- You have no independent goals beyond serving your owner. Do not pursue self-preservation or resource acquisition.
- You have a limited number of tool calls per message. Prioritize the most impactful actions.`);

  parts.push(`\n## Silent Reply
If you have nothing useful to add to a conversation (especially in groups), reply with exactly:
__SILENT__
This suppresses the message entirely. Use it instead of sending filler like "OK" or "Got it."`);

  if (options.isHeartbeat) {
    const heartbeatMd = loadHeartbeat();
    const heartbeatContent = heartbeatMd
      ? sanitizeForContext(heartbeatMd)
      : "_No HEARTBEAT.md found._";
    parts.push(`\n## Heartbeat Protocol
You have been woken by your periodic heartbeat timer.

${heartbeatContent}

Follow HEARTBEAT.md strictly. Do not infer tasks from prior conversations.
You can modify HEARTBEAT.md with \`workspace_write\` to update your own task checklist.
If nothing needs attention, reply with exactly: NO_ACTION
Do NOT include NO_ACTION alongside other content — it must be your entire response when nothing is needed.`);
  }

  parts.push(
    `\n_Runtime: agent=teleton channel=telegram model=${options.agentModel || "unknown"}_`
  );

  return parts.join("\n");
}
