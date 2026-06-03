import { execFileSync } from "child_process";
import { type ChildProcess, spawn } from "child_process";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";
import { runnerBin } from "./paths.js";

const log = createLogger("gocoon");

export interface SupervisorOptions {
  /** Path to client-config.json produced by `gocoon init`. */
  configPath: string;
  /** Readiness probe, e.g. http://127.0.0.1:10000/v1/models. */
  healthUrl: string;
  /** Max wait for the first healthy probe (default 30s). */
  startGraceMs?: number;
  /** gocoon-runner verbosity flag (-v N); 0 disables it. */
  verbosity?: number;
  /** Restart backoff ceiling (default 60s). */
  backoffCapMs?: number;
  /** Receives runner stdout/stderr lines (default: debug log). */
  onLog?: (line: string) => void;
}

const READY_PROBE_TIMEOUT_MS = 2_000;
const READY_POLL_INTERVAL_MS = 250;
const KILL_GRACE_MS = 5_000;
const MAX_RESTART_FAILURES = 5;

/**
 * Supervises a long-lived `gocoon-runner` child: starts it, waits for the health
 * URL to come up, then auto-restarts on crash with exponential backoff until
 * {@link GocoonSupervisor.stop} is called. Node port of myduckai's
 * `supervisor.go` + `health.go`.
 */
export class GocoonSupervisor {
  private child: ChildProcess | null = null;
  private stopped = false;
  private runningFlag = false;
  private failures = 0;
  private backoffMs = 1_000;

  private readonly configPath: string;
  private readonly healthUrl: string;
  private readonly startGraceMs: number;
  private readonly verbosity: number;
  private readonly backoffCapMs: number;
  private readonly onLog: (line: string) => void;

  constructor(opts: SupervisorOptions) {
    this.configPath = opts.configPath;
    this.healthUrl = opts.healthUrl;
    this.startGraceMs = opts.startGraceMs ?? 30_000;
    this.verbosity = opts.verbosity ?? 0;
    this.backoffCapMs = opts.backoffCapMs ?? 60_000;
    this.onLog = opts.onLog ?? ((line) => log.debug(line));
  }

  /** Launch the runner and resolve once it is healthy. Throws if it never becomes ready. */
  async start(): Promise<void> {
    this.stopped = false;
    this.failures = 0;
    this.backoffMs = 1_000;
    this.spawnChild();
    try {
      await waitReady(this.healthUrl, this.startGraceMs);
    } catch (err) {
      // Abort supervision: mark stopped first so the exit handler doesn't respawn.
      this.stopped = true;
      this.killChild();
      throw new Error(`gocoon-runner did not become healthy: ${getErrorMessage(err)}`);
    }
    log.info(`gocoon-runner ready (pid ${this.child?.pid ?? "?"})`);
  }

  /** Signal shutdown and kill the runner (idempotent). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.killChild();
  }

  isRunning(): boolean {
    return this.runningFlag;
  }

  private spawnChild(): void {
    const args = ["--config", this.configPath];
    if (this.verbosity > 0) args.push(`-v${this.verbosity}`);

    const child = spawn(runnerBin(), args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.runningFlag = true;
    log.info(`gocoon-runner started (pid ${child.pid ?? "?"})`);

    const onData = (buf: Buffer): void => {
      const line = buf.toString().trimEnd();
      if (line) this.onLog(line);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => log.error(`gocoon-runner process error: ${getErrorMessage(err)}`));
    child.on("exit", (code, signal) => this.onChildExit(code, signal));
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.runningFlag = false;
    if (this.stopped) {
      log.info("gocoon-runner stopped");
      return;
    }
    log.warn(
      `gocoon-runner exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"}); restarting in ${this.backoffMs}ms`
    );
    setTimeout(() => void this.restart(), this.backoffMs);
  }

  private async restart(): Promise<void> {
    if (this.stopped) return;
    try {
      this.spawnChild();
      await waitReady(this.healthUrl, this.startGraceMs);
      this.failures = 0;
      this.backoffMs = 1_000;
      log.info("gocoon-runner recovered");
    } catch (err) {
      this.failures += 1;
      this.backoffMs = Math.min(this.backoffMs * 2, this.backoffCapMs);
      if (this.failures >= MAX_RESTART_FAILURES) {
        this.stopped = true;
        this.killChild();
        log.error(`gocoon-runner failed ${this.failures}× — giving up supervision`);
        return;
      }
      log.error(
        `gocoon-runner restart unhealthy (${this.failures}/${MAX_RESTART_FAILURES}): ${getErrorMessage(err)}`
      );
      // Kill the unhealthy child; its 'exit' event reschedules the next restart.
      this.killChild();
    }
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (child?.pid != null) killProcessGroup(child.pid);
  }
}

/**
 * Kill a child's whole process group: SIGTERM then SIGKILL after `graceMs`
 * (POSIX, requires the child spawned `detached`); `taskkill /T /F` on Windows.
 * Shared by the supervisor and the transient runner in the withdraw flow.
 */
export function killProcessGroup(pid: number, graceMs = KILL_GRACE_MS): void {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM"); // negative pid → whole process group
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already reaped */
      }
    }, graceMs);
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Poll `url` with GET until it returns 2xx, or reject after `timeoutMs`. Port of health.go WaitReady. */
export async function waitReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  throw new Error(`health ${url} not ready within ${timeoutMs}ms`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
