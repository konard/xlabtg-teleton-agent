import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../memory/schema.js";
import type { Config } from "../../../../config/schema.js";
import { ConfigSchema } from "../../../../config/schema.js";
import { ToolRegistry } from "../../registry.js";
import type { ToolContext } from "../../types.js";
import execModule from "../module.js";

function makeConfig(
  execOverrides?: Record<string, unknown>,
  telegramOverrides?: Record<string, unknown>
): Config {
  return ConfigSchema.parse({
    agent: { provider: "anthropic", api_key: "test" },
    telegram: { api_id: 1, api_hash: "a", phone: "+1", ...telegramOverrides },
    capabilities: {
      exec: {
        mode: "yolo",
        scope: "admin-only",
        ...execOverrides,
      },
    },
  });
}

describe("execModule", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  it("returns 4 tools when enabled + Linux", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig();
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.tool.name).sort()).toEqual([
      "exec_install",
      "exec_run",
      "exec_service",
      "exec_status",
    ]);

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("returns empty tools when mode is off", () => {
    const config = makeConfig({ mode: "off" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(0);
  });

  it("returns empty tools on non-Linux", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    const config = makeConfig();
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(0);

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("sets scope to admin-only when config scope is admin-only", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig({ scope: "admin-only" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools[0].scope).toBe("admin-only");

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("sets scope to always when config scope is all", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig({ scope: "all" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools[0].scope).toBe("always");

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("returns 4 tools when mode is allowlist + Linux", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig({ mode: "allowlist", command_allowlist: ["git status"] });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(4);

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("enforces exec.allowlist membership when scope is allowlist", async () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    try {
      const config = makeConfig(
        { scope: "allowlist", allowlist: [123], sandbox_mode: "dry-run" },
        { admin_ids: [999] }
      );
      execModule.configure!(config);
      execModule.migrate!(db);

      const registry = new ToolRegistry();
      for (const { tool, executor, scope } of execModule.tools(config)) {
        registry.register(tool, executor, scope);
      }

      const makeContext = (senderId: number): ToolContext => ({
        bridge: {} as ToolContext["bridge"],
        db,
        chatId: "123",
        senderId,
        isGroup: false,
        config,
      });

      const allowed = await registry.execute(
        { name: "exec_run", arguments: { command: "echo ok" } },
        makeContext(123)
      );
      expect(allowed.success).toBe(true);
      expect(allowed.data).toMatchObject({ dryRun: true });

      const denied = await registry.execute(
        { name: "exec_run", arguments: { command: "echo ok" } },
        makeContext(999)
      );
      expect(denied.success).toBe(false);
      expect(denied.error).toContain("allowlist");
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
      else Object.defineProperty(process, "platform", { value: "linux" });
    }
  });
});
