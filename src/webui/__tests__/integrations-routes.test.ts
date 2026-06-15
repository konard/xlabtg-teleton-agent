import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { createIntegrationsRoutes } from "../routes/integrations.js";
import type { WebUIServerDeps } from "../types.js";

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => dnsMocks);

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createApp(db: Database.Database, credentialKey?: string): Hono {
  const deps = {
    memory: { db },
    bridge: { isAvailable: () => true },
    mcpServers: () => [],
    marketplace: credentialKey
      ? {
          config: {
            integrations: {
              credential_key: credentialKey,
              global_rate_limit: {},
            },
          },
        }
      : undefined,
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/api/integrations", createIntegrationsRoutes(deps));
  return app;
}

describe("Integrations routes", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    app = createApp(db);
    dnsMocks.lookup.mockReset();
    dnsMocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it("lists built-in catalog entries", async () => {
    const res = await app.request("/api/integrations/catalog");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.map((entry: { id: string }) => entry.id)).toContain("github");
  });

  it("creates and lists a custom integration", async () => {
    const createRes = await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "ops-api",
        name: "Ops API",
        type: "api",
        provider: "custom-http",
        config: { baseUrl: "https://ops.example.com" },
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.data).toMatchObject({ id: "ops-api", name: "Ops API" });

    const listRes = await app.request("/api/integrations");
    const list = await listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].stats).toMatchObject({ requestCount: 0 });
  });

  it("creates masked credentials without leaking the plaintext value", async () => {
    app = createApp(db, "route-test-master-key");

    await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "github-main",
        name: "GitHub Main",
        type: "api",
        provider: "github",
        config: { baseUrl: "https://api.github.com" },
      }),
    });

    const credentialRes = await app.request("/api/integrations/github-main/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authType: "api_key",
        credentials: { apiKey: "ghp_plaintext_secret", headerName: "Authorization" },
      }),
    });

    expect(credentialRes.status).toBe(201);
    const credential = await credentialRes.json();
    expect(JSON.stringify(credential)).not.toContain("ghp_plaintext_secret");

    const raw = db.prepare("SELECT credentials_encrypted FROM integration_credentials").get() as {
      credentials_encrypted: string;
    };
    expect(raw.credentials_encrypted).not.toContain("ghp_plaintext_secret");
  });

  it("refuses to create credentials when no encryption key is configured", async () => {
    await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "github-main",
        name: "GitHub Main",
        type: "api",
        provider: "github",
        config: { baseUrl: "https://api.github.com" },
      }),
    });

    const credentialRes = await app.request("/api/integrations/github-main/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authType: "api_key",
        credentials: { apiKey: "ghp_plaintext_secret", headerName: "Authorization" },
      }),
    });

    expect(credentialRes.status).toBe(500);
    const body = await credentialRes.json();
    expect(body.error).toMatch(/TELETON_INTEGRATIONS_KEY|integrations\.credential_key/i);

    const row = db.prepare("SELECT id FROM integration_credentials").get();
    expect(row).toBeUndefined();
  });

  it("validates unsupported integration types", async () => {
    const res = await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad",
        type: "ftp",
        provider: "custom-http",
        config: {},
      }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("type");
  });

  it("returns an OAuth authorization URL for an integration", async () => {
    await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "notion-main",
        name: "Notion Main",
        type: "oauth",
        provider: "notion",
        config: { baseUrl: "https://api.notion.com/v1" },
      }),
    });

    const res = await app.request("/api/integrations/notion-main/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
        clientId: "client-123",
        redirectUri: "https://teleton.example.com/oauth/callback",
        scopes: ["read"],
        state: "abc",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const url = new URL(json.data.authorizationUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toBe("read");
  });

  it("rejects OAuth token exchange requests targeting metadata IPs before fetch", async () => {
    app = createApp(db, "route-test-master-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "notion-main",
        name: "Notion Main",
        type: "oauth",
        provider: "notion",
        config: { baseUrl: "https://api.notion.com/v1" },
      }),
    });

    const res = await app.request("/api/integrations/notion-main/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenUrl: "https://169.254.169.254/latest/meta-data/",
        clientId: "client-123",
        code: "oauth-code",
        redirectUri: "https://teleton.example.com/oauth/callback",
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/private|loopback|metadata|not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects OAuth token exchange requests when tokenUrl resolves to metadata IPs", async () => {
    app = createApp(db, "route-test-master-key");
    dnsMocks.lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await app.request("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "notion-main",
        name: "Notion Main",
        type: "oauth",
        provider: "notion",
        config: { baseUrl: "https://api.notion.com/v1" },
      }),
    });

    const res = await app.request("/api/integrations/notion-main/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenUrl: "https://rebind.example.com/oauth/token",
        clientId: "client-123",
        code: "oauth-code",
        redirectUri: "https://teleton.example.com/oauth/callback",
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/private|loopback|metadata|not allowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
