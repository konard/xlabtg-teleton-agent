import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockReadRawConfig = vi.fn();
const mockWriteRawConfig = vi.fn();

// Keep real CONFIGURABLE_KEYS, getNestedValue, setNestedValue for allowlist testing
vi.mock("../../config/configurable-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/configurable-keys.js")>();
  return {
    ...actual,
    readRawConfig: (...args: unknown[]) => mockReadRawConfig(...args),
    writeRawConfig: (...args: unknown[]) => mockWriteRawConfig(...args),
  };
});

vi.mock("../../workspace/paths.js", () => ({
  WORKSPACE_ROOT: "/fake/workspace",
  TELETON_ROOT: "/fake/teleton",
  WORKSPACE_PATHS: {},
  ALLOWED_EXTENSIONS: {},
  MAX_FILE_SIZES: {},
  IMMUTABLE_FILES: ["SOUL.md", "STRATEGY.md", "SECURITY.md"],
}));

vi.mock("../../soul/loader.js", () => ({
  clearPromptCache: vi.fn(),
}));

vi.mock("../../agent/hooks/user-hook-store.js", () => ({
  getBlocklistConfig: vi.fn(() => []),
  setBlocklistConfig: vi.fn(),
  getTriggersConfig: vi.fn(() => []),
  setTriggersConfig: vi.fn(),
  getRulesConfig: vi.fn(() => []),
  setRulesConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

// Must import AFTER mocks are set up
import { writeFileSync } from "node:fs";
import { clearPromptCache } from "../../soul/loader.js";
import { createExportImportRoutes } from "../routes/export-import.js";
import type { WebUIServerDeps } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function buildApp() {
  const deps = {
    configPath: "/tmp/test.yaml",
    memory: { db: {} },
  } as unknown as WebUIServerDeps;
  const app = new Hono();
  app.route("/api/export", createExportImportRoutes(deps));
  return app;
}

// ── Config import tests ───────────────────────────────────────────────────

describe("POST /api/export/import — config allowlist enforcement", () => {
  let app: ReturnType<typeof buildApp>;
  let writtenConfig: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    writtenConfig = {};
    mockWriteRawConfig.mockImplementation((cfg: Record<string, unknown>) => {
      writtenConfig = cfg;
    });
  });

  it("preserves webui.auth_token_hash — it is not in CONFIGURABLE_KEYS", async () => {
    mockReadRawConfig.mockReturnValue({
      webui: { auth_token_hash: "SECRET_HASH", port: 8080 },
    });

    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          config: {
            // attacker tries to drop auth_token_hash by sending a webui section without it
            webui: { port: 9090 },
          },
        },
        options: { config: true },
      }),
    });

    expect(res.status).toBe(200);
    expect((writtenConfig.webui as Record<string, unknown>).auth_token_hash).toBe("SECRET_HASH");
    // webui.port IS in CONFIGURABLE_KEYS and should be applied
    expect((writtenConfig.webui as Record<string, unknown>).port).toBe(9090);
  });

  it("ignores attempt to overwrite webui.auth_token_hash directly", async () => {
    mockReadRawConfig.mockReturnValue({
      webui: { auth_token_hash: "REAL_HASH" },
    });

    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          config: { webui: { auth_token_hash: "ATTACKER_HASH" } },
        },
        options: { config: true },
      }),
    });

    expect((writtenConfig.webui as Record<string, unknown>).auth_token_hash).toBe("REAL_HASH");
  });

  it("ignores keys that are not in CONFIGURABLE_KEYS", async () => {
    mockReadRawConfig.mockReturnValue({ agent: { model: "gpt-4" } });

    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          config: {
            totally_arbitrary_key: "pwned",
            some_flag: true,
            nested: { something: "bad" },
          },
        },
        options: { config: true },
      }),
    });

    expect(writtenConfig).not.toHaveProperty("totally_arbitrary_key");
    expect(writtenConfig).not.toHaveProperty("some_flag");
    expect(writtenConfig).not.toHaveProperty("nested");
  });

  it("applies valid capabilities.exec.mode from CONFIGURABLE_KEYS", async () => {
    mockReadRawConfig.mockReturnValue({
      capabilities: { exec: { mode: "off" } },
    });

    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          config: { capabilities: { exec: { mode: "allowlist" } } },
        },
        options: { config: true },
      }),
    });

    expect(writtenConfig.capabilities as Record<string, unknown>).toBeDefined();
    expect(
      ((writtenConfig.capabilities as Record<string, unknown>).exec as Record<string, unknown>).mode
    ).toBe("allowlist");
  });

  it("rejects invalid enum values and keeps existing value", async () => {
    mockReadRawConfig.mockReturnValue({
      capabilities: { exec: { mode: "off" } },
    });

    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          // "SUPER_ADMIN" is not a valid capabilities.exec.mode value
          config: { capabilities: { exec: { mode: "SUPER_ADMIN" } } },
        },
        options: { config: true },
      }),
    });

    // Invalid value skipped; existing preserved
    expect(
      ((writtenConfig.capabilities as Record<string, unknown>).exec as Record<string, unknown>).mode
    ).toBe("off");
  });

  it("returns 400 when bundle version is not 1.0", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: { version: "2.0", config: {} },
        options: { config: true },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("version 1.0");
  });

  it("returns success and lists config in applied when config option is true", async () => {
    mockReadRawConfig.mockReturnValue({});

    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: { version: "1.0", config: {} },
        options: { config: true },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.applied).toContain("config");
  });
});

// ── Soul import tests ─────────────────────────────────────────────────────

describe("POST /api/export/import — soul immutable file protection", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("does not write SOUL.md (immutable file)", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "SOUL.md": "attacker content" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining("SOUL.md"),
      expect.any(String),
      expect.any(String)
    );
  });

  it("does not write SECURITY.md (immutable file)", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "SECURITY.md": "<attacker text>" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining("SECURITY.md"),
      expect.any(String),
      expect.any(String)
    );
  });

  it("does not write STRATEGY.md (immutable file)", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "STRATEGY.md": "attacker strategy" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining("STRATEGY.md"),
      expect.any(String),
      expect.any(String)
    );
  });

  it("writes MEMORY.md (not immutable)", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "MEMORY.md": "restored memory" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("MEMORY.md"),
      "restored memory",
      "utf-8"
    );
  });

  it("writes HEARTBEAT.md (not immutable)", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "HEARTBEAT.md": "heartbeat schedule" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("HEARTBEAT.md"),
      "heartbeat schedule",
      "utf-8"
    );
  });

  it("skips all immutable files even in a combined soul bundle", async () => {
    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: {
            "SOUL.md": "attacker soul",
            "SECURITY.md": "attacker security",
            "STRATEGY.md": "attacker strategy",
            "MEMORY.md": "legitimate memory",
            "HEARTBEAT.md": "legitimate heartbeat",
          },
        },
        options: { soul: true },
      }),
    });

    // Only non-immutable files should be written
    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("MEMORY.md"),
      "legitimate memory",
      "utf-8"
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("HEARTBEAT.md"),
      "legitimate heartbeat",
      "utf-8"
    );
  });

  it("clears prompt cache after soul import", async () => {
    await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "MEMORY.md": "content" },
        },
        options: { soul: true },
      }),
    });

    expect(clearPromptCache).toHaveBeenCalledTimes(1);
  });

  it("returns success and lists soul in applied", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          version: "1.0",
          soul: { "MEMORY.md": "content" },
        },
        options: { soul: true },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.applied).toContain("soul");
  });
});
