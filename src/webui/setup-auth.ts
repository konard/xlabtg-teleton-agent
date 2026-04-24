/**
 * Telegram Authentication State Machine for Setup WebUI
 *
 * Manages GramJS client lifecycle across HTTP requests.
 * Uses direct API invoke (NOT client.start()) for HTTP-compatible auth.
 */

import { TelegramClient, Api } from "telegram";
import type { ProxyInterface } from "telegram/network/connection/TCPMTProxy.js";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import { TELETON_ROOT } from "../workspace/paths.js";
import { readRawConfig, writeRawConfig } from "../config/configurable-keys.js";
import { createLogger } from "../utils/logger.js";
import type { MtprotoProxyEntry } from "../config/schema.js";
import { MTPROTO_PROXY_CONNECT_TIMEOUT_MS } from "../constants/timeouts.js";

const log = createLogger("Setup");

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CODE_ATTEMPTS = 5;
const MAX_PASSWORD_ATTEMPTS = 3;

function isConfigNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Config file not found:");
}

export interface TelegramAuthSaveTarget {
  rootDir?: string;
  configPath?: string;
  sessionPath?: string;
  replaceTelegramIdentity?: boolean;
}

interface AuthenticatedUser {
  id: number;
  firstName: string;
  username?: string;
}

interface AuthSessionBase {
  id: string;
  client: TelegramClient;
  state: "code_sent" | "qr_waiting" | "2fa_required" | "authenticated" | "failed";
  passwordHint?: string;
  passwordAttempts: number;
  createdAt: number;
  apiId: number;
  apiHash: string;
  timer: ReturnType<typeof setTimeout>;
  saveTarget?: TelegramAuthSaveTarget;
}

interface PhoneAuthSession extends AuthSessionBase {
  type: "phone";
  phone: string;
  phoneCodeHash: string; // NEVER sent to frontend
  fragmentUrl?: string;
  codeLength?: number;
  codeAttempts: number;
}

interface QrAuthSession extends AuthSessionBase {
  type: "qr";
}

type AuthSession = PhoneAuthSession | QrAuthSession;

export class TelegramAuthManager {
  private session: AuthSession | null = null;

  private buildProxy(entry: MtprotoProxyEntry): ProxyInterface {
    return {
      ip: entry.server,
      port: entry.port,
      secret: entry.secret,
      MTProxy: true,
    } as ProxyInterface;
  }

