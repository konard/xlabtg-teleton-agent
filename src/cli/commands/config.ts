import { readFileSync } from "fs";
import { getDefaultConfigPath } from "../../config/loader.js";
import { createPrompter, CancelledError } from "../prompts.js";
import {
  CONFIGURABLE_KEYS,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  readRawConfig,
  writeRawConfig,
} from "../../config/configurable-keys.js";
import type { ConfigKeyMeta } from "../../config/configurable-keys.js";

// ── Whitelist guard ────────────────────────────────────────────────────

function requireWhitelisted(key: string): ConfigKeyMeta {
  const meta = CONFIGURABLE_KEYS[key];
  if (!meta) {
    const allowed = Object.keys(CONFIGURABLE_KEYS).join(", ");
    console.error(`Key "${key}" is not configurable.\n   Allowed keys: ${allowed}`);
    process.exit(1);
  }
  return meta;
}

// ── Actions ────────────────────────────────────────────────────────────

// ── argv redaction helper ──────────────────────────────────────────────

/**
 * Overwrite all occurrences of `secret` in process.argv with "<redacted>"
 * so that subsequent /proc/<pid>/cmdline snapshots no longer contain it.
 */
function redactArgv(secret: string): void {
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === secret) {
      process.argv[i] = "<redacted>";
    }
  }
}

// ── Env-var name derivation ───────────────────────────────────────────

/** Returns the TELETON_<KEY> env var name for a config key (dots → underscores, uppercase). */
function envVarName(key: string): string {
  return `TELETON_${key.toUpperCase().replace(/\./g, "_")}`;
}

// ── actionSet ─────────────────────────────────────────────────────────

async function actionSet(
  key: string,
  value: string | undefined,
  configPath: string,
  valueFile?: string
): Promise<void> {
  const meta = requireWhitelisted(key);

  // Immediately zero out any matching argv slot to prevent ps-aux leaks,
  // even if we are about to reject the call.
  if (value !== undefined) {
    redactArgv(value);
  }

  if (meta.sensitive && value !== undefined) {
    // Sensitive secret passed as a positional argv argument — reject it.
    console.error(
      `Error: "${key}" is a sensitive key. Passing its value on the command line exposes it ` +
        `in process listings (ps aux) and shell history.\n` +
        `Use one of these safe alternatives instead:\n` +
        `  • Interactive prompt:  teleton config set ${key}\n` +
        `  • File:                teleton config set ${key} --value-file /path/to/secret\n` +
        `  • Environment var:     ${envVarName(key)}=<value> teleton config set ${key}`
    );
    process.exit(1);
  }

  // --value-file: read secret from a file (no argv exposure)
  if (valueFile !== undefined) {
    value = readFileSync(valueFile, "utf-8").trimEnd();
  }

  // Env var: TELETON_<KEY>=<value>
  if (value === undefined) {
    const envVar = envVarName(key);
    const envVal = process.env[envVar];
    if (envVal !== undefined) {
      value = envVal;
    }
  }

  // Interactive prompt fallback
  if (value === undefined) {
    const prompter = createPrompter();
    try {
      if (meta.sensitive) {
        value = await prompter.password({
          message: `Enter value for ${key}:`,
          validate: (v) => {
            if (!v) return "Value is required";
            const err = meta.validate(v);
            return err ? new Error(err) : undefined;
          },
        });
      } else {
        value = await prompter.text({
          message: `Enter value for ${key}:`,
          validate: (v) => {
            if (!v) return "Value is required";
            const err = meta.validate(v);
            return err ? new Error(err) : undefined;
          },
        });
      }
    } catch (e) {
      if (e instanceof CancelledError) {
        console.log("Cancelled.");
        return;
      }
      throw e;
    }
  }

  const err = meta.validate(value);
  if (err) {
    console.error(`Invalid value for ${key}: ${err}`);
    process.exit(1);
  }

  const raw = readRawConfig(configPath);
  setNestedValue(raw, key, meta.parse(value));
  writeRawConfig(raw, configPath);
  // Do not echo the value (even masked) — just confirm it was saved.
  console.log(`✓ ${key} updated`);
}

function actionGet(key: string, configPath: string): void {
  const meta = requireWhitelisted(key);
  const raw = readRawConfig(configPath);
  const value = getNestedValue(raw, key);

  if (value == null || value === "") {
    console.log(`✗ ${key}  (not set)`);
  } else {
    const display = meta.sensitive ? meta.mask(String(value)) : String(value);
    console.log(`✓ ${key} = ${display}`);
  }
}

function actionList(configPath: string): void {
  const raw = readRawConfig(configPath);

  console.log("\nConfigurable keys:\n");
  for (const [key, meta] of Object.entries(CONFIGURABLE_KEYS)) {
    const value = getNestedValue(raw, key);
    if (value != null && value !== "") {
      const display = meta.sensitive ? meta.mask(String(value)) : String(value);
      console.log(`  ✓ ${key.padEnd(24)} = ${display}`);
    } else {
      console.log(`  ✗ ${key.padEnd(24)}   (not set)`);
    }
  }
  console.log();
}

function actionUnset(key: string, configPath: string): void {
  requireWhitelisted(key);
  const raw = readRawConfig(configPath);
  deleteNestedValue(raw, key);
  writeRawConfig(raw, configPath);
  console.log(`✓ ${key} unset`);
}

// ── Exported command handler ───────────────────────────────────────────

export async function configCommand(
  action: string,
  key: string | undefined,
  value: string | undefined,
  options: { config?: string; valueFile?: string }
): Promise<void> {
  const configPath = options.config ?? getDefaultConfigPath();

  switch (action) {
    case "list":
      actionList(configPath);
      break;

    case "get":
      if (!key) {
        console.error("Usage: teleton config get <key>");
        process.exit(1);
      }
      actionGet(key, configPath);
      break;

    case "set":
      if (!key) {
        console.error("Usage: teleton config set <key> [value]");
        process.exit(1);
      }
      await actionSet(key, value, configPath, options.valueFile);
      break;

    case "unset":
      if (!key) {
        console.error("Usage: teleton config unset <key>");
        process.exit(1);
      }
      actionUnset(key, configPath);
      break;

    default:
      console.error(`Unknown action: ${action}\nAvailable: set, get, list, unset`);
      process.exit(1);
  }
}
