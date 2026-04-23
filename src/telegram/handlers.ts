import type { TelegramConfig, Config } from "../config/schema.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { TelegramBridge } from "./bridge.js";
import { type TelegramMessage } from "./bridge.js";
import { MessageStore, ChatStore, UserStore } from "../memory/feed/index.js";
import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import { readOffset, writeOffset } from "./offset-store.js";
import { validateDM, validateGroup, type PolicyDecision } from "./policy-validator.js";
import { PendingHistory } from "../memory/pending-history.js";
import type { SemanticMemoryContext, ToolContext } from "../agent/tools/types.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { isSilentReply } from "../constants/tokens.js";
import { telegramTranscribeAudioExecutor } from "../agent/tools/telegram/media/transcribe-audio.js";
import { TYPING_REFRESH_MS } from "../constants/timeouts.js";
import { createLogger } from "../utils/logger.js";
import { groqTranscribe } from "../providers/groq/GroqSTTProvider.js";
import { generateSpeech } from "../services/tts.js";
import { unlinkSync } from "fs";
import { splitMessageForTelegram } from "./message-splitter.js";
import { sanitizeMarkdownForTelegram } from "./sanitize-markdown.js";
import { MessageDedupCache } from "./message-dedup-cache.js";
import {
  RATE_LIMITER_GROUP_CLEANUP_THRESHOLD,
  LOG_MESSAGE_PREVIEW_CHARS,
} from "../constants/limits.js";

const log = createLogger("Telegram");
import type { PluginMessageEvent } from "@teleton-agent/sdk";

export interface MessageContext {
  message: TelegramMessage;
  isAdmin: boolean;
  shouldRespond: boolean;
  reason?: string;
}

class RateLimiter {
  private messageTimestamps: number[] = [];
  private groupTimestamps: Map<string, number[]> = new Map();

  constructor(
    private messagesPerSecond: number,
    private groupsPerMinute: number
  ) {}

  canSendMessage(): boolean {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    this.messageTimestamps = this.messageTimestamps.filter((t) => t > oneSecondAgo);

    if (this.messageTimestamps.length >= this.messagesPerSecond) {
      return false;
    }

    this.messageTimestamps.push(now);
    return true;
  }

  canSendToGroup(groupId: string): boolean {
    const now = Date.now();
    const oneMinuteMs = 60_000;
    const oneMinuteAgo = now - oneMinuteMs;

    let timestamps = this.groupTimestamps.get(groupId) || [];
    timestamps = timestamps.filter((t) => t > oneMinuteAgo);

    if (timestamps.length >= this.groupsPerMinute) {
      this.groupTimestamps.set(groupId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.groupTimestamps.set(groupId, timestamps);

    if (this.groupTimestamps.size > RATE_LIMITER_GROUP_CLEANUP_THRESHOLD) {
      for (const [id, ts] of this.groupTimestamps) {
        if (ts.length === 0 || ts[ts.length - 1] <= oneMinuteAgo) {
          this.groupTimestamps.delete(id);
        }
      }
    }

    return true;
  }
}

class ChatQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(chatId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(task, () => task())
      .finally(() => {
        // Auto-cleanup: remove entry if this is still the tail of the chain
        if (this.chains.get(chatId) === next) {
          this.chains.delete(chatId);
        }
      });

    // Register as new tail BEFORE awaiting (atomic in single-threaded JS)
    this.chains.set(chatId, next);
    return next;
  }

  /**
   * Wait for all active chains to complete (for graceful shutdown).
   */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }

  get activeChats(): number {
    return this.chains.size;
  }
}

export class MessageHandler {
  private bridge: TelegramBridge;
  private config: TelegramConfig;
  private fullConfig?: Config;
  private agent: AgentRuntime;
  private rateLimiter: RateLimiter;
  private messageStore: MessageStore;
  private chatStore: ChatStore;
  private userStore: UserStore;
  private ownUserId?: string;
  private pendingHistory: PendingHistory;
  private db: Database.Database;
  private chatQueue: ChatQueue = new ChatQueue();
  private pluginMessageHooks: Array<(e: PluginMessageEvent) => Promise<void>> = [];
  private recentMessageIds: MessageDedupCache = new MessageDedupCache();

