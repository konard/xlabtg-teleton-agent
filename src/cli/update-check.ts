import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/teleton/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;
const PROMPT_TIMEOUT_MS = 10_000;

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [cMajor, cMinor, cPatch] = parse(current);
  const [lMajor, lMinor, lPatch] = parse(latest);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

function findPackageRoot(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function isNpmInstall(): boolean {
  // Skip in Docker
  if (existsSync("/.dockerenv")) return false;

  // Skip in dev/git clone — look for .git next to package.json
  const root = findPackageRoot();
  if (!root) return false;
  if (existsSync(join(root, ".git"))) return false;

  return true;
}

function getCachePath(): string {
  return join(homedir(), ".teleton", ".update-check");
}

function readCache(): UpdateCache | undefined {
  try {
    const raw = readFileSync(getCachePath(), "utf-8");
    const data = JSON.parse(raw) as UpdateCache;
    if (typeof data.lastCheck === "number" && typeof data.latestVersion === "string") {
      return data;
    }
  } catch {
    // Cache missing or corrupt — fetch fresh
  }
  return undefined;
}

function writeCache(cache: UpdateCache): void {
  const dir = join(homedir(), ".teleton");
  if (!existsSync(dir)) return; // dir created by setup — skip if absent
  writeFileSync(getCachePath(), JSON.stringify(cache), { mode: 0o600 });
}

async function fetchLatestVersion(): Promise<string | undefined> {
  const res = await fetch(NPM_REGISTRY_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { version?: string };
  return data.version;
}

function printBanner(current: string, latest: string): void {
  const line1 = `  Update available: ${chalk.red(current)} ${chalk.dim("→")} ${chalk.green(latest)}`;
  const line2 = `  Run: ${chalk.cyan("npm i -g teleton@latest")}`;

  // Measure visible width (strip ANSI) to size the box
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const width = Math.max(stripAnsi(line1).length, stripAnsi(line2).length) + 2;

  const top = `┌${"─".repeat(width)}┐`;
  const bot = `└${"─".repeat(width)}┘`;
  const pad = (s: string) => {
    const visible = stripAnsi(s).length;
    return `│${s}${" ".repeat(width - visible)}│`;
  };

  console.log();
  console.log(chalk.yellow(top));
  console.log(chalk.yellow(pad(line1)));
  console.log(chalk.yellow(pad(line2)));
  console.log(chalk.yellow(bot));
  console.log();
}

function promptInstall(latest: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const timer = setTimeout(() => {
      rl.close();
      resolve();
    }, PROMPT_TIMEOUT_MS);

    rl.question("Install now? (y/N) ")
      .then((answer) => {
        clearTimeout(timer);
        rl.close();

        if (answer.trim().toLowerCase() !== "y") {
          resolve();
          return;
        }

        const child = spawn("npm", ["i", "-g", `teleton@latest`], {
          stdio: "inherit",
        });

        child.on("close", (code) => {
          if (code === 0) {
            console.log(chalk.green(`\n✓ Updated to v${latest} — please restart: teleton start`));
            process.exit(0);
          }
          // Non-zero exit — just continue
          resolve();
        });

        child.on("error", () => {
          // spawn failed — continue silently
          resolve();
        });
      })
      .catch(() => {
        clearTimeout(timer);
        rl.close();
        resolve();
      });
  });
}

export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    if (!isNpmInstall()) return;

    let latestVersion: string | undefined;
    const cache = readCache();

    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      latestVersion = cache.latestVersion;
    } else {
      latestVersion = await fetchLatestVersion();
      if (latestVersion) {
        writeCache({ lastCheck: Date.now(), latestVersion });
      }
    }

    if (!latestVersion) return;
    if (!isNewerVersion(currentVersion, latestVersion)) return;

    printBanner(currentVersion, latestVersion);
    await promptInstall(latestVersion);
  } catch {
    // Swallow all errors — never crash or delay startup
  }
}
