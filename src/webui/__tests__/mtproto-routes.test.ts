import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WebUIServerDeps } from "../types.js";

const { mockExistsSync, mockReadFileSync, mockStatSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock("../../telegram/mtproto-proxy-health.js", () => ({
  checkMtprotoProxies: vi.fn(),
  uncheckedMtprotoProxyStatuses: vi.fn((proxies, reason, activeProxyIndex) =>
    proxies.map((proxy: { server: string; port: number }, index: number) => ({
      index,
      server: proxy.server,
      port: proxy.port,
      active: activeProxyIndex === index,
      status: "unchecked",
      available: null,
      latencyMs: null,
      error: reason,
      checkedAt: null,
    }))
  ),
}));

import {
  checkMtprotoProxies,
  uncheckedMtprotoProxyStatuses,
} from "../../telegram/mtproto-proxy-health.js";
import { createMtprotoRoutes } from "../routes/mtproto.js";

const proxies = [
  { server: "proxy1.example.com", port: 443, secret: "a".repeat(32) },
  { server: "proxy2.example.com", port: 8443, secret: "b".repeat(32) },
];

function buildApp(config: Record<string, unknown>, bridgeOverrides: Record<string, unknown> = {}) {
  const deps = {
    agent: { getConfig: () => config },
    bridge: {
      isAvailable: vi.fn(() => true),
      getActiveProxyIndex: vi.fn(() => 1),
      ...bridgeOverrides,
    },
    configPath: "/tmp/config.yaml",
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/mtproto", createMtprotoRoutes(deps));
  return app;
}

describe("MTProto routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
    mockStatSync.mockReturnValue({ isDirectory: () => false });
    vi.mocked(checkMtprotoProxies).mockResolvedValue([
      {
        index: 0,
        server: "proxy1.example.com",
        port: 443,
        active: false,
        status: "available",
        available: true,
        latencyMs: 42,
        error: null,
        checkedAt: "2026-04-24T14:00:00.000Z",
      },
      {
        index: 1,
        server: "proxy2.example.com",
        port: 8443,
        active: true,
        status: "unavailable",
        available: false,
        latencyMs: null,
        error: "proxy refused connection",
        checkedAt: "2026-04-24T14:00:00.000Z",
      },
    ]);
  });

  it("returns per-proxy availability and latency without exposing proxy secrets", async () => {
    const app = buildApp({
      telegram: { api_id: 12345, api_hash: "hash" },
      mtproto: { enabled: true, proxies },
    });

    const res = await app.request("/mtproto/status");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.activeProxy).toEqual({
      server: "proxy2.example.com",
      port: 8443,
      index: 1,
    });
    expect(json.data.proxies).toHaveLength(2);
    expect(json.data.proxies[0]).toMatchObject({
      index: 0,
      server: "proxy1.example.com",
      port: 443,
      status: "available",
      latencyMs: 42,
    });
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa");
    expect(JSON.stringify(json)).not.toContain("bbbbbbbb");
    expect(checkMtprotoProxies).toHaveBeenCalledWith({
      apiId: 12345,
      apiHash: "hash",
      proxies,
      activeProxyIndex: 1,
    });
  });

  it("passes the saved Telegram session to proxy health checks for authenticated validation", async () => {
    mockExistsSync.mockImplementation((path) => path === "/tmp/teleton-session.txt");
    mockReadFileSync.mockReturnValue(" saved-session \n");
    const app = buildApp({
      telegram: {
        api_id: 12345,
        api_hash: "hash",
        session_path: "/tmp/teleton-session.txt",
      },
      mtproto: { enabled: true, proxies },
    });

    const res = await app.request("/mtproto/status");

    expect(res.status).toBe(200);
    expect(checkMtprotoProxies).toHaveBeenCalledWith({
      apiId: 12345,
      apiHash: "hash",
      proxies,
      activeProxyIndex: 1,
      sessionString: "saved-session",
    });
  });

  it("marks proxy checks as unchecked when Telegram API credentials are missing", async () => {
    const app = buildApp({
      telegram: { api_id: 0, api_hash: "" },
      mtproto: { enabled: true, proxies },
    });

    const res = await app.request("/mtproto/status");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.proxies[0].status).toBe("unchecked");
    expect(json.data.proxies[0].error).toContain("Telegram API ID and hash");
    expect(checkMtprotoProxies).not.toHaveBeenCalled();
    expect(uncheckedMtprotoProxyStatuses).toHaveBeenCalledWith(
      proxies,
      "Telegram API ID and hash are required before proxy checks can run",
      1
    );
  });

  it("rejects unsupported TLS-emulation MTProto proxy secrets", async () => {
    const app = buildApp({
      telegram: { api_id: 12345, api_hash: "hash" },
      mtproto: { enabled: true, proxies: [] },
    });

    const res = await app.request("/mtproto/proxies", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proxies: [
          {
            server: "proxy.example.com",
            port: 443,
            secret: `ee${"a".repeat(32)}6578616d706c652e636f6d`,
          },
        ],
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("TLS-emulation");
  });
});