  constructor(
    bridge: TelegramBridge,
    config: TelegramConfig,
    agent: AgentRuntime,
    db: Database.Database,
    embedder: EmbeddingProvider,
    vectorEnabled: boolean,
    fullConfig?: Config,
    private semanticMemory?: SemanticMemoryContext
  ) {
    this.bridge = bridge;
    this.config = config;
    this.fullConfig = fullConfig;
    this.agent = agent;
    this.db = db;
    this.rateLimiter = new RateLimiter(
      config.rate_limit_messages_per_second,
      config.rate_limit_groups_per_minute
    );

    this.messageStore = new MessageStore(db, embedder, vectorEnabled);
    this.chatStore = new ChatStore(db);
    this.userStore = new UserStore(db);
    this.pendingHistory = new PendingHistory();
  }

  setOwnUserId(userId: string | undefined): void {
    this.ownUserId = userId;
  }

  setPluginMessageHooks(hooks: Array<(e: PluginMessageEvent) => Promise<void>>): void {
    this.pluginMessageHooks = hooks;
  }

  async drain(): Promise<void> {
    await this.chatQueue.drain();
  }

  analyzeMessage(message: TelegramMessage): MessageContext {
    const isAdmin = this.config.admin_ids.includes(message.senderId);
    const toContext = (decision: PolicyDecision): MessageContext => ({
      message,
      isAdmin,
      ...decision,
    });

    const preCheck = this.runPreChecks(message, isAdmin);
    if (preCheck) return toContext(preCheck);

    if (!message.isGroup && !message.isChannel) {
      return toContext(validateDM(this.config, message, isAdmin));
    }

    if (message.isGroup) {
      return toContext(validateGroup(this.config, message, isAdmin));
    }

    return toContext({ shouldRespond: false, reason: "Unknown type" });
  }

  /**
   * Returns a denying decision if the message should be skipped before policy
   * checks (stale offset, bot sender, length cap). Returns null to continue.
   */
  private runPreChecks(message: TelegramMessage, isAdmin: boolean): PolicyDecision | null {
    const chatOffset = readOffset(message.chatId) ?? 0;
    if (message.id <= chatOffset) {
      return { shouldRespond: false, reason: "Already processed" };
    }

    if (message.isBot) {
      return { shouldRespond: false, reason: "Sender is a bot" };
    }

    // Reject messages that exceed the configured maximum length to prevent DoS
    // and context-overflow attacks. Admins are exempt from this limit.
    const maxLen = this.config.max_message_length;
    const textLen = message.text?.length ?? 0;
    if (!isAdmin && textLen > maxLen) {
      log.warn(
        { senderId: message.senderId, textLen, maxLen },
        "Message rejected: exceeds max_message_length"
      );
      return {
        shouldRespond: false,
        reason: `Message too long (${textLen} > ${maxLen} chars)`,
      };
    }

    return null;
  }

