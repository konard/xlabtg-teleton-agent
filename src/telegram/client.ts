import { TelegramClient, Api } from "telegram";
import type { ProxyInterface } from "telegram/network/connection/TCPMTProxy.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createInterface } from "readline";
import { markdownToTelegramHtml } from "./formatting.js";
import { withFloodRetry } from "./flood-retry.js";
import { TelegramError } from "./errors.js";
import { createLogger } from "../utils/logger.js";
import type { MtprotoProxyEntry } from "../config/schema.js";
import { MTPROTO_PROXY_CONNECT_TIMEOUT_MS } from "../constants/timeouts.js";

const log = createLogger("Telegram");

function promptInput(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export interface TelegramClientConfig {
  apiId: number;
  apiHash: string;
  phone: string;
  sessionPath: string;
  connectionRetries?: number;
  retryDelay?: number;
  autoReconnect?: boolean;
  floodSleepThreshold?: number;
  /** MTProto proxy servers (tried in order, failover to next on connection error) */
  mtprotoProxies?: MtprotoProxyEntry[];
}

export interface TelegramUser {
  id: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isBot: boolean;
}

export class TelegramUserClient {
  private client: TelegramClient;
  private config: TelegramClientConfig;
  private connected = false;
  private me?: TelegramUser;
  /** Index into mtprotoProxies[] currently being used (or undefined = direct) */
  private activeProxyIndex?: number;

  constructor(config: TelegramClientConfig) {
    this.config = config;
    this.client = this.buildClient();
  }

  private buildClient(proxy?: ProxyInterface): TelegramClient {
    const sessionString = this.loadSession();
    const session = new StringSession(sessionString);
    const logger = new Logger(LogLevel.NONE);
    return new TelegramClient(session, this.config.apiId, this.config.apiHash, {
      connectionRetries: this.config.connectionRetries ?? 5,
      retryDelay: this.config.retryDelay ?? 1000,
      autoReconnect: this.config.autoReconnect ?? true,
      floodSleepThreshold: this.config.floodSleepThreshold ?? 60,
      baseLogger: logger,
      proxy,
    });
  }

  private buildProxy(entry: MtprotoProxyEntry): ProxyInterface {
    return {
      ip: entry.server,
      port: entry.port,
      secret: entry.secret,
      MTProxy: true,
    } as ProxyInterface;
  }

  private loadSession(): string {
    try {
      if (existsSync(this.config.sessionPath)) {
        return readFileSync(this.config.sessionPath, "utf-8").trim();
      }
    } catch (error) {
      log.warn({ err: error }, "Failed to load session");
    }
    return "";
  }

  private saveSession(): void {
    try {
      const sessionString = this.client.session.save() as string | undefined;
      if (typeof sessionString !== "string" || !sessionString) {
        log.warn("No session string to save");
        return;
      }
      const dir = dirname(this.config.sessionPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.config.sessionPath, sessionString, { encoding: "utf-8", mode: 0o600 });
      log.info("Session saved");
    } catch (error) {
      log.error({ err: error }, "Failed to save session");
    }
  }

  /** Try connecting via proxy at `index`, rebuilding the client with that proxy.
   *  Races the connect() call against a timeout to avoid indefinite hangs when
   *  a proxy silently drops packets instead of refusing the connection.
   *  On failure/timeout, disconnects the client to stop background retries.
   */
  private async connectWithProxy(index: number): Promise<void> {
    const proxies = this.config.mtprotoProxies ?? [];
    const entry = proxies[index];
    const proxy = this.buildProxy(entry);
    log.info(
      { server: entry.server, port: entry.port },
      `[MTProxy] Trying proxy ${index + 1}/${proxies.length}`
    );
    this.client = this.buildClient(proxy);
    this.activeProxyIndex = index;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `[MTProxy] Proxy ${index + 1} timed out after ${MTPROTO_PROXY_CONNECT_TIMEOUT_MS / 1000}s`
            )
          ),
        MTPROTO_PROXY_CONNECT_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([this.client.connect(), timeoutPromise]);
    } catch (err) {
      // Disconnect the abandoned client so its internal retry loop stops
      // and does not leak sockets or interfere with the next attempt.
      this.client.disconnect().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Return the index (0-based) of the currently active proxy, or undefined for direct connection. */
  getActiveProxyIndex(): number | undefined {
    return this.activeProxyIndex;
  }

  /**
   * Perform the interactive authentication flow (SendCode → SignIn / 2FA).
   * Called when there is no saved session and we need to create a new one.
   */
  private async runAuthFlow(): Promise<void> {
    log.info("Starting authentication flow...");
    const phone = this.config.phone || (await promptInput("Phone number: "));

    const sendResult = await this.sendAuthCode(phone);
    if (sendResult === "already_authenticated") {
      this.saveSession();
      return;
    }

    const { phoneCodeHash } = sendResult;
    await this.signInWithCode(phone, phoneCodeHash);

    log.info("Authenticated");
    this.saveSession();
  }

  /** Returns "already_authenticated" on SentCodeSuccess (e.g. session migration). */
  private async sendAuthCode(
    phone: string
  ): Promise<"already_authenticated" | { phoneCodeHash: string }> {
    const sendResult = await this.client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: this.config.apiId,
        apiHash: this.config.apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    if (sendResult instanceof Api.auth.SentCodeSuccess) {
      log.info("Authenticated (SentCodeSuccess)");
      return "already_authenticated";
    }

    if (!(sendResult instanceof Api.auth.SentCode)) {
      throw new TelegramError(
        "Unexpected auth response: payment required or unknown type",
        "AUTH_UNEXPECTED_RESPONSE",
        { responseType: sendResult?.constructor?.name }
      );
    }

    // Fragment SMS is used for anonymous numbers (+888) — show the URL
    // the user must open to retrieve the code.
    if (sendResult.type instanceof Api.auth.SentCodeTypeFragmentSms) {
      const url = sendResult.type.url;
      if (url) {
        log.info({ fragmentUrl: url }, "Anonymous number — open this URL to get your code");
        process.stdout.write(`\n  Open this URL to get your code:\n  ${url}\n\n`);
      }
    }

    return { phoneCodeHash: sendResult.phoneCodeHash };
  }

  /** Retries on PHONE_CODE_INVALID; switches to 2FA on SESSION_PASSWORD_NEEDED. */
  private async signInWithCode(phone: string, phoneCodeHash: string): Promise<void> {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const code = await promptInput("Verification code: ");

      try {
        await this.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode: code,
          })
        );
        return;
      } catch (err: unknown) {
        const errorMessage = (err as { errorMessage?: string } | null)?.errorMessage;

        if (errorMessage === "SESSION_PASSWORD_NEEDED") {
          await this.signInWithPassword();
          return;
        }

        if (errorMessage !== "PHONE_CODE_INVALID") {
          throw err;
        }

        const remaining = maxAttempts - attempt - 1;
        if (remaining <= 0) {
          throw new TelegramError(
            "Authentication failed: too many invalid code attempts",
            "AUTH_INVALID_CODE",
            { maxAttempts }
          );
        }
        log.warn({ attemptsRemaining: remaining }, "Invalid authentication code");
      }
    }

    // Unreachable: the loop either returns on success or throws on the
    // final attempt, but TypeScript cannot prove that.
    throw new TelegramError("Authentication failed", "AUTH_FAILED");
  }

  private async signInWithPassword(): Promise<void> {
    const pwd = await promptInput("2FA password: ");
    const { computeCheck } = await import("telegram/Password.js");
    const srpResult = await this.client.invoke(new Api.account.GetPassword());
    const srpCheck = await computeCheck(srpResult, pwd);
    await this.client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
  }

  async connect(): Promise<void> {
    if (this.connected) {
      log.info("Already connected");
      return;
    }

    try {
      const proxies = this.config.mtprotoProxies ?? [];
      const hasSession = existsSync(this.config.sessionPath);

      if (proxies.length > 0) {
        // Try each proxy in order; fall back to direct only if all proxies fail
        let proxyConnected = false;
        for (let i = 0; i < proxies.length; i++) {
          try {
            await this.connectWithProxy(i);
            proxyConnected = true;
            break;
          } catch (err) {
            log.warn(
              { err, server: proxies[i].server },
              `[MTProxy] Proxy ${i + 1}/${proxies.length} failed, trying next`
            );
          }
        }
        if (!proxyConnected) {
          log.warn("[MTProxy] All proxies failed, trying direct connection");
          this.client = this.buildClient();
          this.activeProxyIndex = undefined;
          await this.client.connect();
        }
        // If no session exists, run auth flow now that the TCP connection is established
        if (!hasSession) {
          await this.runAuthFlow();
        }
      } else if (hasSession) {
        await this.client.connect();
      } else {
        await this.client.connect();
        await this.runAuthFlow();
      }

      // Race getMe() against a timeout to avoid hanging on a broken proxy
      const getMeTimeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new TelegramError(
                "[Telegram] getMe() timed out — proxy may be unresponsive",
                "GET_ME_TIMEOUT",
                { timeoutMs: MTPROTO_PROXY_CONNECT_TIMEOUT_MS }
              )
            ),
          MTPROTO_PROXY_CONNECT_TIMEOUT_MS
        )
      );
      const me = (await Promise.race([this.client.getMe(), getMeTimeout])) as Api.User;
      this.me = {
        id: BigInt(me.id.toString()),
        username: me.username,
        firstName: me.firstName,
        lastName: me.lastName,
        phone: me.phone,
        isBot: me.bot ?? false,
      };

      this.connected = true;
    } catch (error) {
      log.error({ err: error }, "Connection error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client.disconnect();
      this.connected = false;
      log.info("Disconnected");
    } catch (error) {
      log.error({ err: error }, "Disconnect error");
    }
  }

  getMe(): TelegramUser | undefined {
    return this.me;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClient(): TelegramClient {
    return this.client;
  }

  addNewMessageHandler(
    handler: (event: NewMessageEvent) => void | Promise<void>,
    filters?: {
      incoming?: boolean;
      outgoing?: boolean;
      chats?: string[];
      fromUsers?: number[];
      pattern?: RegExp;
    }
  ): void {
    const wrappedHandler = async (event: NewMessageEvent) => {
      if (process.env.DEBUG) {
        const chatId = event.message.chatId?.toString() ?? "unknown";
        const isGroup = chatId.startsWith("-");
        log.debug(
          `RAW EVENT: chatId=${chatId} isGroup=${isGroup} text="${event.message.message?.substring(0, 30) ?? ""}"`
        );
      }
      await handler(event);
    };
    this.client.addEventHandler(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- GramJS event handler accepts async
      wrappedHandler,
      new NewMessage(filters ?? {})
    );
  }

  addServiceMessageHandler(handler: (msg: Api.MessageService) => Promise<void>): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- GramJS event handler accepts async
    this.client.addEventHandler(async (update) => {
      if (
        (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) &&
        update.message instanceof Api.MessageService
      ) {
        await handler(update.message as Api.MessageService);
      }
    });
  }

  addCallbackQueryHandler(handler: (event: unknown) => Promise<void>): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- GramJS event handler accepts async
    this.client.addEventHandler(async (update) => {
      if (
        update.className === "UpdateBotCallbackQuery" ||
        update.className === "UpdateInlineBotCallbackQuery"
      ) {
        await handler(update);
      }
    });
  }

  async answerCallbackQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GramJS BigInteger queryId
    queryId: any,
    options?: {
      message?: string;
      alert?: boolean;
      url?: string;
    }
  ): Promise<boolean> {
    try {
      await this.client.invoke(
        new Api.messages.SetBotCallbackAnswer({
          queryId: queryId,
          message: options?.message,
          alert: options?.alert,
          url: options?.url,
        })
      );
      return true;
    } catch (error) {
      log.error({ err: error }, "Error answering callback query");
      return false;
    }
  }

  async sendMessage(
    entity: string | Api.TypePeer,
    options: {
      message: string;
      replyTo?: number;
      silent?: boolean;
      parseMode?: "html" | "md" | "md2" | "none";
    }
  ): Promise<Api.Message> {
    const parseMode = options.parseMode ?? "html";
    const formattedMessage =
      parseMode === "html" ? markdownToTelegramHtml(options.message) : options.message;

    return withFloodRetry(() =>
      this.client.sendMessage(entity, {
        message: formattedMessage,
        replyTo: options.replyTo,
        silent: options.silent,
        parseMode: parseMode === "none" ? undefined : parseMode,
        linkPreview: false,
      })
    );
  }

  async getMessages(
    entity: string | Api.TypePeer,
    options?: {
      limit?: number;
      offsetId?: number;
      search?: string;
    }
  ): Promise<Api.Message[]> {
    const messages = await this.client.getMessages(entity, {
      limit: options?.limit ?? 100,
      offsetId: options?.offsetId,
      search: options?.search,
    });
    return messages;
  }

  async getDialogs(): Promise<
    Array<{
      id: bigint;
      title: string;
      isGroup: boolean;
      isChannel: boolean;
    }>
  > {
    const dialogs = await this.client.getDialogs({});
    return dialogs.map((d) => ({
      id: BigInt(d.id?.toString() ?? "0"),
      title: d.title ?? "Unknown",
      isGroup: d.isGroup,
      isChannel: d.isChannel,
    }));
  }

  async setTyping(entity: string): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.SetTyping({
          peer: entity,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch {
      // setTyping() is cosmetic — ignore FloodWait, permission errors, etc.
    }
  }

  async resolveUsername(username: string): Promise<Api.TypeUser | Api.TypeChat | undefined> {
    const clean = username.replace("@", "");
    try {
      // Call ResolveUsername directly — bypasses GramJS's VALID_USERNAME_RE
      // which rejects collectible usernames shorter than 5 chars.
      const result = await this.client.invoke(
        new Api.contacts.ResolveUsername({ username: clean })
      );
      return result.users[0] || result.chats[0];
    } catch (error: unknown) {
      log.error({ err: error }, `Failed to resolve username ${clean}`);
      return undefined;
    }
  }

  async getEntity(entity: string): Promise<Api.TypeUser | Api.TypeChat> {
    return await this.client.getEntity(entity);
  }
}
