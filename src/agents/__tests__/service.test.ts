import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { ManagedAgentService } from "../service.js";
import { loadConfig } from "../../config/loader.js";

const PRIMARY_CONFIG = `
agent:
  api_key: sk-ant-api03-test123
  provider: anthropic
telegram:
  api_id: 12345
  api_hash: abcdef1234567890
  phone: "+1234567890"
webui:
  enabled: true
api:
  enabled: true
ton_proxy:
  enabled: true
  port: 8080
`;

describe("ManagedAgentService", () => {
  let rootDir: string;
  let configPath: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "teleton-managed-agents-"));
    configPath = join(rootDir, "config.yaml");
    mkdirSync(join(rootDir, "workspace"), { recursive: true });
    mkdirSync(join(rootDir, "plugins", "example"), { recursive: true });
    writeFileSync(configPath, PRIMARY_CONFIG, "utf-8");
    writeFileSync(join(rootDir, "workspace", "SOUL.md"), "Primary soul", "utf-8");
    writeFileSync(join(rootDir, "workspace", "MEMORY.md"), "Primary memory", "utf-8");
    writeFileSync(join(rootDir, "plugins", "example", "index.js"), "export default {};\n", "utf-8");
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("creates an isolated clone with rewritten paths and copied workspace assets", () => {
    const service = new ManagedAgentService({ rootDir, primaryConfigPath: configPath });

    const snapshot = service.createAgent({ name: "Support Copy" });
    const clonedConfig = loadConfig(snapshot.configPath);

    expect(snapshot.id).toBe("support-copy");
    expect(snapshot.homePath).toBe(join(rootDir, "agents", "support-copy"));
    expect(existsSync(join(snapshot.workspacePath, "SOUL.md"))).toBe(true);
    expect(readFileSync(join(snapshot.workspacePath, "SOUL.md"), "utf-8")).toBe("Primary soul");
    expect(existsSync(join(snapshot.homePath, "plugins", "example", "index.js"))).toBe(true);
    expect(clonedConfig.telegram.session_path).toBe(
      join(rootDir, "agents", "support-copy", "telegram_session.txt")
    );
    expect(clonedConfig.storage.sessions_file).toBe(
      join(rootDir, "agents", "support-copy", "sessions.json")
    );
    expect(clonedConfig.storage.memory_file).toBe(
      join(rootDir, "agents", "support-copy", "memory.json")
    );
    expect(clonedConfig.webui.enabled).toBe(false);
    expect(clonedConfig.api?.enabled).toBe(false);
    expect(clonedConfig.ton_proxy.enabled).toBe(false);
  });

  it("allocates unique ids when the same name is cloned twice", () => {
    const service = new ManagedAgentService({ rootDir, primaryConfigPath: configPath });

    const first = service.createAgent({ name: "Trading Desk" });
    const second = service.createAgent({ name: "Trading Desk" });

    expect(first.id).toBe("trading-desk");
    expect(second.id).toBe("trading-desk-2");
    expect(service.listAgentSnapshots().map((agent) => agent.id)).toEqual([
      "trading-desk",
      "trading-desk-2",
    ]);
  });
});