  /**
   * Process and respond to a message
   */
  async handleMessage(message: TelegramMessage): Promise<void> {
    const dedupKey = `${message.chatId}:${message.id}`;

    // 0. Dedup — GramJS may fire the same event multiple times via different MTProto update channels
    if (this.recentMessageIds.has(dedupKey)) {
      return;
    }
    this.recentMessageIds.add(dedupKey);

    const msgType = message.isGroup ? "group" : message.isChannel ? "channel" : "dm";
    log.debug(
      `📨 [Handler] Received ${msgType} message ${message.id} from ${message.senderId} (mentions: ${message.mentionsMe})`
    );

    // 1. Store incoming message to feed FIRST (even if we won't respond)
    await this.storeTelegramMessage(message, false);

    // 1b. Fire plugin onMessage hooks (fire-and-forget, errors caught per plugin)
    if (this.pluginMessageHooks.length > 0) {
      const event: PluginMessageEvent = {
        chatId: message.chatId,
        senderId: message.senderId,
        senderUsername: message.senderUsername,
        text: message.text,
        isGroup: message.isGroup,
        hasMedia: message.hasMedia,
        messageId: message.id,
        timestamp: message.timestamp,
      };
      for (const hook of this.pluginMessageHooks) {
        hook(event).catch((err) => {
          log.error(
            { err: err instanceof Error ? err : undefined },
            `Plugin onMessage hook error: ${err instanceof Error ? err.message : err}`
          );
        });
      }
    }

    // 2. Analyze context (before locking)
    const context = this.analyzeMessage(message);

    // For groups: track pending messages even if we won't respond
    if (message.isGroup && !context.shouldRespond) {
      this.pendingHistory.addMessage(message.chatId, message);
    }

    if (!context.shouldRespond) {
      if (message.isGroup && context.reason === "Not mentioned") {
        const chatShort =
          message.chatId.length > 10
            ? message.chatId.slice(0, 7) + ".." + message.chatId.slice(-2)
            : message.chatId;
        log.info(`⏭️  Group ${chatShort} msg:${message.id} (not mentioned)`);
      } else {
        log.debug(`Skipping message ${message.id} from ${message.senderId}: ${context.reason}`);
      }
      return;
    }

    // 3. Check rate limits
    if (!this.rateLimiter.canSendMessage()) {
      log.debug("Rate limit reached, skipping message");
      return;
    }

    if (message.isGroup && !this.rateLimiter.canSendToGroup(message.chatId)) {
      log.debug(`Group rate limit reached for ${message.chatId}`);
      return;
    }

    // Enqueue for serial processing — messages wait their turn per chat
    await this.chatQueue.enqueue(message.chatId, async () => {
      try {
        // Re-check offset after queue wait to prevent duplicate processing
        // (GramJS may fire duplicate NewMessage events during reconnection)
        const postQueueOffset = readOffset(message.chatId) ?? 0;
        if (message.id <= postQueueOffset) {
          log.debug(`Skipping message ${message.id} (already processed after queue wait)`);
          return;
        }

        // 4. Persistent typing simulation if enabled
        let typingInterval: ReturnType<typeof setInterval> | undefined;
        if (this.config.typing_simulation) {
          await this.bridge.setTyping(message.chatId);
          typingInterval = setInterval(() => {
            void this.bridge.setTyping(message.chatId);
          }, TYPING_REFRESH_MS);
        }

        try {
          // 5. Get pending history for groups (if any)
          let pendingContext: string | null = null;
          if (message.isGroup) {
            pendingContext = this.pendingHistory.getAndClearPending(message.chatId);
          }

          // 5b. Resolve reply context (only for messages we're responding to)
          let replyContext:
            | {
                text: string;
                senderName?: string;
                isAgent?: boolean;
              }
            | undefined = message.replyContext?.text
            ? {
                text: message.replyContext.text,
                senderName: message.replyContext.senderName,
                isAgent: message.replyContext.isAgent,
              }
            : undefined;
          if (!replyContext && message.replyToId && message._rawMessage) {
            const raw = await this.bridge.fetchReplyContext(message._rawMessage);
            if (raw?.text) {
              replyContext = { text: raw.text, senderName: raw.senderName, isAgent: raw.isAgent };
            }
          }

          // 5c. Auto-transcribe voice/audio messages
          let transcriptionText: string | null = null;
          if (message.mediaType === "voice" || message.mediaType === "audio") {
            // Try Groq STT first if configured
            const groqConfig = this.fullConfig?.groq;
            const groqApiKey =
              groqConfig?.api_key ??
              (this.fullConfig?.agent.provider === "groq"
                ? this.fullConfig?.agent.api_key
                : undefined);

            if (groqApiKey && message._rawMessage) {
              try {
                const gramJsClient = this.bridge.getClient().getClient();
                // Download the audio buffer from the voice/audio message
                const audioBuffer = await gramJsClient.downloadMedia(message._rawMessage, {});
                if (audioBuffer) {
                  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
                  const filename = message.mediaType === "voice" ? "voice.ogg" : "audio.mp3";
                  const result = await groqTranscribe(buf, filename, {
                    apiKey: groqApiKey,
                    model: groqConfig?.stt_model,
                    language: groqConfig?.stt_language,
                  });
                  transcriptionText = result.text;
                  log.info(
                    `🎤 Groq STT transcribed voice msg ${message.id}: "${transcriptionText?.substring(0, LOG_MESSAGE_PREVIEW_CHARS)}..."`
                  );
                }
              } catch (err) {
                log.warn(
                  { err },
                  `Groq STT failed for voice message ${message.id}, falling back to Telegram native`
                );
              }
            }

            // Fall back to Telegram native transcription (requires Premium)
            if (!transcriptionText) {
              try {
                const transcribeResult = await telegramTranscribeAudioExecutor(
                  { chatId: message.chatId, messageId: message.id },
                  {
                    bridge: this.bridge,
                    db: this.db,
                    chatId: message.chatId,
                    senderId: message.senderId,
                    isGroup: message.isGroup,
                    config: this.fullConfig,
                  }
                );
                const transcribeData = transcribeResult.data as Record<string, unknown> | undefined;
                if (transcribeResult.success && transcribeData?.text) {
                  transcriptionText = transcribeData.text as string;
                  log.info(
                    `🎤 Auto-transcribed voice msg ${message.id}: "${transcriptionText?.substring(0, LOG_MESSAGE_PREVIEW_CHARS)}..."`
                  );
                }
              } catch (err) {
                log.warn({ err }, `Failed to auto-transcribe voice message ${message.id}`);
              }
            }
          }

          // 6. Build tool context
          const toolContext: Omit<ToolContext, "chatId" | "isGroup"> = {
            bridge: this.bridge,
            db: this.db,
            senderId: message.senderId,
            config: this.fullConfig,
            semanticMemory: this.semanticMemory,
          };

          // 7. Get response from agent (with tools)
          const userName =
            message.senderFirstName || message.senderUsername || `user:${message.senderId}`;
          // Inject transcription into message text if available
          const effectiveText = transcriptionText
            ? `🎤 (voice): ${transcriptionText}${message.text ? `\n${message.text}` : ""}`
            : message.text;
          const response = await this.agent.processMessage({
            chatId: message.chatId,
            userMessage: effectiveText,
            userName,
            timestamp: message.timestamp.getTime(),
            isGroup: message.isGroup,
            pendingContext,
            toolContext,
            senderUsername: message.senderUsername,
            senderRank: message.senderRank,
            hasMedia: message.hasMedia,
            mediaType: message.mediaType,
            messageId: message.id,
            replyContext,
          });

          // 8. Handle response based on whether tools were used
          const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

          // Check if agent used any Telegram send tool - it already sent the message
          const telegramSendCalled =
            hasToolCalls && response.toolCalls?.some((tc) => TELEGRAM_SEND_TOOLS.has(tc.name));

          if (isSilentReply(response.content)) {
            log.debug("Silent reply suppressed");
          } else if (
            !telegramSendCalled &&
            response.content &&
            response.content.trim().length > 0
          ) {
            // Agent returned text but didn't use the send tool - send it manually.
            // Sanitize markdown (fix unclosed fences, remove empty code blocks) then
            // split into Telegram-safe parts (≤ max_message_length chars each).
            const sanitized = sanitizeMarkdownForTelegram(response.content);
            const parts = splitMessageForTelegram(sanitized, this.config.max_message_length);
            const totalParts = parts.length;

            if (totalParts > 1) {
              log.info(
                `Response split into ${totalParts} parts for chat ${message.chatId} (original length: ${response.content.length})`
              );
            }

            // Check if Groq TTS mode requires a voice response
            const groqConfig = this.fullConfig?.groq;
            const groqApiKey =
              groqConfig?.api_key ??
              (this.fullConfig?.agent.provider === "groq"
                ? this.fullConfig?.agent.api_key
                : undefined);
            const ttsMode = groqConfig?.tts_mode;
            const isVoiceMessage = message.mediaType === "voice" || message.mediaType === "audio";
            const shouldSendVoice =
              groqApiKey &&
              ttsMode !== "use_primary_text" &&
              (ttsMode === "always" || (ttsMode === "voice_calls_only" && isVoiceMessage));

            // For voice TTS we send the full (first-part) text as audio; text fallback
            // still benefits from splitting below.
            let voiceSentForFirst = false;
            if (shouldSendVoice) {
              const firstPart = parts[0];
              let ttsFilePath: string | undefined;
              try {
                const ttsResult = await generateSpeech({
                  text: firstPart,
                  provider: "groq",
                  voice: groqConfig?.tts_voice,
                  groqApiKey,
                  groqModel: groqConfig?.tts_model,
                  groqFormat: groqConfig?.tts_format,
                });
                ttsFilePath = ttsResult.filePath;

                const gramJsClient = this.bridge.getClient().getClient();
                const { Api } = await import("telegram");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS API response is untyped
                const voiceMsg: any = await gramJsClient.sendFile(message.chatId, {
                  file: ttsFilePath,
                  replyTo: message.id,
                  forceDocument: false,
                  voiceNote: true,
                  attributes: [new Api.DocumentAttributeAudio({ voice: true, duration: 0 })],
                });
                log.info(`🎙️ Groq TTS voice reply sent for chat ${message.chatId}`);
                voiceSentForFirst = true;

                // Store the first part in feed using voice message id
                await this.storeTelegramMessage(
                  {
                    id: voiceMsg.id ?? message.id + 1,
                    chatId: message.chatId,
                    senderId: this.ownUserId ? parseInt(this.ownUserId) : 0,
                    text: firstPart,
                    isGroup: message.isGroup,
                    isChannel: message.isChannel,
                    isBot: false,
                    mentionsMe: false,
                    timestamp: new Date((voiceMsg.date ?? Math.floor(Date.now() / 1000)) * 1000),
                    hasMedia: false,
                  },
                  true
                );
              } catch (err) {
                log.warn({ err }, "Groq TTS voice reply failed, falling back to text");
              } finally {
                if (ttsFilePath) {
                  try {
                    unlinkSync(ttsFilePath);
                  } catch {
                    // Ignore cleanup errors
                  }
                }
              }
            }

            // Send remaining parts (or all parts if voice was not used / failed).
            // Note: bridge.sendMessage → TelegramUserClient.sendMessage applies
            // markdownToTelegramHtml internally (parseMode defaults to "html"),
            // so we pass the sanitized markdown as-is.
            const startIndex = voiceSentForFirst ? 1 : 0;
            for (let i = startIndex; i < parts.length; i++) {
              const part = parts[i];
              const replyToId = i === 0 ? message.id : undefined;

              const sentMessage = await this.bridge.sendMessage({
                chatId: message.chatId,
                text: part,
                replyToId,
              });

              // Store each part in the feed
              await this.storeTelegramMessage(
                {
                  id: sentMessage.id,
                  chatId: message.chatId,
                  senderId: this.ownUserId ? parseInt(this.ownUserId) : 0,
                  text: part,
                  isGroup: message.isGroup,
                  isChannel: message.isChannel,
                  isBot: false,
                  mentionsMe: false,
                  timestamp: new Date(sentMessage.date * 1000),
                  hasMedia: false,
                },
                true
              );
            }
          }

          // 9. Clear pending history after responding (for groups)
          if (message.isGroup) {
            this.pendingHistory.clearPending(message.chatId);
          }

          // Mark as processed AFTER successful handling (prevents message loss on crash)
          writeOffset(message.id, message.chatId);
        } finally {
          if (typingInterval) clearInterval(typingInterval);
        }

        log.debug(`Processed message ${message.id} in chat ${message.chatId}`);
      } catch (error) {
        log.error({ err: error }, "Error handling message");
        // When the agent exhausts all rate limit retries, wait 90 seconds and
        // re-process the request automatically before notifying the user.
        if (
          error instanceof Error &&
          (error.message.toLowerCase().includes("rate limit") || error.message.includes("429"))
        ) {
          log.warn("⚠️ Rate limit exhausted — waiting 90s before final retry attempt");
          await new Promise((r) => setTimeout(r, 90_000));
          try {
            const toolContext: Omit<ToolContext, "chatId" | "isGroup"> = {
              bridge: this.bridge,
              db: this.db,
              senderId: message.senderId,
              config: this.fullConfig,
              semanticMemory: this.semanticMemory,
            };
            const userName =
              message.senderFirstName || message.senderUsername || `user:${message.senderId}`;
            const result = await this.agent.processMessage({
              chatId: message.chatId,
              userMessage: message.text,
              userName,
              senderUsername: message.senderUsername,
              timestamp: message.timestamp.getTime(),
              isGroup: message.isGroup,
              toolContext,
              messageId: message.id,
            });
            if (result.content) {
              await this.bridge.sendMessage({
                chatId: message.chatId,
                text: result.content,
                replyToId: message.id,
              });
            }
          } catch (retryErr) {
            log.error({ err: retryErr }, "Rate limit retry also failed — notifying user");
            try {
              await this.bridge.sendMessage({
                chatId: message.chatId,
                text: "⚠️ The AI service is temporarily unavailable due to rate limits. Please try again later.",
                replyToId: message.id,
              });
            } catch (sendErr) {
              log.error({ err: sendErr }, "Failed to send rate-limit error message to user");
            }
          }
        }
      }
    });
  }

