import { Command } from "commander";
import { onboardCommand } from "./commands/onboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { mcpAddCommand, mcpRemoveCommand, mcpListCommand } from "./commands/mcp.js";
import { configCommand } from "./commands/config.js";
import { apiRotateKeyCommand, apiFingerprintCommand } from "./commands/api.js";
import { autonomousCommand } from "./commands/autonomous.js";
import { main as startApp } from "../index.js";
import { configExists, getDefaultConfigPath } from "../config/loader.js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getErrorMessage } from "../utils/errors.js";

function findPackageJson(): Record<string, unknown> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf-8"));
    }
    dir = dirname(dir);
  }
  return { version: "0.0.0" };
}
const packageJson = findPackageJson();

const program = new Command();

program
  .name("teleton")
  .description("Teleton Agent - Personal AI Agent for Telegram")
  .version(packageJson.version as string);

// Setup command
program
  .command("setup")
  .description("Interactive wizard to set up Teleton")
  .option("--workspace <dir>", "Workspace directory")
  .option("--non-interactive", "Non-interactive mode")
  .option("--ui", "Launch web-based setup wizard")
  .option("--ui-port <port>", "Port for setup WebUI", "7777")
  .option("--api-id <id>", "Telegram API ID")
  .option("--api-hash <hash>", "Telegram API Hash")
  .option("--phone <number>", "Phone number")
  .option("--api-key <key>", "LLM provider API key")
  .option("--base-url <url>", "Base URL for local LLM server")
  .option("--user-id <id>", "Telegram User ID")
  .option("--tavily-api-key <key>", "Tavily API key for web search")
  .action(async (options) => {
    try {
      await onboardCommand({
        workspace: options.workspace,
        nonInteractive: options.nonInteractive,
        ui: options.ui,
        uiPort: options.uiPort,
        apiId: options.apiId ? parseInt(options.apiId) : undefined,
        apiHash: options.apiHash,
        phone: options.phone,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        userId: options.userId ? parseInt(options.userId) : undefined,
        tavilyApiKey: options.tavilyApiKey,
      });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

// Start command
program
  .command("start")
  .description("Start the Teleton agent")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .option("--webui", "Enable WebUI server (overrides config)")
  .option("--webui-port <port>", "WebUI server port (default: 7777)")
  .option("--api", "Enable Management API server (overrides config)")
  .option("--api-port <port>", "Management API port (default: 7778)")
  .option("--json-credentials", "Output API credentials as JSON to stdout on start")
  .action(async (options) => {
    try {
      // If --api flag and no config: start API-only bootstrap mode
      if (options.api && !configExists(options.config)) {
        if (options.apiPort) {
          process.env.TELETON_API_PORT = options.apiPort;
        }
        if (options.jsonCredentials) {
          process.env.TELETON_JSON_CREDENTIALS = "true";
        }
        const { startApiOnly } = await import("../api/bootstrap.js");
        await startApiOnly({ config: options.config, apiPort: options.apiPort });
        return;
      }

      // Normal flow: config required
      if (!configExists(options.config)) {
        console.error("❌ Configuration not found");
        console.error(`   Expected file: ${options.config}`);
        console.error("\n💡 Run first: teleton setup");
        console.error("   Or use: teleton start --api (for API-only bootstrap)");
        process.exit(1);
      }

      // Set environment variables for WebUI flags (will be picked up by config loader)
      if (options.webui) {
        process.env.TELETON_WEBUI_ENABLED = "true";
      }
      if (options.webuiPort) {
        process.env.TELETON_WEBUI_PORT = options.webuiPort;
      }

      // Set environment variables for API flags (will be picked up by config loader)
      if (options.api) {
        process.env.TELETON_API_ENABLED = "true";
      }
      if (options.apiPort) {
        process.env.TELETON_API_PORT = options.apiPort;
      }
      if (options.jsonCredentials) {
        process.env.TELETON_JSON_CREDENTIALS = "true";
      }

      await startApp(options.config);
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Run system health checks")
  .action(async () => {
    try {
      await doctorCommand();
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

// MCP server management
const mcp = program.command("mcp").description("Manage MCP (Model Context Protocol) servers");

mcp
  .command("add <package> [args...]")
  .description(
    "Add an MCP server (e.g. teleton mcp add @modelcontextprotocol/server-filesystem /tmp)"
  )
  .option("-n, --name <name>", "Server name (auto-derived from package if omitted)")
  .option("-s, --scope <scope>", "Tool scope: always | dm-only | group-only | admin-only", "always")
  .option(
    "-e, --env <KEY=VALUE...>",
    "Environment variables (repeatable)",
    (v: string, prev: string[]) => [...prev, v],
    [] as string[]
  )
  .option("--url", "Treat <package> as an SSE/HTTP URL instead of an npx package")
  .option("-c, --config <path>", "Config file path")
  .action(async (pkg: string, args: string[], options) => {
    try {
      await mcpAddCommand(pkg, args, options);
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

mcp
  .command("remove <name>")
  .description("Remove an MCP server by name")
  .option("-c, --config <path>", "Config file path")
  .action(async (name: string, options) => {
    try {
      await mcpRemoveCommand(name, options);
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

mcp
  .command("list")
  .description("List configured MCP servers")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await mcpListCommand(options);
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

// Config management
program
  .command("config")
  .description("Manage configuration keys (set, get, list, unset)")
  .argument("<action>", "set | get | list | unset")
  .argument("[key]", "Config key (e.g., tavily_api_key, telegram.bot_token)")
  .argument("[value]", "Value to set (prompts interactively if omitted)")
  .option("-c, --config <path>", "Config file path")
  .action(async (action: string, key: string | undefined, value: string | undefined, options) => {
    try {
      await configCommand(action, key, value, options);
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

// Management API commands
program
  .command("api-rotate-key")
  .description("Generate a new Management API key")
  .option("-c, --config <path>", "Config file path", getDefaultConfigPath())
  .action(async (options) => {
    try {
      await apiRotateKeyCommand({ config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

program
  .command("api-fingerprint")
  .description("Show TLS certificate fingerprint")
  .action(async () => {
    try {
      await apiFingerprintCommand();
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

// Autonomous mode commands
const autonomous = program
  .command("autonomous")
  .description("Manage autonomous tasks (Autonomous Task Engine)");

autonomous
  .command("enable")
  .description("Create and enqueue a new autonomous task")
  .requiredOption("--task <goal>", "Goal description in natural language")
  .option("--priority <level>", "Priority: low|medium|high|critical", "medium")
  .option("--strategy <s>", "Strategy: conservative|balanced|aggressive", "balanced")
  .option("--max-iterations <n>", "Maximum loop iterations")
  .option("--max-hours <n>", "Maximum duration in hours")
  .option(
    "--success-criteria <c>",
    "Success criteria (repeatable)",
    (v: string, prev: string[]) => [...prev, v],
    [] as string[]
  )
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("enable", {
        task: options.task,
        priority: options.priority,
        strategy: options.strategy,
        maxIterations: options.maxIterations,
        maxHours: options.maxHours,
        successCriteria: options.successCriteria,
        config: options.config,
      });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("disable")
  .description("Stop and cancel autonomous task(s)")
  .option("--id <taskId>", "Task ID to cancel")
  .option("--force", "Cancel all active tasks")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("disable", {
        id: options.id,
        force: options.force,
        config: options.config,
      });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("pause")
  .description("Pause a running autonomous task")
  .requiredOption("--id <taskId>", "Task ID")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("pause", { id: options.id, config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("resume")
  .description("Resume a paused autonomous task")
  .requiredOption("--id <taskId>", "Task ID")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("resume", { id: options.id, config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("status")
  .description("Show status of autonomous task(s)")
  .option("--id <taskId>", "Task ID (omit to show all active)")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("status", { id: options.id, config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("list")
  .description("List all autonomous tasks")
  .option("--limit <n>", "Max results to show", "20")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("list", { limit: options.limit, config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

autonomous
  .command("clean")
  .description("Clean old task checkpoints")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await autonomousCommand("clean", { config: options.config });
    } catch (error) {
      console.error("Error:", getErrorMessage(error));
      process.exit(1);
    }
  });

program.action(() => {
  program.help();
});

program.parse(process.argv);
