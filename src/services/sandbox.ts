import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnOptions } from "node:child_process";

export type SandboxMode = "unrestricted" | "sandboxed" | "dry-run";

export interface SandboxProfile {
  mode: SandboxMode;
  spawnOptions: Pick<SpawnOptions, "cwd" | "env">;
  cleanup(): void;
}

/**
 * Best-effort subprocess isolation for exec tools.
 *
 * "sandboxed" gives the process an empty temporary working directory and a
 * minimal environment. It does not claim to be an OS security boundary; callers
 * that need hard filesystem/network isolation should run Teleton itself inside
 * a container or VM. "dry-run" is handled by the exec runner before spawning.
 */
export function createSandboxProfile(mode: SandboxMode): SandboxProfile {
  if (mode !== "sandboxed") {
    return {
      mode,
      spawnOptions: {},
      cleanup() {},
    };
  }

  const cwd = mkdtempSync(join(tmpdir(), "teleton-sandbox-"));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: cwd,
    TMPDIR: cwd,
    LANG: process.env.LANG ?? "C.UTF-8",
  };

  return {
    mode,
    spawnOptions: { cwd, env },
    cleanup() {
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
