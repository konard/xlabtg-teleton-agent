import type Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type CreateCredentialInput,
  type IntegrationAuthConfig,
  type IntegrationCredential,
  isIntegrationAuthType,
} from "./base.js";
import { ensureIntegrationTables } from "./storage.js";
import { createPinnedOutboundFetch, validateResolvedOutboundUrl } from "../outbound-url-guard.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("IntegrationAuth");
const OAUTH_TOKEN_URL_GUARD = { allowedProtocols: ["https:"] as const, label: "OAuth token URL" };

interface CredentialRow {
  id: string;
  integration_id: string;
  auth_type: string;
  credentials_encrypted: string;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OAuthAuthorizeInput {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
  extraParams?: Record<string, string>;
}

export interface OAuthTokenInput {
  integrationId: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

const SECRET_KEYS = new Set([
  "apiKey",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "password",
  "token",
  "jwt",
  "value",
]);

const MISSING_CREDENTIAL_KEY_ERROR =
  "Integration credential encryption key is required. Set TELETON_INTEGRATIONS_KEY " +
  "or integrations.credential_key before storing or reading integration credentials.";

export async function validateOAuthTokenUrl(raw: string): Promise<void> {
  await validateResolvedOutboundUrl(raw, OAUTH_TOKEN_URL_GUARD);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function deriveKey(material: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(material)) {
    return Buffer.from(material, "hex");
  }
  return createHash("sha256").update(material).digest();
}

function warnNoKey(): void {
  log.warn(
    `${MISSING_CREDENTIAL_KEY_ERROR} Credential storage and reads are disabled until a key is configured.`
  );
}

function encryptJson(value: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptJson(payload: string, key: Buffer): Record<string, unknown> {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Unsupported credential payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

function rowToCredential(row: CredentialRow, key: Buffer): IntegrationCredential {
  if (!isIntegrationAuthType(row.auth_type)) {
    throw new Error(`Unsupported credential auth type: ${row.auth_type}`);
  }
  return {
    id: row.id,
    integrationId: row.integration_id,
    authType: row.auth_type,
    credentials: decryptJson(row.credentials_encrypted, key),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function maskSecret(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}...${value.slice(-2)}`;
}

function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(credentials)) {
    masked[key] = SECRET_KEYS.has(key) ? maskSecret(value) : value;
  }
  return masked;
}

export class IntegrationAuthManager {
  private readonly db: Database.Database;
  private readonly key: Buffer | null;

  constructor(db: Database.Database, keyMaterial?: string) {
    ensureIntegrationTables(db);
    this.db = db;
    const material = keyMaterial || process.env.TELETON_INTEGRATIONS_KEY || "";
    this.key = material ? deriveKey(material) : null;
    if (!this.key) {
      warnNoKey();
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error(MISSING_CREDENTIAL_KEY_ERROR);
    }
    return this.key;
  }

  createCredential(input: CreateCredentialInput): IntegrationCredential {
    const key = this.requireKey();
    if (!isIntegrationAuthType(input.authType)) {
      throw new Error(`Unsupported auth type: ${String(input.authType)}`);
    }
    const id = randomUUID();
    const now = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO integration_credentials (
           id, integration_id, auth_type, credentials_encrypted, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.integrationId,
        input.authType,
        encryptJson(input.credentials, key),
        input.expiresAt ?? null,
        now,
        now
      );
    const created = this.getCredential(id);
    if (!created) throw new Error(`Credential ${id} not found after insert`);
    return created;
  }

  getCredential(id: string): IntegrationCredential | null {
    const key = this.requireKey();
    const row = this.db.prepare("SELECT * FROM integration_credentials WHERE id = ?").get(id) as
      | CredentialRow
      | undefined;
    return row ? rowToCredential(row, key) : null;
  }

  listCredentials(integrationId: string): IntegrationCredential[] {
    const key = this.requireKey();
    const rows = this.db
      .prepare(
        "SELECT * FROM integration_credentials WHERE integration_id = ? ORDER BY created_at DESC"
      )
      .all(integrationId) as CredentialRow[];
    return rows.map((row) => {
      const credential = rowToCredential(row, key);
      return { ...credential, credentials: maskCredentials(credential.credentials) };
    });
  }

  deleteCredential(id: string): boolean {
    const result = this.db.prepare("DELETE FROM integration_credentials WHERE id = ?").run(id);
    return result.changes > 0;
  }

  buildOAuthAuthorizationUrl(input: OAuthAuthorizeInput): string {
    const url = new URL(input.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    if (input.scopes?.length) url.searchParams.set("scope", input.scopes.join(" "));
    if (input.state) url.searchParams.set("state", input.state);
    for (const [key, value] of Object.entries(input.extraParams ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async exchangeOAuthCode(input: OAuthTokenInput): Promise<IntegrationCredential> {
    const token = await requestOAuthToken(input.tokenUrl, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    });
    return this.createCredential({
      integrationId: input.integrationId,
      authType: "oauth2",
      credentials: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        tokenUrl: input.tokenUrl,
        clientId: input.clientId,
        ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
        scope: token.scope,
      },
      expiresAt: token.expiresIn ? nowSeconds() + token.expiresIn : null,
    });
  }

  async refreshOAuthCredential(id: string): Promise<IntegrationCredential> {
    const existing = this.getCredential(id);
    if (!existing || existing.authType !== "oauth2") {
      throw new Error("OAuth credential not found");
    }
    const refreshToken = readString(existing.credentials, "refreshToken");
    const tokenUrl = readString(existing.credentials, "tokenUrl");
    const clientId = readString(existing.credentials, "clientId");
    const clientSecret = readOptionalString(existing.credentials, "clientSecret");
    const token = await requestOAuthToken(tokenUrl, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    const nextCredentials = {
      ...existing.credentials,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? refreshToken,
      tokenType: token.tokenType,
      scope: token.scope ?? existing.credentials.scope,
    };
    const now = nowSeconds();
    const key = this.requireKey();
    this.db
      .prepare(
        `UPDATE integration_credentials SET
           credentials_encrypted = ?,
           expires_at = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        encryptJson(nextCredentials, key),
        token.expiresIn ? now + token.expiresIn : existing.expiresAt,
        now,
        id
      );
    const refreshed = this.getCredential(id);
    if (!refreshed) throw new Error("OAuth credential disappeared after refresh");
    return refreshed;
  }

  async resolveHeaders(
    credentialId: string | null | undefined,
    auth: IntegrationAuthConfig
  ): Promise<Record<string, string>> {
    if (!credentialId || auth.type === "none") return {};
    const credential = this.getCredential(credentialId);
    if (!credential) throw new Error("Integration credential not found");

    if (credential.authType === "api_key") {
      const apiKey = readString(credential.credentials, "apiKey");
      const headerName =
        readOptionalString(credential.credentials, "headerName") ||
        auth.headerName ||
        "Authorization";
      const prefix = readOptionalString(credential.credentials, "prefix") || auth.prefix;
      return { [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey };
    }

    if (credential.authType === "jwt") {
      const token = readString(credential.credentials, "token");
      return { [auth.headerName || "Authorization"]: `${auth.prefix || "Bearer"} ${token}` };
    }

    if (credential.authType === "basic") {
      const username = readString(credential.credentials, "username");
      const password = readString(credential.credentials, "password");
      return {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
      };
    }

    if (credential.authType === "custom_header") {
      const headerName = readString(credential.credentials, "headerName");
      const value = readString(credential.credentials, "value");
      return { [headerName]: value };
    }

    if (credential.authType === "oauth2") {
      const active =
        credential.expiresAt && credential.expiresAt <= nowSeconds() + 60
          ? await this.refreshOAuthCredential(credential.id)
          : credential;
      const accessToken = readString(active.credentials, "accessToken");
      const tokenType = readOptionalString(active.credentials, "tokenType") || "Bearer";
      return { Authorization: `${tokenType} ${accessToken}` };
    }

    return {};
  }
}

async function requestOAuthToken(
  tokenUrl: string,
  params: Record<string, string>
): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}> {
  const target = await createPinnedOutboundFetch(tokenUrl, OAUTH_TOKEN_URL_GUARD);
  try {
    const response = await target.fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    if (!response.ok) {
      throw new Error(`OAuth token request failed with HTTP ${response.status}`);
    }
    const json = (await response.json()) as OAuthTokenResponse;
    if (typeof json.access_token !== "string" || json.access_token.length === 0) {
      throw new Error("OAuth token response did not include access_token");
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
      scope: typeof json.scope === "string" ? json.scope : undefined,
    };
  } finally {
    await target.close();
  }
}

function readString(credentials: Record<string, unknown>, key: string): string {
  const value = credentials[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Credential field "${key}" is required`);
  }
  return value;
}

function readOptionalString(credentials: Record<string, unknown>, key: string): string | undefined {
  const value = credentials[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
