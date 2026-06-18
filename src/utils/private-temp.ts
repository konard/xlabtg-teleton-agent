import { chmodSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TELETON_ROOT } from "../workspace/paths.js";

const SAFE_SCOPE = /^[a-zA-Z0-9_-]+$/;

function validateScope(scope: string): string {
  if (!SAFE_SCOPE.test(scope)) {
    throw new Error(`Invalid private temp scope: ${scope}`);
  }
  return scope;
}

function validateExtension(extension: string): string {
  const normalized = extension.startsWith(".") ? extension.slice(1) : extension;
  if (!SAFE_SCOPE.test(normalized)) {
    throw new Error(`Invalid private temp extension: ${extension}`);
  }
  return normalized;
}

export function ensurePrivateTempDir(scope: string): string {
  const dir = join(TELETON_ROOT, "tmp", validateScope(scope));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

export function createPrivateTempPath(scope: string, extension: string): string {
  const dir = ensurePrivateTempDir(scope);
  return join(dir, `${randomUUID()}.${validateExtension(extension)}`);
}
