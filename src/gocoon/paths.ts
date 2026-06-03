import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";

/** Pinned gocoon release. Bump deliberately — the installer verifies the SHA-256 of this exact tag. */
export const GOCOON_VERSION = "v0.2.0";

/** gocoon control-plane / OpenAI-compatible API default port. */
export const GOCOON_DEFAULT_PORT = 10000;

const exe = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

/** Directory holding managed binaries (shared with other tools). */
export const binDir = (): string => join(TELETON_ROOT, "bin");
export const gocoonBin = (): string => join(binDir(), exe("gocoon"));
export const runnerBin = (): string => join(binDir(), exe("gocoon-runner"));
export const versionSentinel = (): string => join(binDir(), ".gocoon-version");

/** gocoon data dir: wallet.json, client-config.json, ton-config.json. */
export const gocoonDataDir = (): string => join(TELETON_ROOT, "gocoon");
export const walletPath = (): string => join(gocoonDataDir(), "wallet.json");
export const clientConfigPath = (): string => join(gocoonDataDir(), "client-config.json");
export const tonConfigPath = (): string => join(gocoonDataDir(), "ton-config.json");

/** Local runner base URL for a given port. */
export const runnerBaseUrl = (port: number = GOCOON_DEFAULT_PORT): string =>
  `http://127.0.0.1:${port}`;
