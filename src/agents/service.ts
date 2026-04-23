import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { WriteStream } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { loadConfig, saveConfig } from "../config/loader.js";
import type { Config } from "../config/schema.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { loadTemplate } from "../workspace/manager.js";
import { getErrorMessage } from "../utils/errors.js";
import type {
  CreateManagedAgentInput,
  ManagedAgentCommand,
  ManagedAgentDefinition,
  ManagedAgentMode,
  ManagedAgentRuntimeStatus,
  ManagedAgentSnapshot,
  ManagedAgentState,
} from "./types.js";

const MANAGED_AGENTS_DIRNAME = "agents";
const LOG_LINES_FALLBACK = 200;
const STOP_GRACE_MS = 15_000;

const TEMPLATE_FILES = [
  "SOUL.md",
  "MEMORY.md",
  "IDENTITY.md",
  "USER.md",
  "STRATEGY.md",
  "SECURITY.md",
  "HEARTBEAT.md",
] as const;

type ManagedAgentChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface ManagedAgentProcessRecord {
  child: ManagedAgentChildProcess | null;
  logStream: WriteStream | null;
  state: ManagedAgentState;
  stopRequested: boolean;
  startedAt: number | null;
  lastError: string | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

export interface ManagedAgentServiceOptions {
  rootDir?: string;
  primaryConfigPath: string;
  resolveCommand?: (configPath: string) => ManagedAgentCommand;
}

function slugifyAgentId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function tailLines(text: string, lines: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").split("\n");
  if (normalized.length <= lines) return normalized;
  return normalized.slice(-lines);
}

export class ManagedAgentService {
  private readonly rootDir: string;
  private readonly agentsRoot: string;
  private readonly primaryConfigPath: string;
  private readonly resolveCommand: (configPath: string) => ManagedAgentCommand;
  private readonly processes = new Map<string, ManagedAgentProcessRecord>();

  constructor(options: ManagedAgentServiceOptions) {
    this.rootDir = options.rootDir ?? TELETON_ROOT;
    this.agentsRoot = join(this.rootDir, MANAGED_AGENTS_DIRNAME);
    this.primaryConfigPath = options.primaryConfigPath;
    this.resolveCommand = options.resolveCommand ?? this.defaultResolveCommand;
  }

  listAgentSnapshots(): ManagedAgentSnapshot[] {
    return this.listDefinitions().map((definition) => this.toSnapshot(definition));
  }

  getAgentSnapshot(id: string): ManagedAgentSnapshot {
    return this.toSnapshot(this.readDefinition(id));
  }

  createAgent(input: CreateManagedAgentInput): ManagedAgentSnapshot {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Agent name is required");
    }

    const id = this.resolveUniqueId(input.id ?? name);
    const homePath = join(this.agentsRoot, id);
    const configPath = join(homePath, "config.yaml");
    const workspacePath = join(homePath, "workspace");
    const logPath = join(homePath, "logs", "agent.log");
    const sourceId = input.cloneFromId ?? null;
    const sourceDefinition = sourceId ? this.readDefinition(sourceId) : null;
    const sourceConfigPath = sourceDefinition?.configPath ?? this.primaryConfigPath;
    const sourceRoot = sourceDefinition?.homePath ?? this.rootDir;
    const mode: ManagedAgentMode = input.mode ?? sourceDefinition?.mode ?? "personal";

    mkdirSync(homePath, { recursive: true, mode: 0o700 });
    mkdirSync(join(homePath, "logs"), { recursive: true, mode: 0o700 });

    this.bootstrapWorkspace(sourceRoot, homePath);

    const sourceConfig = loadConfig(sourceConfigPath);
    const managedConfig = this.prepareManagedConfig(sourceConfig, homePath);
    saveConfig(managedConfig, configPath);

    const timestamp = nowIso();
    const definition: ManagedAgentDefinition = {
      id,
      name,
      mode,
      homePath,
      configPath,
      workspacePath,
      logPath,
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceId,
    };

    this.writeDefinition(definition);
    writeFileSync(
      logPath,
      `[${timestamp}] Created ${mode} managed agent "${name}" from ${sourceId ?? "primary"}\n`,
      "utf-8"
    );

    return this.toSnapshot(definition);
  }

  deleteAgent(id: string): void {
    const record = this.processes.get(id);
    if (
      record &&
      (record.state === "starting" || record.state === "running" || record.state === "stopping")
    ) {
      throw new Error("Stop the agent before deleting it");
    }

    const definition = this.readDefinition(id);
    this.processes.delete(id);
    rmSync(definition.homePath, { recursive: true, force: true });
  }

  startAgent(id: string): ManagedAgentRuntimeStatus {
    const definition = this.readDefinition(id);
    const record = this.ensureProcessRecord(id);

    if (definition.mode === "bot") {
      throw new Error("Bot-mode managed agents are not startable in this foundation slice yet");
    }
    if (record.state === "starting" || record.state === "running") {
      throw new Error("Agent is already running");
    }
    if (record.state === "stopping") {
      throw new Error("Agent is currently stopping");
    }

    mkdirSync(join(definition.homePath, "logs"), { recursive: true, mode: 0o700 });
    const logStream = createWriteStream(definition.logPath, { flags: "a" });
    const command = this.resolveCommand(definition.configPath);

    const child = spawn(command.command, command.args, {
      cwd: definition.homePath,
      env: {
        ...process.env,
        TELETON_HOME: definition.homePath,
        TELETON_WEBUI_ENABLED: "false",
        TELETON_API_ENABLED: "false",
        TELETON_JSON_CREDENTIALS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    record.child = child;
    record.logStream = logStream;
    record.state = "starting";
    record.stopRequested = false;
    record.startedAt = null;
    record.lastError = null;

    this.appendLog(logStream, `\n[${nowIso()}] Starting managed agent "${definition.name}"\n`);

    child.once("spawn", () => {
      setTimeout(() => {
        if (record.state === "starting" && record.child?.exitCode === null) {
          record.state = "running";
          record.startedAt = Date.now();
        }
      }, 2_000).unref();
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      this.appendLog(logStream, text);
      if (record.state === "starting" && text.includes("Teleton Agent is running!")) {
        record.state = "running";
        record.startedAt = Date.now();
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      this.appendLog(logStream, chunk.toString());
    });

    child.once("error", (error) => {
      record.lastError = getErrorMessage(error);
      record.state = "error";
      record.child = null;
      record.startedAt = null;
      this.clearStopTimer(record);
      this.closeLogStream(record);
    });

    child.once("exit", (code, signal) => {
      const expectedStop = record.stopRequested;
      record.child = null;
      record.stopRequested = false;
      record.startedAt = null;
      this.clearStopTimer(record);

      if (expectedStop || code === 0) {
        record.state = "stopped";
        record.lastError = null;
      } else {
        record.state = "error";
        record.lastError = `Process exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`;
      }

      this.appendLog(
        logStream,
        `\n[${nowIso()}] Managed agent exited: ${record.lastError ?? "clean shutdown"}\n`
      );
      this.closeLogStream(record);
    });

    return this.getRuntimeStatus(id);
  }

  stopAgent(id: string): ManagedAgentRuntimeStatus {
    const record = this.ensureProcessRecord(id);

    if (record.state === "stopped" || record.state === "error" || !record.child) {
      throw new Error("Agent is not running");
    }
    if (record.state === "stopping") {
      throw new Error("Agent is already stopping");
    }

    record.stopRequested = true;
    record.state = "stopping";
    record.child.kill("SIGTERM");
    record.stopTimer = setTimeout(() => {
      if (record.child && !record.child.killed) {
        record.child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS);
    record.stopTimer.unref();

    return this.getRuntimeStatus(id);
  }

  async stopAll(): Promise<void> {
    const activeIds = [...this.processes.entries()]
      .filter(([, record]) => record.child)
      .map(([id]) => id);

    for (const id of activeIds) {
      try {
        this.stopAgent(id);
      } catch {
        // Ignore agents that are already down.
      }
    }

    if (activeIds.length === 0) return;

    await Promise.all(
      activeIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              const state = this.getRuntimeStatus(id).state;
              if (state === "stopped" || state === "error") {
                clearInterval(interval);
                resolve();
              }
            }, 100);
            interval.unref();
          })
      )
    );
  }

  getRuntimeStatus(id: string): ManagedAgentRuntimeStatus {
    this.readDefinition(id);
    const record = this.ensureProcessRecord(id);
    const uptimeMs = record.startedAt ? Math.max(0, Date.now() - record.startedAt) : null;
    return {
      state: record.state,
      pid: record.child?.pid ?? null,
      startedAt: record.startedAt ? new Date(record.startedAt).toISOString() : null,
      uptimeMs,
      lastError: record.lastError,
    };
  }

  readLogs(id: string, lines = LOG_LINES_FALLBACK): { lines: string[]; path: string } {
    const definition = this.readDefinition(id);
    if (!existsSync(definition.logPath)) {
      return { lines: [], path: definition.logPath };
    }

    const raw = readFileSync(definition.logPath, "utf-8");
    return {
      lines: tailLines(raw, Math.max(1, Math.min(lines, 2_000))).filter(Boolean),
      path: definition.logPath,
    };
  }

  private listDefinitions(): ManagedAgentDefinition[] {
    if (!existsSync(this.agentsRoot)) return [];

    return readdirSync(this.agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(this.agentsRoot, entry.name, "manifest.json"))
      .filter((manifestPath) => existsSync(manifestPath))
      .map((manifestPath) => readJsonFile<ManagedAgentDefinition>(manifestPath))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private readDefinition(id: string): ManagedAgentDefinition {
    const manifestPath = join(this.agentsRoot, id, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`Managed agent "${id}" does not exist`);
    }
    return readJsonFile<ManagedAgentDefinition>(manifestPath);
  }

  private writeDefinition(definition: ManagedAgentDefinition): void {
    mkdirSync(definition.homePath, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(definition.homePath, "manifest.json"),
      JSON.stringify(definition, null, 2),
      "utf-8"
    );
  }

  private toSnapshot(definition: ManagedAgentDefinition): ManagedAgentSnapshot {
    const config = loadConfig(definition.configPath);
    return {
      ...definition,
      ...this.getRuntimeStatus(definition.id),
      provider: config.agent.provider,
      model: config.agent.model,
      ownerId: config.telegram.owner_id ?? null,
      adminIds: config.telegram.admin_ids ?? [],
      hasBotToken: Boolean(config.telegram.bot_token),
    };
  }

  private resolveUniqueId(base: string): string {
    const initial = slugifyAgentId(base) || "agent";
    let candidate = initial;
    let counter = 2;

    while (existsSync(join(this.agentsRoot, candidate))) {
      candidate = `${initial}-${counter}`;
      counter += 1;
    }

    return candidate;
  }

  private prepareManagedConfig(sourceConfig: Config, homePath: string): Config {
    const next = structuredClone(sourceConfig);
    next.telegram.session_path = join(homePath, "telegram_session.txt");
    next.storage.sessions_file = join(homePath, "sessions.json");
    next.storage.memory_file = join(homePath, "memory.json");
    next.webui.enabled = false;
    if (next.api) {
      next.api.enabled = false;
    }
    if (next.ton_proxy) {
      next.ton_proxy.enabled = false;
    }
    next.dev.hot_reload = false;
    next.meta.created_at = next.meta.created_at ?? nowIso();
    next.meta.last_modified_at = nowIso();
    return next;
  }

  private bootstrapWorkspace(sourceRoot: string, targetRoot: string): void {
    const sourceWorkspace = join(sourceRoot, "workspace");
    const targetWorkspace = join(targetRoot, "workspace");
    const sourcePlugins = join(sourceRoot, "plugins");
    const targetPlugins = join(targetRoot, "plugins");

    if (existsSync(sourceWorkspace)) {
      cpSync(sourceWorkspace, targetWorkspace, { recursive: true, force: true });
    } else {
      mkdirSync(targetWorkspace, { recursive: true, mode: 0o700 });
      for (const filename of TEMPLATE_FILES) {
        writeFileSync(join(targetWorkspace, filename), loadTemplate(filename), "utf-8");
      }
      mkdirSync(join(targetWorkspace, "memory"), { recursive: true, mode: 0o700 });
      mkdirSync(join(targetWorkspace, "downloads"), { recursive: true, mode: 0o700 });
      mkdirSync(join(targetWorkspace, "uploads"), { recursive: true, mode: 0o700 });
      mkdirSync(join(targetWorkspace, "temp"), { recursive: true, mode: 0o700 });
      mkdirSync(join(targetWorkspace, "memes"), { recursive: true, mode: 0o700 });
    }

    if (existsSync(sourcePlugins)) {
      mkdirSync(targetPlugins, { recursive: true, mode: 0o700 });
      for (const entry of readdirSync(sourcePlugins, { withFileTypes: true })) {
        if (entry.name === "data") continue;
        cpSync(join(sourcePlugins, entry.name), join(targetPlugins, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  private ensureProcessRecord(id: string): ManagedAgentProcessRecord {
    let record = this.processes.get(id);
    if (!record) {
      record = {
        child: null,
        logStream: null,
        state: "stopped",
        stopRequested: false,
        startedAt: null,
        lastError: null,
        stopTimer: null,
      };
      this.processes.set(id, record);
    }
    return record;
  }

  private appendLog(stream: WriteStream, text: string): void {
    stream.write(text);
  }

  private closeLogStream(record: ManagedAgentProcessRecord): void {
    record.logStream?.end();
    record.logStream = null;
  }

  private clearStopTimer(record: ManagedAgentProcessRecord): void {
    if (record.stopTimer) {
      clearTimeout(record.stopTimer);
      record.stopTimer = null;
    }
  }

  private defaultResolveCommand(configPath: string): ManagedAgentCommand {
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot resolve the Teleton CLI entrypoint for managed agents");
    }
    return {
      command: process.execPath,
      args: [...process.execArgv, scriptPath, "start", "-c", configPath],
    };
  }
}
