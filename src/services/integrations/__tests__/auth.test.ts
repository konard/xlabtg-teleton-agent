import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { IntegrationAuthManager } from "../auth.js";
import { ensureIntegrationTables } from "../storage.js";

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => dnsMocks);

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("IntegrationAuthManager — WORK4-003 regression", () => {
  let db: Database.Database;
  const originalEnv = process.env.TELETON_INTEGRATIONS_KEY;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureIntegrationTables(db);
    db.prepare(
      `INSERT INTO integrations (id, name, type, provider) VALUES ('svc', 'Test', 'api', 'custom-http')`
    ).run();
    dnsMocks.lookup.mockReset();
    dnsMocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    delete process.env.TELETON_INTEGRATIONS_KEY;
  });

  afterEach(() => {
    db.close();
    if (originalEnv !== undefined) {
      process.env.TELETON_INTEGRATIONS_KEY = originalEnv;
    } else {
      delete process.env.TELETON_INTEGRATIONS_KEY;
    }
  });

  it("does not persist the integrations AES key inside memory.db by default", () => {
    process.env.TELETON_INTEGRATIONS_KEY = "";
    new IntegrationAuthManager(db);
    const row = db
      .prepare("SELECT value FROM security_settings WHERE key = 'integration_credentials_key'")
      .get();
    expect(row).toBeUndefined();
  });

  it("does not persist the AES key when TELETON_INTEGRATIONS_KEY is unset", () => {
    new IntegrationAuthManager(db);
    const row = db
      .prepare("SELECT value FROM security_settings WHERE key = 'integration_credentials_key'")
      .get();
    expect(row).toBeUndefined();
  });

  it("refuses to create credentials when no encryption key is configured", () => {
    const manager = new IntegrationAuthManager(db);

    expect(() =>
      manager.createCredential({
        integrationId: "svc",
        authType: "api_key",
        credentials: { apiKey: "shared-secret" },
      })
    ).toThrow(/TELETON_INTEGRATIONS_KEY|integrations\.credential_key/i);

    const row = db.prepare("SELECT id FROM integration_credentials").get();
    expect(row).toBeUndefined();
  });

  it("refuses to read stored credentials when no encryption key is configured", () => {
    const writer = new IntegrationAuthManager(db, "a".repeat(64));
    const credential = writer.createCredential({
      integrationId: "svc",
      authType: "api_key",
      credentials: { apiKey: "shared-secret" },
    });

    const reader = new IntegrationAuthManager(db);

    expect(() => reader.getCredential(credential.id)).toThrow(
      /TELETON_INTEGRATIONS_KEY|integrations\.credential_key/i
    );
    expect(() => reader.listCredentials("svc")).toThrow(
      /TELETON_INTEGRATIONS_KEY|integrations\.credential_key/i
    );
  });

  it("encrypts and decrypts credentials using an explicit key", () => {
    const key = "a".repeat(64);
    const manager = new IntegrationAuthManager(db, key);

    const cred = manager.createCredential({
      integrationId: "svc",
      authType: "api_key",
      credentials: { apiKey: "secret-value" },
    });

    const retrieved = manager.getCredential(cred.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.credentials.apiKey).toBe("secret-value");
  });

  it("encrypts and decrypts credentials using TELETON_INTEGRATIONS_KEY env var", () => {
    process.env.TELETON_INTEGRATIONS_KEY = "b".repeat(64);
    const manager = new IntegrationAuthManager(db);

    const cred = manager.createCredential({
      integrationId: "svc",
      authType: "api_key",
      credentials: { apiKey: "env-secret" },
    });

    const retrieved = manager.getCredential(cred.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.credentials.apiKey).toBe("env-secret");
  });

  it("exchanges OAuth codes through a pinned fetch dispatcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read",
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const manager = new IntegrationAuthManager(db, "a".repeat(64));

    const credential = await manager.exchangeOAuthCode({
      integrationId: "svc",
      tokenUrl: "https://oauth.example.com/token",
      clientId: "client-id",
      code: "oauth-code",
      redirectUri: "https://teleton.example.com/oauth/callback",
    });

    expect(dnsMocks.lookup).toHaveBeenCalledWith("oauth.example.com", {
      all: true,
      verbatim: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { dispatcher?: unknown }];
    expect(String(url)).toBe("https://oauth.example.com/token");
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(credential.credentials).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      tokenUrl: "https://oauth.example.com/token",
    });
  });

  it("rejects OAuth tokenUrl values targeting metadata IPs before fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const manager = new IntegrationAuthManager(db, "a".repeat(64));

    await expect(
      manager.exchangeOAuthCode({
        integrationId: "svc",
        tokenUrl: "https://169.254.169.254/latest/meta-data/",
        clientId: "client-id",
        code: "oauth-code",
        redirectUri: "https://teleton.example.com/oauth/callback",
      })
    ).rejects.toThrow(/private|loopback|metadata|not allowed/i);

    expect(fetchMock).not.toHaveBeenCalled();
    const row = db.prepare("SELECT id FROM integration_credentials").get();
    expect(row).toBeUndefined();
  });

  it("rejects OAuth tokenUrl values whose hostname resolves to metadata IPs", async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const manager = new IntegrationAuthManager(db, "a".repeat(64));

    await expect(
      manager.exchangeOAuthCode({
        integrationId: "svc",
        tokenUrl: "https://rebind.example.com/oauth/token",
        clientId: "client-id",
        code: "oauth-code",
        redirectUri: "https://teleton.example.com/oauth/callback",
      })
    ).rejects.toThrow(/private|loopback|metadata|not allowed/i);

    expect(dnsMocks.lookup).toHaveBeenCalledWith("rebind.example.com", {
      all: true,
      verbatim: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = db.prepare("SELECT id FROM integration_credentials").get();
    expect(row).toBeUndefined();
  });
});
