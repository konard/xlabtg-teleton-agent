import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { createLogger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { GOCOON_VERSION, binDir, gocoonBin, runnerBin, versionSentinel } from "./paths.js";

const log = createLogger("gocoon");

const REPO = "TONresistor/gocoon";
const DOWNLOAD_TIMEOUT_MS = 120_000;

interface Platform {
  os: "darwin" | "linux" | "windows";
  arch: "amd64" | "arm64";
}

export function detectPlatform(): Platform {
  const osMap: Record<string, Platform["os"]> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, Platform["arch"]> = { x64: "amd64", arm64: "arm64" };
  const os = osMap[process.platform];
  const arch = archMap[process.arch];
  if (!os || !arch) {
    throw new Error(`gocoon: unsupported platform ${process.platform}/${process.arch}`);
  }
  return { os, arch };
}

export interface GocoonBinaries {
  gocoon: string;
  runner: string;
}

export function isInstalled(): boolean {
  return (
    existsSync(versionSentinel()) &&
    readFileSync(versionSentinel(), "utf-8").trim() === GOCOON_VERSION &&
    existsSync(gocoonBin()) &&
    existsSync(runnerBin())
  );
}

// Download the pinned release, verify its SHA-256, extract both binaries into
// ~/.teleton/bin. Idempotent via the version sentinel.
export async function ensureGocoonBinaries(): Promise<GocoonBinaries> {
  const out: GocoonBinaries = { gocoon: gocoonBin(), runner: runnerBin() };
  if (isInstalled()) return out;

  const { os, arch } = detectPlatform();
  const archive = `gocoon-${GOCOON_VERSION}-${os}-${arch}.tar.gz`;
  const base = `https://github.com/${REPO}/releases/download/${GOCOON_VERSION}`;
  log.info(`Installing gocoon ${GOCOON_VERSION} (${os}/${arch})`);

  const [tar, shaLine] = await Promise.all([
    fetchBuffer(`${base}/${archive}`),
    fetchText(`${base}/${archive}.sha256`),
  ]);

  const expected = shaLine.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(tar).digest("hex");
  if (!expected || expected !== actual) {
    throw new Error(
      `gocoon checksum mismatch for ${archive} (expected ${expected}, got ${actual})`
    );
  }

  mkdirSync(binDir(), { recursive: true });
  // Temp dir under binDir so the final rename stays on one filesystem (no EXDEV).
  const tmp = join(binDir(), `.extract-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tarPath = join(tmp, archive);
  writeFileSync(tarPath, tar);
  try {
    execFileSync("tar", ["-xzf", tarPath, "-C", tmp], { stdio: "pipe" });
    const ext = os === "windows" ? ".exe" : "";
    for (const [name, dest] of [
      ["gocoon", out.gocoon],
      ["gocoon-runner", out.runner],
    ] as const) {
      const src = join(tmp, name + ext);
      if (!existsSync(src)) throw new Error(`gocoon: archive ${archive} is missing ${name}${ext}`);
      renameSync(src, dest);
      if (os !== "windows") chmodSync(dest, 0o755);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  writeFileSync(versionSentinel(), GOCOON_VERSION);
  log.info(`gocoon ${GOCOON_VERSION} installed`);
  return out;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (!res.ok) throw new Error(`gocoon: download failed ${url} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (!res.ok) throw new Error(`gocoon: download failed ${url} (HTTP ${res.status})`);
  return res.text();
}
