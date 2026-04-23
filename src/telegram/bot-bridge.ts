import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Api } from "telegram";
import type { TelegramClientConfig } from "./client.js";
import {
  TelegramBridge,
  type TelegramCacheMetrics,
  type TelegramMessage,
  type SendMessageOptions,
} from "./bridge.js";
import { markdownToTelegramHtml } from "./formatting.js";
import { createLogger } from "../utils/logger.js";
import { validateBotTokenFormat } from "./bot-token.js";

const log = createLogger("TelegramBot");

const RECENT_MESSAGE_LIMIT = 1_000;

export interface TelegramBotBridgeConfig extends TelegramClientConfig {
  botToken: string;
}

export interface BotCallbackQueryEvent {
  queryId: string;
  data: string;
  chatId: string;
  messageId: number;
  userId: number;
}

interface CachedReplyContext {
  text?: string;
  senderName?: string;
  isAgent?: boolean;
}

function messageText(message: { text?: string; caption?: string }): string {
  return message.text ?? message.caption ?? "";
}

function messageSenderName(message: {
  from?: { first_name?: string; username?: string };
}): string | undefined {
  return message.from?.first_name ?? message.from?.username;
}

export class TelegramBotBridge extends TelegramBridge {
  private readonly bot: Bot;
  private connected = false;
  private pollingStarted = false;
  private readonly recentMessages = new Map<string, CachedReplyContext>();

  constructor(config: TelegramBotBridgeConfig) {
    super(config);
    const tokenFormatError = validateBotTokenFormat(config.botToken);
    if (tokenFormatError) {
      throw new Error(`Invalid bot token: ${tokenFormatError}`);
    }
    this.bot = new Bot(config.botToken);
  }

  override async connect(): Promise<void> {
    await this.bot.init();
    this.connected = true;
    this.ownUserId = BigInt(this.bot.botInfo.id);
    this.ownUsername = this.bot.botInfo.username?.toLowerCase();
  }

  override async disconnect(): Promise<void> {
    if (this.pollingStarted) {
      await this.bot.stop();
      this.pollingStarted = false;
    }
    this.connected = false;
  }

  override isAvailable(): boolean {
    return this.connected;
  }

  override getActiveProxyIndex(): number | undefined {
    return undefined;
  }

  override getOwnUserId(): bigint | undefined {
    return this.ownUserId;
  }

  override getUsername(): string | undefined {
    return this.bot.botInfo?.username;
  }

  override getCacheMetrics(): TelegramCacheMetrics {
    return {
      peer: {
        hits: 0,
        misses: 0,
        evictions: 0,
        expirations: 0,
        size: 0,
        maxSize: 0,
        hitRatio: 0,
      },
      sender: {
        hits: 0,
        misses: 0,
        evictions: 0,
        expirations: 0,
        size: 0,
        maxSize: 0,
        hitRatio: 0,
      },
    };
  }

  override onNewMessage(
    handler: (message: TelegramMessage) => void | Promise<void>,
    filters?: {
      incoming?: boolean;
      outgoing?: boolean;
      chats?: string[];
    }
  ): void {
    this.bot.on("message", async (ctx) => {
      if (filters?.incoming === false) return;
      if (filters?.outgoing) return;

      const message = this.toTelegramMessage(ctx);
      if (filters?.chats && !filters.chats.includes(message.chatId)) {
        return;
      }

      await handler(message);
    });

    this.startPolling();
  }

  override onServiceMessage(_handler: (message: TelegramMessage) => void | Promise<void>): void {
    this.startPolling();
  }

