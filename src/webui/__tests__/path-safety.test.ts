/**
 * AUDIT-M6: Unit tests for the isPathInside path-traversal guard helper.
 * Covers traversal sequences, absolute paths, symlinks, unicode, and edge cases.
 */
import { describe, it, expect } from "vitest";
import { isPathInside } from "../utils/path-safety.js";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isPathInside", () => {
  const parent = "/var/www/html";

  // ── happy-path ────────────────────────────────────────────────────────────

  it("returns true for a direct child file", () => {
    expect(isPathInside("/var/www/html/index.html", parent)).toBe(true);
  });

  it("returns true for a deeply nested child", () => {
    expect(isPathInside("/var/www/html/assets/js/app.js", parent)).toBe(true);
  });

  it("returns true for a child with redundant dot segments that normalise inside", () => {
    expect(isPathInside("/var/www/html/./assets/../index.html", parent)).toBe(true);
  });

  // ── path-traversal ────────────────────────────────────────────────────────

  it("returns false for single .. traversal out of parent", () => {
    expect(isPathInside("/var/www/html/../secret.txt", parent)).toBe(false);
  });

  it("returns false for double ../.. traversal", () => {
    expect(isPathInside("/var/www/html/../../etc/passwd", parent)).toBe(false);
  });

  it("returns false when child equals parent exactly", () => {
    // The parent directory itself is not considered 'inside'.
    expect(isPathInside("/var/www/html", parent)).toBe(false);
  });

  it("returns false for an absolute path outside parent", () => {
    expect(isPathInside("/etc/passwd", parent)).toBe(false);
  });

  it("returns false for a sibling directory", () => {
    expect(isPathInside("/var/www/other/file.txt", parent)).toBe(false);
  });

  // ── tricky edge cases ─────────────────────────────────────────────────────

  it("returns false for a path that only shares a prefix (not a real child)", () => {
    // /var/www/html-evil looks like it starts with /var/www/html
    // but is actually a sibling, not a child.
    expect(isPathInside("/var/www/html-evil/file.txt", parent)).toBe(false);
  });

  it("returns true for a child path given with trailing slash on parent", () => {
    expect(isPathInside("/var/www/html/index.html", "/var/www/html/")).toBe(true);
  });

  it("returns true for a unicode filename inside parent", () => {
    expect(isPathInside("/var/www/html/文件.html", parent)).toBe(true);
  });

  it("returns false for an empty child string (resolves to cwd, which is outside parent)", () => {
    // resolve("") === process.cwd(), which is unlikely to be inside /var/www/html
    const result = isPathInside("", parent);
    // The cwd is not /var/www/html, so this must be false.
    expect(result).toBe(false);
  });

  // ── symlink tests (real filesystem) ──────────────────────────────────────

  it("returns false for a symlink that points outside parent", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "path-safety-"));
    const innerDir = join(tmpRoot, "inner");
    mkdirSync(innerDir);
    // Create a symlink inside innerDir pointing one level up (outside)
    const linkPath = join(innerDir, "escape");
    symlinkSync(tmpdir(), linkPath);

    try {
      // The symlink target resolves outside tmpRoot/inner, so must be false.
      expect(isPathInside(linkPath, innerDir)).toBe(false);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("returns true for a symlink that points inside parent", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "path-safety-"));
    const innerDir = join(tmpRoot, "inner");
    const targetDir = join(tmpRoot, "inner", "target");
    mkdirSync(targetDir, { recursive: true });
    const linkPath = join(innerDir, "link-to-target");
    symlinkSync(targetDir, linkPath);

    try {
      expect(isPathInside(linkPath, innerDir)).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
