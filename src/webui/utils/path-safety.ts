import { resolve, relative, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";

/**
 * Returns true if `child` resolves to a path strictly inside `parent`.
 *
 * Uses realpathSync (when the path exists) to follow symlinks, preventing
 * symlink-based escape attacks in addition to ordinary `..` traversal.
 * The `parent` itself is NOT considered "inside" — callers that need to allow
 * exact equality should add an explicit check.
 */
export function isPathInside(child: string, parent: string): boolean {
  const resolvedChild = safeRealpath(resolve(child));
  const resolvedParent = safeRealpath(resolve(parent));
  const rel = relative(resolvedParent, resolvedChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // Path does not exist yet; fall back to syntactic resolve so callers can
    // guard paths before they are created (e.g. upload targets).
    return p;
  }
}