  /**
   * Store Telegram message to feed (with chat/user tracking)
   */
  private async storeTelegramMessage(
    message: TelegramMessage,
    isFromAgent: boolean
  ): Promise<void> {
    try {
      // 1. Upsert chat
      this.chatStore.upsertChat({
        id: message.chatId,
        type: message.isChannel ? "channel" : message.isGroup ? "group" : "dm",
        lastMessageId: message.id.toString(),
        lastMessageAt: message.timestamp,
      });

      // 2. Upsert user (sender)
      if (!isFromAgent && message.senderId) {
        this.userStore.upsertUser({
          id: message.senderId.toString(),
          username: message.senderUsername,
          firstName: message.senderFirstName,
        });
        this.userStore.incrementMessageCount(message.senderId.toString());
      }

      // 3. Store message
      await this.messageStore.storeMessage({
        id: message.id.toString(),
        chatId: message.chatId,
        senderId: message.senderId?.toString() ?? null,
        text: message.text,
        replyToId: message.replyToId?.toString(),
        isFromAgent,
        hasMedia: message.hasMedia,
        mediaType: message.mediaType,
        timestamp: Math.floor(message.timestamp.getTime() / 1000),
      });
    } catch (error) {
      log.error({ err: error }, "Error storing message to feed");
    }
  }
}
