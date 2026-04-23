import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync } from "fs";

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock("../../prompts.js", () => ({
  createPrompter: vi.fn(() => ({
    password: vi.fn().mockResolvedValue("sk-ant-secret-from-prompt-1234567890"),
    text: vi.fn().mockResolvedValue("value-from-prompt"),
  })),
  CancelledError: class CancelledError extends Error {
    constructor() {
      super("Cancelled");
      this.name = "CancelledError";
    }
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { configCommand } from "../config.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeConfig() {
  const path = join(tmpdir(), `teleton-test-config-${Date.now()}-${Math.random()}.yaml`);
  const yaml = [
    "agent:",
    "  api_key: sk-ant-existing-key-1234567890",
    "  provider: anthropic",
    "  model: claude-3-5-sonnet-20241022",
    "telegram:",
    "  bot_token: '123456:EXISTINGTOKEN'",
    "meta: {}",
  ].join("\n");
  writeFileSync(path, yaml, { encoding: "utf-8", mode: 0o600 });
  return path;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("config set — sensitive key protection (issue #315)", () => {
  let origArgv: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origArgv = process.argv.slice();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    process.argv = origArgv;
    vi.restoreAllMocks();
  });

  // Acceptance criterion: positional value for sensitive key must be rejected
  it("rejects positional value for sensitive key (agent.api_key)", async () => {
    const configPath = makeConfig();
    process.argv = ["node", "teleton", "config", "set", "agent.api_key", "sk-ant-plaintext1234567890"];

    await expect(
      configCommand("set", "agent.api_key", "sk-ant-plaintext1234567890", { config: configPath })
    ).rejects.toThrow(/process.exit/);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("sensitive")
    );
  });

  // Acceptance criterion: env var TELETON_AGENT_API_KEY is accepted for sensitive key
  it("accepts env var TELETON_AGENT_API_KEY for agent.api_key", async () => {
    const configPath = makeConfig();
    const envKey = "TELETON_AGENT_API_KEY";
    process.env[envKey] = "sk-ant-from-env-var-1234567890";
    try {
      process.argv = ["node", "teleton", "config", "set", "agent.api_key"];
      await configCommand("set", "agent.api_key", undefined, { config: configPath });
      // Should succeed and print updated (not echoing the value)
      const logs = consoleSpy.mock.calls.map((c) => c[0] as string);
      const updatedLine = logs.find((l) => l.includes("agent.api_key"));
      expect(updatedLine).toBeDefined();
      expect(updatedLine).not.toContain("sk-ant");
    } finally {
      delete process.env[envKey];
    }
  });

  // Acceptance criterion: --value-file is accepted for sensitive key
  it("accepts --value-file for sensitive key (agent.api_key)", async () => {
    const configPath = makeConfig();
    const valueFile = join(tmpdir(), `secret-${Date.now()}.txt`);
    const secretValue = "sk-ant-from-file-1234567890";
    writeFileSync(valueFile, secretValue, "utf-8");

    await configCommand("set", "agent.api_key", undefined, {
      config: configPath,
      valueFile,
    });

    const logs = consoleSpy.mock.calls.map((c) => c[0] as string);
    const updatedLine = logs.find((l) => l.includes("agent.api_key"));
    expect(updatedLine).toBeDefined();
    // Must NOT echo the secret value
    expect(updatedLine).not.toContain("sk-ant-from-file");
  });

  // Acceptance criterion: after parsing argv, secret slot is zeroed
  it("zeros out the argv slot after parsing sensitive value from argv (simulation)", async () => {
    // Simulate that we passed a sensitive value on argv and checked that it gets redacted.
    // We test this by looking at process.argv after the command rejects.
    // The rejection should still have zeroed the argv slot.
    const configPath = makeConfig();
    const secret = "sk-ant-argv-secret-1234567890";
    process.argv = ["node", "teleton", "config", "set", "agent.api_key", secret];

    try {
      await configCommand("set", "agent.api_key", secret, { config: configPath });
    } catch {
      // expected to exit
    }

    // After the call, the argv slot holding the secret should be redacted
    expect(process.argv).not.toContain(secret);
  });

  // Acceptance criterion: config set does not echo the masked value
  it("does not echo masked value on success (interactive prompt path)", async () => {
    const configPath = makeConfig();
    // No value passed — falls through to interactive prompt mock
    await configCommand("set", "agent.api_key", undefined, { config: configPath });

    const logs = consoleSpy.mock.calls.map((c) => c[0] as string);
    const updatedLine = logs.find((l) => l.includes("agent.api_key"));
    expect(updatedLine).toBeDefined();
    // Must say "updated" and must NOT print any key fragment
    expect(updatedLine).toContain("updated");
    expect(updatedLine).not.toMatch(/sk-ant/);
    expect(updatedLine).not.toMatch(/\*+/);
  });

  // Non-sensitive key: positional value still works
  it("still accepts positional value for non-sensitive key (agent.provider)", async () => {
    const configPath = makeConfig();
    await configCommand("set", "agent.provider", "anthropic", { config: configPath });

    const logs = consoleSpy.mock.calls.map((c) => c[0] as string);
    const line = logs.find((l) => l.includes("agent.provider"));
    expect(line).toBeDefined();
  });
});

describe("config get — does not reveal sensitive values", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks agent.api_key in config get output", async () => {
    const configPath = makeConfig();
    await configCommand("get", "agent.api_key", undefined, { config: configPath });

    const logs = consoleSpy.mock.calls.map((c) => c[0] as string);
    const line = logs.find((l) => l.includes("agent.api_key"));
    expect(line).toBeDefined();
    // Should show masked form, not full key
    expect(line).not.toContain("sk-ant-existing-key-1234567890");
  });
});
