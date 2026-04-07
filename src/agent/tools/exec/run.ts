import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { ExecConfig } from "../../../config/schema.js";
import { runCommand } from "./runner.js";
import { insertAuditEntry, updateAuditEntry } from "./audit.js";
import type Database from "better-sqlite3";

interface ExecRunParams {
  command: string;
}

export const execRunTool: Tool = {
  name: "exec_run",
  description:
    "Execute an arbitrary bash command on the host system. Returns stdout, stderr, and exit code. Use for any system administration task: file management, process control, Docker, networking, etc.",
  parameters: Type.Object({
    command: Type.String({
      description: "The bash command to execute (supports pipes, &&, redirects, etc.)",
    }),
  }),
};

export function isCommandAllowed(command: string, commandAllowlist: string[]): boolean {
  const trimmed = command.trim();
  return commandAllowlist.some((pattern) => {
    const p = pattern.trim();
    // Exact match or command starts with the pattern followed by whitespace
    return trimmed === p || trimmed.startsWith(p + " ");
  });
}

export function createExecRunExecutor(
  db: Database.Database,
  execConfig: ExecConfig
): ToolExecutor<ExecRunParams> {
  return async (params, context): Promise<ToolResult> => {
    const { command } = params;
    const { timeout, max_output } = execConfig.limits;

    if (execConfig.mode === "allowlist") {
      if (!isCommandAllowed(command, execConfig.command_allowlist)) {
        return {
          success: false,
          error: `Command not permitted. Allowed prefixes: ${execConfig.command_allowlist.length > 0 ? execConfig.command_allowlist.join(", ") : "(none configured)"}`,
        };
      }
    }

    let auditId: number | undefined;
    if (execConfig.audit.log_commands) {
      auditId = insertAuditEntry(db, {
        userId: context.senderId,
        username: undefined,
        tool: "exec_run",
        command,
        status: "running",
        truncated: false,
      });
    }

    const result = await runCommand(command, {
      timeout: timeout * 1000,
      maxOutput: max_output,
    });

    const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed";

    if (auditId !== undefined) {
      updateAuditEntry(db, auditId, {
        status,
        exitCode: result.exitCode ?? undefined,
        signal: result.signal ?? undefined,
        duration: result.duration,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      });
    }

    return {
      success: result.exitCode === 0 && !result.timedOut,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
        truncated: result.truncated,
        timedOut: result.timedOut,
      },
      ...(result.timedOut
        ? { error: `Command timed out after ${timeout}s` }
        : result.exitCode !== 0
          ? { error: `Command exited with code ${result.exitCode}` }
          : {}),
    };
  };
}
