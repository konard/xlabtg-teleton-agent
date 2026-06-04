import type Database from "better-sqlite3";
import type { Config, ExecConfig } from "../../../config/schema.js";
import type { PluginModule, ToolExecutor, ToolScope } from "../types.js";
import { createLogger } from "../../../utils/logger.js";
import { execRunTool, createExecRunExecutor } from "./run.js";
import { execInstallTool, createExecInstallExecutor } from "./install.js";
import { execServiceTool, createExecServiceExecutor } from "./service.js";
import { execStatusTool, createExecStatusExecutor } from "./status.js";

const log = createLogger("Exec");

let moduleDb: Database.Database | null = null;
let moduleConfig: ExecConfig | null = null;

function resolveScope(scope: ExecConfig["scope"]): ToolScope {
  switch (scope) {
    case "admin-only":
      return "admin-only";
    case "allowlist":
      return "always";
    case "all":
      return "always";
  }
}

function enforceUserAllowlist<TParams>(
  execCfg: ExecConfig,
  executor: ToolExecutor<TParams>
): ToolExecutor<TParams> {
  if (execCfg.scope !== "allowlist") return executor;

  return async (params, context) => {
    if (!execCfg.allowlist.includes(context.senderId)) {
      return {
        success: false,
        error: "Exec tools are restricted to users listed in capabilities.exec.allowlist",
      };
    }

    return executor(params, context);
  };
}

const execModule: PluginModule = {
  name: "exec",
  version: "1.0.0",

  configure(config: Config) {
    moduleConfig = config.capabilities.exec;
  },

  migrate(db: Database.Database) {
    // exec_audit table is created in ensureSchema() — nothing extra needed here
    moduleDb = db;
  },

  tools(config: Config) {
    const execCfg = config.capabilities.exec;

    if (execCfg.mode === "off") {
      return [];
    }

    if (process.platform !== "linux") {
      log.warn("Exec capability requires Linux, disabling");
      return [];
    }

    if (!moduleDb) {
      log.error("Exec module has no database reference — tools disabled");
      return [];
    }

    const scope = resolveScope(execCfg.scope);
    const db = moduleDb;

    return [
      {
        tool: execRunTool,
        executor: enforceUserAllowlist(execCfg, createExecRunExecutor(db, execCfg)),
        scope,
      },
      {
        tool: execInstallTool,
        executor: enforceUserAllowlist(execCfg, createExecInstallExecutor(db, execCfg)),
        scope,
      },
      {
        tool: execServiceTool,
        executor: enforceUserAllowlist(execCfg, createExecServiceExecutor(db, execCfg)),
        scope,
      },
      {
        tool: execStatusTool,
        executor: enforceUserAllowlist(execCfg, createExecStatusExecutor(db, execCfg)),
        scope,
      },
    ];
  },

  async start() {
    if (!moduleConfig || moduleConfig.mode === "off") return;
    if (process.platform !== "linux") return;
    log.info({ mode: moduleConfig.mode, scope: moduleConfig.scope }, "Exec capability active");
  },
};

export default execModule;
