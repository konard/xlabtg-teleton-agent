import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../memory/schema.js";
import type { ExecConfig } from "../../../../config/schema.js";
import type { ToolContext } from "../../types.js";
import { runCommand } from "../runner.js";
import { createExecInstallExecutor } from "../install.js";
import { createExecServiceExecutor } from "../service.js";

// These tests exercise the REAL runner (no mocks) to prove that argument
// injection cannot create files on disk — the core of WORK4-001.

function makeExecConfig(overrides?: Partial<ExecConfig>): ExecConfig {
  return {
    mode: "yolo",
    scope: "admin-only",
    allowlist: [],
    command_allowlist: [],
    limits: { timeout: 10, max_output: 50000 },
    audit: { log_commands: false },
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    bridge: {} as any,
    db: new Database(":memory:"),
    chatId: "123",
    senderId: 42,
    isGroup: false,
  };
}

const marker = join(tmpdir(), `teleton-pwned-${process.pid}.marker`);

afterEach(() => {
  if (existsSync(marker)) rmSync(marker);
});

describe("exec injection (real runner)", () => {
  it("runCommand with useShell:false never lets argv tokens spawn a shell", async () => {
    // If the token were shell-interpreted, the marker file would be created.
    const result = await runCommand(`echo hi; touch ${marker}`, {
      timeout: 10000,
      maxOutput: 50000,
      useShell: false,
      argv: ["echo", `hi; touch ${marker}`],
    });

    expect(result.exitCode).toBe(0);
    // echo printed the literal argument, the shell metacharacters were inert.
    expect(result.stdout).toContain(`hi; touch ${marker}`);
    expect(existsSync(marker)).toBe(false);
  });

  it("exec_install rejects injection in allowlist mode without touching disk", async () => {
    const db = new Database(":memory:");
    ensureSchema(db);
    const exec = createExecInstallExecutor(
      db,
      makeExecConfig({ mode: "allowlist", command_allowlist: ["git"] })
    );

    const res = await exec({ manager: "apt", packages: `git; touch ${marker}` }, makeContext());

    expect(res.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("exec_service rejects injection in allowlist mode without touching disk", async () => {
    const db = new Database(":memory:");
    ensureSchema(db);
    const exec = createExecServiceExecutor(
      db,
      makeExecConfig({ mode: "allowlist", command_allowlist: ["git"] })
    );

    const res = await exec({ action: "status", name: `x; touch ${marker}` }, makeContext());

    expect(res.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});
