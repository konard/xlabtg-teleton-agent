import { describe, expect, it, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { createMarketplaceRoutes } from "../routes/marketplace.js";
import type { WebUIServerDeps } from "../types.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../agent/tools/plugin-loader.js", () => ({
  adaptPlugin: vi.fn(),
  ensurePluginDeps: vi.fn(),
}));

vi.mock("../../sdk/secrets.js", () => ({
  deletePluginSecret: vi.fn(),
  listPluginSecretKeys: vi.fn(() => []),
  writePluginSecret: vi.fn(),
}));

vi.mock("../../config/configurable-keys.js", () => ({
  readRawConfig: vi.fn(),
  writeRawConfig: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createApp(fetchMock: ReturnType<typeof vi.fn>, marketplaceOverrides = {}) {
  vi.stubGlobal("fetch", fetchMock);

  const deps = {
    plugins: [],
    configPath: "config.test.yaml",
    toolRegistry: {
      getModuleTools: vi.fn(() => []),
      getAll: vi.fn(() => []),
      isPluginModule: vi.fn(() => false),
    },
    marketplace: {
      modules: [],
      config: {
        marketplace: {
          extra_sources: [],
        },
      },
      sdkDeps: {},
      pluginContext: {},
      loadedModuleNames: [],
      rewireHooks: vi.fn(),
      ...marketplaceOverrides,
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/marketplace", createMarketplaceRoutes(deps));
  return app;
}

describe("Marketplace routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads custom sources whose enabled flag is omitted and normalizes optional entry fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (
        url === "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main/registry.json"
      ) {
        return jsonResponse({ version: "1.0.0", plugins: [] });
      }
      if (url === "https://raw.githubusercontent.com/acme/plugins/main/registry.json") {
        return jsonResponse({
          version: "1.0.0",
          plugins: [{ id: "alpha", name: "Alpha Plugin", path: "plugins/alpha" }],
        });
      }
      if (
        url === "https://raw.githubusercontent.com/acme/plugins/main/plugins/alpha/manifest.json"
      ) {
        return jsonResponse({
          name: "Alpha Plugin",
          version: "1.2.3",
          description: "Alpha from manifest",
          author: { name: "acme" },
          tags: ["custom"],
          tools: [{ name: "alpha_run", description: "Run alpha" }],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    const app = createApp(fetchMock, {
      config: {
        marketplace: {
          extra_sources: [
            {
              url: "https://raw.githubusercontent.com/acme/plugins/main/registry.json",
              label: "Acme",
            },
          ],
        },
      },
    });

    const res = await app.request("/marketplace");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "alpha",
        name: "Alpha Plugin",
        description: "Alpha from manifest",
        author: "acme",
        tags: ["custom"],
        remoteVersion: "1.2.3",
        source: "custom",
        sourceLabel: "Acme",
        tools: [{ name: "alpha_run", description: "Run alpha" }],
      }),
    ]);
  });

  it("reports registry load failures instead of returning a successful empty marketplace", async () => {
    const app = createApp(
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const res = await app.request("/marketplace");
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("No marketplace registry sources could be loaded");
  });
});
