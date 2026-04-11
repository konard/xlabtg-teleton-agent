import { TelegramUserClient, type TelegramClientConfig } from "./client.js";
import { Api } from "telegram";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { createLogger } from "../utils/logger.js";
import {
  DEFAULT_GET_MESSAGES_LIMIT,
  TELEGRAM_SENDER_RESOLVE_TIMEOUT_MS,
} from "../constants/limits.js";

const log = createLogger("Telegram");

/** TTL for sender info cache entries (1 hour). Balances freshness vs. API calls. */
const SENDER_CACHE_TTL_MS = 60 * 60 * 1000;
/** TTL for peer cache entries (1 hour). Prevents stale entries accumulating in long sessions. */
const PEER_CACHE_TTL_MS = 60 * 60 * 1000;
/** Max number of entries in peerCache before LRU eviction kicks in. */
const PEER_CACHE_MAX_SIZE = 1000;

interface SenderCacheEntry {
  username?: string;
  firstName?: string;
  isBot: boolean;
  expiresAt: number;
}

interface PeerCacheEntry {
  peer: Api.TypePeer;
  expiresAt: number;
}

export interface TelegramMessage {
  id: number;
  chatId: string;
  senderId: number;
  senderUsername?: string;
  senderFirstName?: string;
  senderRank?: string;
  text: string;
  isGroup: boolean;
  isChannel: boolean;
  isBot: boolean;
  mentionsMe: boolean;
  timestamp: Date;
  _rawPeer?: Api.TypePeer;
  hasMedia: boolean;
  mediaType?: "photo" | "document" | "video" | "audio" | "voice" | "sticker";
  replyToId?: number;
  _rawMessage?: Api.Message;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface SendMessageOptions {
  chatId: string;
  text: string;
  replyToId?: number;
  inlineKeyboard?: InlineButton[][];
}

export class TelegramBridge {
  private client: TelegramUserClient;
  private ownUserId?: bigint;
  private ownUsername?: string;
  /** LRU peer cache: chatId → {peer, expiresAt}. Bounded by PEER_CACHE_MAX_SIZE + TTL. */
  private peerCache: Map<string, PeerCacheEntry> = new Map();
  /** Sender info cache: senderId → entry. Avoids repeated getSender() calls per sender in group chats. */
  private senderCache: Map<number, SenderCacheEntry> = new Map();

  constructor(config: TelegramClientConfig) {
    this.client = new TelegramUserClient(config);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const me = this.client.getMe();
    if (me) {
      this.ownUserId = me.id;
      this.ownUsername = me.username?.toLowerCase();
    }

    try {
      // Wrap in a timeout — if the proxy silently drops packets, getDialogs()
      // can hang indefinitely, blocking the entire agent startup.
      await Promise.race([
        this.getDialogs(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("getDialogs() timed out")), 30_000)
        ),
      ]);
    } catch (error) {
      log.warn({ err: error }, "Could not load dialogs");
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  isAvailable(): boolean {
    return this.client.isConnected();
  }

  /** Returns the 0-based index of the active MTProto proxy, or undefined for direct connection. */
  getActiveProxyIndex(): number | undefined {
    return this.client.getActiveProxyIndex();
  }

  getOwnUserId(): bigint | undefined {
    return this.ownUserId;
  }

  getUsername(): string | undefined {
    const me = this.client.getMe();
    return me?.username;
  }

  async getMessages(
    chatId: string,
    limit: number = DEFAULT_GET_MESSAGES_LIMIT
  ): Promise<TelegramMessage[]> {
    try {
      const peer = this.getPeer(chatId) || chatId;
      const messages = await this.client.getMessages(peer, { limit });
      const results = await Promise.allSettled(messages.map((msg) => this.parseMessage(msg)));
      return results
        .filter((r): r is PromiseFulfilledResult<TelegramMessage> => r.status === "fulfilled")
        .map((r) => r.value);
    } catch (error) {
      log.error({ err: error }, "Error getting messages");
      return [];
    }
  }

  async sendMessage(
    options: SendMessageOptions & { _rawPeer?: Api.TypePeer }
  ): Promise<Api.Message> {
    try {
      const peer = options._rawPeer || this.getPeer(options.chatId) || options.chatId;

      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        const buttons = new Api.ReplyInlineMarkup({
          rows: options.inlineKeyboard.map(
            (row) =>
              new Api.KeyboardButtonRow({
                buttons: row.map(
                  (btn) =>
                    new Api.KeyboardButtonCallback({
                      text: btn.text,
                      data: Buffer.from(btn.callback_data),
                    })
                ),
              })
          ),
        });

        const gramJsClient = this.client.getClient();
        return await gramJsClient.sendMessage(peer, {
          message: options.text,
          replyTo: options.replyToId,
          buttons,
        });
      }

      return await this.client.sendMessage(peer, {
        message: options.text,
        replyTo: options.replyToId,
      });
    } catch (error) {
      log.error({ err: error }, "Error sending message");
      throw error;
    }
  }