  override async sendMessage(
    options: SendMessageOptions & { _rawPeer?: Api.TypePeer }
  ): Promise<Api.Message> {
    const chatId = options.chatId;
    const text = markdownToTelegramHtml(options.text);
    const replyMarkup = options.inlineKeyboard
      ? this.toInlineKeyboard(options.inlineKeyboard)
      : undefined;
    const sent = await this.bot.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_to_message_id: options.replyToId,
      reply_markup: replyMarkup,
    });

    this.rememberMessage(chatId, sent.message_id, {
      text: sent.text,
      senderName: this.bot.botInfo.first_name,
      isAgent: true,
    });

    return {
      id: sent.message_id,
      date: sent.date,
      message: sent.text,
    } as unknown as Api.Message;
  }

  override async setTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch (error) {
      log.error({ err: error }, "Error setting bot typing state");
    }
  }

  override async fetchReplyContext(
    _rawMsg: Api.Message
  ): Promise<{ text?: string; senderName?: string; isAgent?: boolean } | undefined> {
    return undefined;
  }

  override getClient(): never {
    throw new Error("MTProto client is not available for bot-mode managed agents");
  }

  onCallbackQuery(handler: (event: BotCallbackQueryEvent) => void | Promise<void>): void {
    this.bot.on("callback_query:data", async (ctx) => {
      const callbackQuery = ctx.callbackQuery;
      const message = callbackQuery.message;
      const chatId =
        message && "chat" in message && message.chat
          ? String(message.chat.id)
          : String(ctx.from.id);
      const messageId = message && "message_id" in message ? message.message_id : 0;

      await handler({
        queryId: callbackQuery.id,
        data: callbackQuery.data,
        chatId,
        messageId,
        userId: ctx.from.id,
      });
    });

    this.startPolling();
  }

  async answerCallbackQuery(
    queryId: string,
    options?: { message?: string; alert?: boolean; url?: string }
  ): Promise<boolean> {
    try {
      await this.bot.api.answerCallbackQuery(queryId, {
        text: options?.message,
        show_alert: options?.alert,
        url: options?.url,
      });
      return true;
    } catch (error) {
      log.error({ err: error }, "Error answering bot callback query");
      return false;
    }
  }

  private startPolling(): void {
    if (!this.connected || this.pollingStarted) return;
    this.pollingStarted = true;
    this.bot
      .start({
        onStart: () => {
          log.info(`🤖 Bot-mode polling started for @${this.bot.botInfo.username}`);
        },
      })
      .catch((error) => {
        log.error({ err: error }, "Bot polling failed");
        this.pollingStarted = false;
      });
  }

  private toTelegramMessage(ctx: Context): TelegramMessage {
    const msg = ctx.msg;
    const chat = ctx.chat;
    if (!msg || !chat || !("message_id" in msg)) {
      throw new Error("Received bot update without a message payload");
    }

    const chatId = String(chat.id);
    const text = messageText(msg);
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    const isChannel = chat.type === "channel";
    const mentionsMe =
      chat.type === "private" ||
      (this.ownUsername ? text.toLowerCase().includes(`@${this.ownUsername}`) : false) ||
      msg.reply_to_message?.from?.id === this.bot.botInfo.id;

    const hasMedia = Boolean(
      "photo" in msg ||
      "document" in msg ||
      "video" in msg ||
      "audio" in msg ||
      "voice" in msg ||
      "sticker" in msg
    );

    let mediaType: TelegramMessage["mediaType"];
    if ("photo" in msg && msg.photo) mediaType = "photo";
    else if ("video" in msg && msg.video) mediaType = "video";
    else if ("audio" in msg && msg.audio) mediaType = "audio";
    else if ("voice" in msg && msg.voice) mediaType = "voice";
    else if ("sticker" in msg && msg.sticker) mediaType = "sticker";
    else if ("document" in msg && msg.document) mediaType = "document";

    const replyMessage = msg.reply_to_message;
    const replyContext = replyMessage
      ? {
          text: messageText(replyMessage),
          senderName: messageSenderName(replyMessage),
          isAgent: replyMessage.from?.id === this.bot.botInfo.id,
        }
      : undefined;

    const telegramMessage: TelegramMessage = {
      id: msg.message_id,
      chatId,
      senderId: ctx.from?.id ?? 0,
      senderUsername: ctx.from?.username,
      senderFirstName: ctx.from?.first_name,
      text,
      isGroup,
      isChannel,
      isBot: ctx.from?.is_bot ?? false,
      mentionsMe,
      timestamp: new Date(msg.date * 1000),
      hasMedia,
      mediaType,
      replyToId: replyMessage?.message_id,
      replyContext,
    };

    this.rememberMessage(chatId, msg.message_id, {
      text: telegramMessage.text,
      senderName: telegramMessage.senderFirstName ?? telegramMessage.senderUsername,
      isAgent: false,
    });

    return telegramMessage;
  }

  private toInlineKeyboard(rows: Array<Array<{ text: string; callback_data: string }>>) {
    const keyboard = new InlineKeyboard();
    rows.forEach((row, rowIndex) => {
      row.forEach((button) => {
        keyboard.text(button.text, button.callback_data);
      });
      if (rowIndex < rows.length - 1) {
        keyboard.row();
      }
    });
    return keyboard;
  }

  private rememberMessage(chatId: string, messageId: number, context: CachedReplyContext): void {
    this.recentMessages.set(this.messageKey(chatId, messageId), context);
    while (this.recentMessages.size > RECENT_MESSAGE_LIMIT) {
      const firstKey = this.recentMessages.keys().next().value;
      if (!firstKey) break;
      this.recentMessages.delete(firstKey);
    }
  }

  private messageKey(chatId: string, messageId: number): string {
    return `${chatId}:${messageId}`;
  }
}