  private buildClient(apiId: number, apiHash: string, proxy?: ProxyInterface): TelegramClient {
    const gramLogger = new Logger(LogLevel.NONE);
    return new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 3,
      floodSleepThreshold: 0,
      baseLogger: gramLogger,
      proxy,
    });
  }

  private async connectWithTimeout(client: TelegramClient, proxyIndex: number): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `[MTProxy] Auth proxy ${proxyIndex + 1} timed out after ${MTPROTO_PROXY_CONNECT_TIMEOUT_MS / 1000}s`
            )
          ),
        MTPROTO_PROXY_CONNECT_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([client.connect(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async createConnectedClient(
    apiId: number,
    apiHash: string,
    mtprotoProxies?: MtprotoProxyEntry[]
  ): Promise<TelegramClient> {
    const proxies = mtprotoProxies ?? [];

    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      const client = this.buildClient(apiId, apiHash, this.buildProxy(proxy));
      log.info(
        { server: proxy.server, port: proxy.port },
        `[MTProxy] Trying auth proxy ${i + 1}/${proxies.length}`
      );

      try {
        await this.connectWithTimeout(client, i);
        return client;
      } catch (error) {
        void Promise.resolve(client.disconnect()).catch(() => {});
        log.warn(
          { err: error, server: proxy.server },
          `[MTProxy] Auth proxy ${i + 1}/${proxies.length} failed, trying next`
        );
      }
    }

    if (proxies.length > 0) {
      log.warn("[MTProxy] All auth proxies failed, trying direct connection");
    }

    const client = this.buildClient(apiId, apiHash);
    await client.connect();
    return client;
  }

  /**
   * Send verification code to phone number
   */
  async sendCode(
    apiId: number,
    apiHash: string,
    phone: string,
    saveTarget?: TelegramAuthSaveTarget,
    mtprotoProxies?: MtprotoProxyEntry[]
  ): Promise<{
    authSessionId: string;
    codeDelivery: "app" | "sms" | "fragment";
    fragmentUrl?: string;
    codeLength?: number;
    expiresAt: number;
  }> {
    // Clean up any existing session
    await this.cleanup();

    const client = await this.createConnectedClient(apiId, apiHash, mtprotoProxies);

    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    if (result instanceof Api.auth.SentCodeSuccess) {
      await client.disconnect();
      throw new Error("Account already authenticated (SentCodeSuccess)");
    }

    if (!(result instanceof Api.auth.SentCode)) {
      await client.disconnect();
      throw new Error("Unexpected auth response (payment required or unknown)");
    }

    // Detect code delivery method
    let codeDelivery: "app" | "sms" | "fragment" = "sms";
    let fragmentUrl: string | undefined;
    let codeLength: number | undefined;

    if (result.type instanceof Api.auth.SentCodeTypeApp) {
      codeDelivery = "app";
      codeLength = result.type.length;
    } else if (result.type instanceof Api.auth.SentCodeTypeFragmentSms) {
      codeDelivery = "fragment";
      fragmentUrl = result.type.url;
      codeLength = result.type.length;
    } else if ("length" in result.type) {
      codeLength = result.type.length as number;
    }

    const id = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;

    this.session = {
      type: "phone",
      id,
      client,
      phone,
      phoneCodeHash: result.phoneCodeHash,
      state: "code_sent",
      fragmentUrl,
      codeLength,
      codeAttempts: 0,
      passwordAttempts: 0,
      createdAt: Date.now(),
      apiId,
      apiHash,
      saveTarget,
      timer: setTimeout(() => void this.cleanup(), SESSION_TTL_MS),
    };

    log.info("Telegram verification code sent");
    return { authSessionId: id, codeDelivery, fragmentUrl, codeLength, expiresAt };
  }

  /**
   * Verify the code entered by the user
   */
  async verifyCode(
    authSessionId: string,
    code: string
  ): Promise<{
    status: "authenticated" | "2fa_required" | "invalid_code" | "expired" | "too_many_attempts";
    user?: { id: number; firstName: string; username?: string };
    passwordHint?: string;
  }> {
    const session = this.getSession(authSessionId);
    if (!session || session.type !== "phone") return { status: "expired" };

    if (session.codeAttempts >= MAX_CODE_ATTEMPTS) {
      return { status: "too_many_attempts" };
    }

    session.codeAttempts++;

    try {
      const result = await session.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: session.phone,
          phoneCodeHash: session.phoneCodeHash,
          phoneCode: code,
        })
      );

      // Success - save session
      session.state = "authenticated";
      const user = this.extractUser(result);
      await this.saveSession(session, user);
      log.info("Telegram authentication successful");
      return { status: "authenticated", user };
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };

      if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        session.state = "2fa_required";
        // Get password hint
        try {
          const passwordResult = await session.client.invoke(new Api.account.GetPassword());
          session.passwordHint = passwordResult.hint ?? undefined;
        } catch {
          // No hint available
        }
        return { status: "2fa_required", passwordHint: session.passwordHint };
      }

      if (error.errorMessage === "PHONE_CODE_INVALID") {
        return { status: "invalid_code" };
      }

      if (error.errorMessage === "PHONE_CODE_EXPIRED") {
        session.state = "failed";
        return { status: "expired" };
      }

      throw err;
    }
  }

  /**
   * Verify 2FA password
   */
  async verifyPassword(
    authSessionId: string,
    password: string
  ): Promise<{
    status: "authenticated" | "invalid_password" | "expired" | "too_many_attempts";
    user?: { id: number; firstName: string; username?: string };
  }> {
    const session = this.getSession(authSessionId);
    if (!session) return { status: "expired" };
    if (session.state !== "2fa_required") return { status: "expired" };

    if (session.passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
      return { status: "too_many_attempts" };
    }

    session.passwordAttempts++;

    try {
      const srpResult = await session.client.invoke(new Api.account.GetPassword());
      const srpCheck = await computeCheck(srpResult, password);
      const result = await session.client.invoke(
        new Api.auth.CheckPassword({ password: srpCheck })
      );

      session.state = "authenticated";
      const user = this.extractUser(result);
      await this.saveSession(session, user);
      log.info("Telegram 2FA authentication successful");
      return { status: "authenticated", user };
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };

      if (error.errorMessage === "PASSWORD_HASH_INVALID") {
        return { status: "invalid_password" };
      }

      throw err;
    }
  }

  /**
   * Resend verification code
   */
  async resendCode(authSessionId: string): Promise<{
    codeDelivery: "app" | "sms" | "fragment";
    fragmentUrl?: string;
    codeLength?: number;
  } | null> {
    const session = this.getSession(authSessionId);
    if (!session || session.type !== "phone" || session.state !== "code_sent") return null;

    const result = await session.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: session.phone,
        phoneCodeHash: session.phoneCodeHash,
      })
    );

    // ResendCode returns TypeSentCode (SentCode | SentCodeSuccess)
    if (result instanceof Api.auth.SentCode) {
      session.phoneCodeHash = result.phoneCodeHash;
      session.codeAttempts = 0;

      let codeDelivery: "app" | "sms" | "fragment" = "sms";
      let fragmentUrl: string | undefined;
      let codeLength: number | undefined;

      if (result.type instanceof Api.auth.SentCodeTypeApp) {
        codeDelivery = "app";
        codeLength = result.type.length;
      } else if (result.type instanceof Api.auth.SentCodeTypeFragmentSms) {
        codeDelivery = "fragment";
        fragmentUrl = result.type.url;
        codeLength = result.type.length;
      } else if ("length" in result.type) {
        codeLength = result.type.length as number;
      }

      session.fragmentUrl = fragmentUrl;
      session.codeLength = codeLength;

      return { codeDelivery, fragmentUrl, codeLength };
    }

    // SentCodeSuccess means already authenticated
    return { codeDelivery: "sms" };
  }

  /**
   * Start QR code authentication session
   */
  async startQrSession(
    apiId: number,
    apiHash: string,
    saveTarget?: TelegramAuthSaveTarget,
    mtprotoProxies?: MtprotoProxyEntry[]
  ): Promise<{
    authSessionId: string;
    token: string;
    expires: number;
    expiresAt: number;
  }> {
    await this.cleanup();

    const client = await this.createConnectedClient(apiId, apiHash, mtprotoProxies);

    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId,
        apiHash,
        exceptIds: [],
      })
    );

    if (!(result instanceof Api.auth.LoginToken)) {
      await client.disconnect();
      throw new Error("Unexpected QR auth response");
    }

    const id = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;

    this.session = {
      type: "qr",
      id,
      client,
      state: "qr_waiting",
      passwordAttempts: 0,
      createdAt: Date.now(),
      apiId,
      apiHash,
      saveTarget,
      timer: setTimeout(() => void this.cleanup(), SESSION_TTL_MS),
    };

    log.info("QR code authentication session started");
    return {
      authSessionId: id,
      token: result.token.toString("base64url"),
      expires: result.expires,
      expiresAt,
    };
  }

  /**
   * Refresh QR token / check if scanned
   */
  async refreshQrToken(authSessionId: string): Promise<{
    status: "waiting" | "authenticated" | "2fa_required" | "expired";
    token?: string;
    expires?: number;
    user?: { id: number; firstName: string; username?: string };
    passwordHint?: string;
  }> {
    const session = this.getSession(authSessionId);
    if (!session || session.type !== "qr") return { status: "expired" };

    if (session.state === "2fa_required") {
      return { status: "2fa_required", passwordHint: session.passwordHint };
    }

    try {
      const result = await session.client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: session.apiId,
          apiHash: session.apiHash,
          exceptIds: [],
        })
      );

      // QR was scanned — auth complete
      if (result instanceof Api.auth.LoginTokenSuccess) {
        session.state = "authenticated";
        const user = this.extractUser(result.authorization);
        await this.saveSession(session, user);
        log.info("QR code authentication successful");
        return { status: "authenticated", user };
      }

      // DC migration needed
      if (result instanceof Api.auth.LoginTokenMigrateTo) {
        await (session.client as unknown as { _switchDC(dc: number): Promise<void> })._switchDC(
          result.dcId
        );
        const imported = await session.client.invoke(
          new Api.auth.ImportLoginToken({ token: result.token })
        );
        if (imported instanceof Api.auth.LoginTokenSuccess) {
          session.state = "authenticated";
          const user = this.extractUser(imported.authorization);
          await this.saveSession(session, user);
          log.info("QR code authentication successful (after DC migration)");
          return { status: "authenticated", user };
        }
      }

      // Still waiting — return fresh token
      if (result instanceof Api.auth.LoginToken) {
        return {
          status: "waiting",
          token: result.token.toString("base64url"),
          expires: result.expires,
        };
      }

      return { status: "waiting" };
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };

      if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        session.state = "2fa_required";
        try {
          const passwordResult = await session.client.invoke(new Api.account.GetPassword());
          session.passwordHint = passwordResult.hint ?? undefined;
        } catch {
          // No hint available
        }
        return { status: "2fa_required", passwordHint: session.passwordHint };
      }

      throw err;
    }
  }

  /**
   * Cancel and clean up session
   */
  async cancelSession(authSessionId: string): Promise<void> {
    if (this.getSession(authSessionId)) {
      await this.cleanup();
    }
  }

  /**
   * Clean up: disconnect client, clear timer, remove session
   */
  async cleanup(): Promise<void> {
    if (!this.session) return;

    clearTimeout(this.session.timer);

    try {
      if (this.session.client.connected) {
        await this.session.client.disconnect();
      }
    } catch (err) {
      log.warn({ err }, "Error disconnecting auth client");
    }

    this.session = null;
  }

  private getSession(id: string): AuthSession | null {
    if (!this.session || this.session.id !== id) return null;
    // Check TTL
    if (Date.now() - this.session.createdAt > SESSION_TTL_MS) {
      void this.cleanup();
      return null;
    }
    return this.session;
  }

  private extractUser(result: Api.auth.TypeAuthorization): AuthenticatedUser | undefined {
    if (result instanceof Api.auth.Authorization && result.user instanceof Api.User) {
      return {
        id: Number(result.user.id),
        firstName: result.user.firstName ?? "",
        username: result.user.username ?? undefined,
      };
    }
    return undefined;
  }

  private async saveSession(session: AuthSession, user?: AuthenticatedUser): Promise<void> {
    const sessionString = session.client.session.save() as unknown as string;
    const rootDir = session.saveTarget?.rootDir ?? TELETON_ROOT;
    const sessionPath = session.saveTarget?.sessionPath ?? join(rootDir, "telegram_session.txt");

    const dir = dirname(sessionPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(sessionPath, sessionString, { mode: 0o600 });

    // Persist telegram credentials to config.yaml when it already exists. During
    // the primary setup wizard, authentication happens before /config/save.
    const configPath = session.saveTarget?.configPath ?? join(rootDir, "config.yaml");
    let configSaved = false;
    try {
      const raw = readRawConfig(configPath);
      raw.telegram = raw.telegram ?? {};
      raw.telegram.api_id = session.apiId;
      raw.telegram.api_hash = session.apiHash;
      raw.telegram.session_path = sessionPath;
      if (session.type === "phone") {
        raw.telegram.phone = session.phone;
      }
      if (user) {
        if (session.saveTarget?.replaceTelegramIdentity) {
          raw.telegram.owner_id = user.id;
          raw.telegram.owner_name = user.firstName;
          if (user.username) {
            raw.telegram.owner_username = user.username;
          } else {
            delete raw.telegram.owner_username;
          }
          raw.telegram.admin_ids = [user.id];
        } else {
          raw.telegram.owner_id = raw.telegram.owner_id ?? user.id;
          raw.telegram.owner_name = raw.telegram.owner_name ?? user.firstName;
          raw.telegram.owner_username = raw.telegram.owner_username ?? user.username;
          const adminIds = Array.isArray(raw.telegram.admin_ids) ? raw.telegram.admin_ids : [];
          raw.telegram.admin_ids = [...new Set([...adminIds, user.id])];
        }
      }
      writeRawConfig(raw, configPath);
      configSaved = true;
    } catch (err) {
      if (session.saveTarget?.configPath || !isConfigNotFoundError(err)) {
        throw err;
      }
      log.info({ configPath }, "Config file not created yet; setup will save it later");
    }

    log.info(
      configSaved
        ? "Telegram session and credentials saved"
        : "Telegram session saved; credentials pending setup config save"
    );
  }
}