  async editMessage(options: {
    chatId: string;
    messageId: number;
    text: string;
    inlineKeyboard?: InlineButton[][];
  }): Promise<Api.Message> {
    try {
      const peer = this.getPeer(options.chatId) || options.chatId;

      let buttons;
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        buttons = new Api.ReplyInlineMarkup({
          rows: options.inlineKeyboard.map(
            (row) =>
              new Api.KeyboardButtonRow({
                buttons: row.map(
                  (btn) =>
                    new Api.KeyboardButtonCallback({
                      text: btn.text,
                      data: Buffer.from(btn.callback_data),
                    })
                ),
              })
          ),
        });
      }

      const gramJsClient = this.client.getClient();
      const result = await gramJsClient.invoke(
        new Api.messages.EditMessage({
          peer,
          id: options.messageId,
          message: options.text,
          replyMarkup: buttons,
        })
      );

      if (result instanceof Api.Updates) {
        const messageUpdate = result.updates.find(
          (u) => u.className === "UpdateEditMessage" || u.className === "UpdateEditChannelMessage"
        );
        if (messageUpdate && "message" in messageUpdate) {
          return messageUpdate.message as Api.Message;
        }
      }

      return result as unknown as Api.Message;
    } catch (error) {
      log.error({ err: error }, "Error editing message");
      throw error;
    }
  }

  async getDialogs(): Promise<
    Array<{
      id: string;
      title: string;
      isGroup: boolean;
      isChannel: boolean;
    }>
  > {
    try {
      const dialogs = await this.client.getDialogs();
      return dialogs.map((d) => ({
        id: d.id.toString(),
        title: d.title,
        isGroup: d.isGroup,
        isChannel: d.isChannel,
      }));
    } catch (error) {
      log.error({ err: error }, "Error getting dialogs");
      return [];
    }
  }

  async setTyping(chatId: string): Promise<void> {
    try {
      await this.client.setTyping(chatId);
    } catch (error) {
      log.error({ err: error }, "Error setting typing");
    }
  }

  async sendReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      const peer = this.getPeer(chatId) || chatId;

      await this.client.getClient().invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: messageId,
          reaction: [
            new Api.ReactionEmoji({
              emoticon: emoji,
            }),
          ],
        })
      );
    } catch (error) {
      log.error({ err: error }, "Error sending reaction");
      throw error;
    }
  }

  onNewMessage(
    handler: (message: TelegramMessage) => void | Promise<void>,
    filters?: {
      incoming?: boolean;
      outgoing?: boolean;
      chats?: string[];
    }
  ): void {
    this.client.addNewMessageHandler(
      async (event: NewMessageEvent) => {
        const message = await this.parseMessage(event.message);
        await handler(message);
      },
      {
        incoming: filters?.incoming,
        outgoing: filters?.outgoing,
        chats: filters?.chats,
      }
    );
  }

  onServiceMessage(handler: (message: TelegramMessage) => void | Promise<void>): void {
    this.client.addServiceMessageHandler(async (msg: Api.MessageService) => {
      const message = await this.parseServiceMessage(msg);
      if (message) {
        await handler(message);
      }
    });
  }

  private async parseMessage(msg: Api.Message): Promise<TelegramMessage> {
    const chatId = msg.chatId?.toString() ?? msg.peerId?.toString() ?? "unknown";
    const senderIdBig = msg.senderId ? BigInt(msg.senderId.toString()) : BigInt(0);
    const senderId = Number(senderIdBig);

    let mentionsMe = msg.mentioned ?? false;
    if (!mentionsMe && this.ownUsername && msg.message) {
      mentionsMe = msg.message.toLowerCase().includes(`@${this.ownUsername}`);
    }

    const isChannel = msg.post ?? false;
    const isGroup = !isChannel && chatId.startsWith("-");

    if (msg.peerId) {
      this.setPeer(chatId, msg.peerId);
    }

    let senderUsername: string | undefined;
    let senderFirstName: string | undefined;
    let isBot = false;

    // Check sender cache first to avoid repeated getSender() calls (N+1 in group chats)
    const cachedSender = senderId !== 0 ? this.senderCache.get(senderId) : undefined;
    if (cachedSender && Date.now() < cachedSender.expiresAt) {
      senderUsername = cachedSender.username;
      senderFirstName = cachedSender.firstName;
      isBot = cachedSender.isBot;
    } else {
      try {
        const sender = await Promise.race([
          msg.getSender(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), TELEGRAM_SENDER_RESOLVE_TIMEOUT_MS)
          ),
        ]);
        if (sender && "username" in sender) {
          senderUsername = sender.username ?? undefined;
        }
        if (sender && "firstName" in sender) {
          senderFirstName = sender.firstName ?? undefined;
        }
        if (sender instanceof Api.User) {
          isBot = sender.bot ?? false;
        }
        if (senderId !== 0) {
          this.senderCache.set(senderId, {
            username: senderUsername,
            firstName: senderFirstName,
            isBot,
            expiresAt: Date.now() + SENDER_CACHE_TTL_MS,
          });
        }
      } catch (err) {
        // getSender() can fail on deleted accounts, timeouts, etc.
        // Non-critical: message still processed with default sender info
        log.debug({ err, msgId: msg.id }, "Could not resolve sender info");
      }
    }

    const hasMedia = !!(
      msg.photo ||
      msg.document ||
      msg.video ||
      msg.audio ||
      msg.voice ||
      msg.sticker
    );
    let mediaType: TelegramMessage["mediaType"];
    if (msg.photo) mediaType = "photo";
    else if (msg.video) mediaType = "video";
    else if (msg.audio) mediaType = "audio";
    else if (msg.voice) mediaType = "voice";
    else if (msg.sticker) mediaType = "sticker";
    else if (msg.document) mediaType = "document";

    const replyToMsgId = msg.replyToMsgId; // GramJS getter, returns number | undefined

    let text = msg.message ?? "";
    if (!text && msg.media) {
      if (msg.media.className === "MessageMediaDice") {
        const dice = msg.media as Api.MessageMediaDice;
        text = `[Dice: ${dice.emoticon} = ${dice.value}]`;
      } else if (msg.media.className === "MessageMediaGame") {
        const game = msg.media as Api.MessageMediaGame;
        text = `[Game: ${game.game.title}]`;
      } else if (msg.media.className === "MessageMediaPoll") {
        const poll = msg.media as Api.MessageMediaPoll;
        text = `[Poll: ${poll.poll.question.text}]`;
      } else if (msg.media.className === "MessageMediaContact") {
        const contact = msg.media as Api.MessageMediaContact;
        text = `[Contact: ${contact.firstName} ${contact.lastName || ""} - ${contact.phoneNumber}]`;
      } else if (
        msg.media.className === "MessageMediaGeo" ||
        msg.media.className === "MessageMediaGeoLive"
      ) {
        text = `[Location shared]`;
      }
    }

    // fromRank is a Layer 223 field on Message (not in CustomMessage typings)
    const senderRank = (msg as unknown as { fromRank?: string }).fromRank || undefined;

    return {
      id: msg.id,
      chatId,
      senderId,
      senderUsername,
      senderFirstName,
      senderRank,
      text,
      isGroup,
      isChannel,
      isBot,
      mentionsMe,
      timestamp: new Date(msg.date * 1000),
      _rawPeer: msg.peerId,
      hasMedia,
      mediaType,
      replyToId: replyToMsgId,
      _rawMessage: hasMedia || !!replyToMsgId ? msg : undefined,
    };
  }

  private async parseServiceMessage(msg: Api.MessageService): Promise<TelegramMessage | null> {
    const action = msg.action;
    if (!action) return null;

    // Only handle gift-related actions
    const isGiftAction =
      action instanceof Api.MessageActionStarGiftPurchaseOffer ||
      action instanceof Api.MessageActionStarGiftPurchaseOfferDeclined ||
      action instanceof Api.MessageActionStarGift;
    if (!isGiftAction) return null;

    // Skip our own outgoing actions
    if (msg.out) return null;

    const chatId = msg.chatId?.toString() ?? msg.peerId?.toString() ?? "unknown";
    const senderIdBig = msg.senderId ? BigInt(msg.senderId.toString()) : BigInt(0);
    const senderId = Number(senderIdBig);

    // Resolve sender info (same pattern as parseMessage, 5s timeout)
    let senderUsername: string | undefined;
    let senderFirstName: string | undefined;
    let isBot = false;

    // Check sender cache first to avoid repeated getSender() calls
    const cachedSender = senderId !== 0 ? this.senderCache.get(senderId) : undefined;
    if (cachedSender && Date.now() < cachedSender.expiresAt) {
      senderUsername = cachedSender.username;
      senderFirstName = cachedSender.firstName;
      isBot = cachedSender.isBot;
    } else {
      try {
        const sender = await Promise.race([
          msg.getSender(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), TELEGRAM_SENDER_RESOLVE_TIMEOUT_MS)
          ),
        ]);
        if (sender && "username" in sender) {
          senderUsername = sender.username ?? undefined;
        }
        if (sender && "firstName" in sender) {
          senderFirstName = sender.firstName ?? undefined;
        }
        if (sender instanceof Api.User) {
          isBot = sender.bot ?? false;
        }
        if (senderId !== 0) {
          this.senderCache.set(senderId, {
            username: senderUsername,
            firstName: senderFirstName,
            isBot,
            expiresAt: Date.now() + SENDER_CACHE_TTL_MS,
          });
        }
      } catch (err) {
        // getSender() can fail on deleted accounts, timeouts, etc. — non-critical
        log.debug({ err, msgId: msg.id }, "Could not resolve sender info for service message");
      }
    }

    let text = "";

    if (action instanceof Api.MessageActionStarGiftPurchaseOffer) {
      const gift = action.gift;
      const isUnique = gift instanceof Api.StarGiftUnique;
      const title = gift.title || "Unknown Gift";
      const slug = isUnique ? gift.slug : undefined;
      const num = isUnique ? gift.num : undefined;
      const priceStars = action.price.amount?.toString() || "?";
      const status = action.accepted ? "accepted" : action.declined ? "declined" : "pending";
      const expires = action.expiresAt
        ? new Date(action.expiresAt * 1000).toISOString()
        : "unknown";

      text = `[Gift Offer Received]\n`;
      text += `Offer: ${priceStars} Stars for your NFT "${title}"${num ? ` #${num}` : ""}${slug ? ` (slug: ${slug})` : ""}\n`;
      text += `From: ${senderUsername ? `@${senderUsername}` : senderFirstName || `user:${senderId}`}\n`;
      text += `Expires: ${expires}\n`;
      text += `Status: ${status}\n`;
      text += `Message ID: ${msg.id} — use telegram_resolve_gift_offer(offerMsgId=${msg.id}) to accept or telegram_resolve_gift_offer(offerMsgId=${msg.id}, decline=true) to decline.`;

      log.info(
        `Gift offer received: ${priceStars} Stars for "${title}" from ${senderUsername || senderId}`
      );
    } else if (action instanceof Api.MessageActionStarGiftPurchaseOfferDeclined) {
      const gift = action.gift;
      const isUnique = gift instanceof Api.StarGiftUnique;
      const title = gift.title || "Unknown Gift";
      const slug = isUnique ? gift.slug : undefined;
      const num = isUnique ? gift.num : undefined;
      const priceStars = action.price.amount?.toString() || "?";
      const reason = action.expired ? "expired" : "declined";

      text = `[Gift Offer ${action.expired ? "Expired" : "Declined"}]\n`;
      text += `Your offer of ${priceStars} Stars for NFT "${title}"${num ? ` #${num}` : ""}${slug ? ` (slug: ${slug})` : ""} was ${reason}.`;

      log.info(`Gift offer ${reason}: ${priceStars} Stars for "${title}"`);
    } else if (action instanceof Api.MessageActionStarGift) {
      const gift = action.gift;
      const title = gift.title || "Unknown Gift";
      const stars = gift instanceof Api.StarGift ? gift.stars?.toString() || "?" : "?";
      const giftMessage = action.message?.text || "";
      const fromAnonymous = action.nameHidden;

      text = `[Gift Received]\n`;
      text += `Gift: "${title}" (${stars} Stars)${action.upgraded ? " [Upgraded to Collectible]" : ""}\n`;
      text += `From: ${fromAnonymous ? "Anonymous" : senderUsername ? `@${senderUsername}` : senderFirstName || `user:${senderId}`}\n`;
      if (giftMessage) text += `Message: "${giftMessage}"\n`;
      if (action.canUpgrade && action.upgradeStars) {
        text += `This gift can be upgraded to a collectible for ${action.upgradeStars.toString()} Stars.\n`;
      }
      if (action.convertStars) {
        text += `Can be converted to ${action.convertStars.toString()} Stars.`;
      }

      log.info(
        `Gift received: "${title}" (${stars} Stars) from ${fromAnonymous ? "Anonymous" : senderUsername || senderId}`
      );
    }

    if (!text) return null;

    // Cache peer
    if (msg.peerId) {
      this.setPeer(chatId, msg.peerId);
    }

    return {
      id: msg.id,
      chatId,
      senderId,
      senderUsername,
      senderFirstName,
      text: text.trim(),
      isGroup: false,
      isChannel: false,
      isBot,
      mentionsMe: true,
      timestamp: new Date(msg.date * 1000),
      hasMedia: false,
      _rawPeer: msg.peerId,
    };
  }

  getPeer(chatId: string): Api.TypePeer | undefined {
    const entry = this.peerCache.get(chatId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.peerCache.delete(chatId);
      return undefined;
    }
    // LRU: re-insert to move to end (Map iteration is insertion-ordered)
    this.peerCache.delete(chatId);
    this.peerCache.set(chatId, entry);
    return entry.peer;
  }

  private setPeer(chatId: string, peer: Api.TypePeer): void {
    // Delete first (if present) so the new entry goes to the end of insertion order
    this.peerCache.delete(chatId);
    this.peerCache.set(chatId, { peer, expiresAt: Date.now() + PEER_CACHE_TTL_MS });

    // Evict oldest entries when over capacity
    while (this.peerCache.size > PEER_CACHE_MAX_SIZE) {
      const oldest = this.peerCache.keys().next().value;
      if (oldest !== undefined) this.peerCache.delete(oldest);
    }
  }

  async fetchReplyContext(
    rawMsg: Api.Message
  ): Promise<{ text?: string; senderName?: string; isAgent?: boolean } | undefined> {
    try {
      const replyMsg = await Promise.race([
        rawMsg.getReplyMessage(),
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), TELEGRAM_SENDER_RESOLVE_TIMEOUT_MS)
        ),
      ]);
      if (!replyMsg) return undefined;

      let senderName: string | undefined;
      try {
        const sender = await Promise.race([
          replyMsg.getSender(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), TELEGRAM_SENDER_RESOLVE_TIMEOUT_MS)
          ),
        ]);
        if (sender && "firstName" in sender) {
          senderName = (sender.firstName as string) ?? undefined;
        }
        if (sender && "username" in sender && !senderName) {
          senderName = (sender.username as string) ?? undefined;
        }
      } catch (err) {
        // Non-critical: reply context sender name is optional
        log.debug({ err, replyMsgId: replyMsg.id }, "Could not resolve reply sender name");
      }

      const replyMsgSenderId = replyMsg.senderId ? BigInt(replyMsg.senderId.toString()) : undefined;
      const isAgent = this.ownUserId !== undefined && replyMsgSenderId === this.ownUserId;

      return {
        text: replyMsg.message || undefined,
        senderName,
        isAgent,
      };
    } catch (err) {
      log.debug({ err, msgId: rawMsg.id }, "Could not fetch reply context");
      return undefined;
    }
  }

  getClient(): TelegramUserClient {
    return this.client;
  }
}
