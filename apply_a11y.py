#!/usr/bin/env python3
"""Idempotently apply all issue-499 a11y fixes and report state.

Safe to run repeatedly. Writes a concise report to APPLY_LOG.txt and stdout.
"""
import json
import os
import re
import sys

ROOT = "/tmp/gh-issue-solver-1780101166480"
os.chdir(ROOT)
log_lines = []


def log(msg):
    log_lines.append(str(msg))
    print(msg, flush=True)


def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


# ---------------------------------------------------------------- index.css ---
CSS = "web/src/index.css"
log("== index.css exists: %s" % os.path.exists(CSS))
if os.path.exists(CSS):
    css = read(CSS)
    if "WCAG 2.1 AA fixes (issue #499)" not in css:
        css = css.rstrip("\n") + """

/* --- WCAG 2.1 AA fixes (issue #499) --------------------------------------- */
/* Brighter accent for text on the soft accent background (active nav item).   */
/* #5b8cff on the blended #1b2136 surface is only 3.86:1; #8fb0ff reaches      */
/* 5.45:1, clearing the WCAG AA 4.5:1 threshold for normal-size text.          */
:root {
  --accent-bright: #8fb0ff;
}
.nav-item.active {
  color: var(--accent-bright);
}
/* Respect the reduced-motion preference (WCAG 2.3.3 / 2.2.2) and keep entrance */
/* animations from interfering with axe colour-contrast sampling.              */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
"""
        write(CSS, css)
        log("   index.css: appended WCAG fixes")
    else:
        log("   index.css: fixes already present")
    log("   index.css accent-bright count: %d" % css.count("accent-bright"))
    log("   index.css reduced-motion count: %d" % css.count("prefers-reduced-motion"))

# --------------------------------------------------------- package.json -------
PKG = "web/package.json"
pkg = read(PKG)
d = json.loads(pkg)
removed = False
for sect in ("devDependencies", "dependencies"):
    if sect in d and "@lhci/cli" in d[sect]:
        del d[sect]["@lhci/cli"]
        removed = True
if removed:
    # Targeted removal preserving formatting where possible.
    new = re.sub(r'[ \t]*"@lhci/cli":\s*"[^"]*",?\n', "", pkg)
    # Fix a possible dangling comma before a closing brace.
    new = re.sub(r",(\s*\n\s*})", r"\1", new)
    try:
        json.loads(new)
        write(PKG, new)
    except Exception:
        write(PKG, json.dumps(d, indent=2) + "\n")
    log("== package.json: removed @lhci/cli")
else:
    log("== package.json: no @lhci/cli present")
log("   package.json has axe-core: %s" % ("axe-core" in read(PKG)))
log("   package.json has @playwright/test: %s" % ("@playwright/test" in read(PKG)))

# ----------------------------------------------------- playwright.config.ts ---
PC = "web/playwright.config.ts"
log("== playwright.config.ts exists: %s" % os.path.exists(PC))
if os.path.exists(PC):
    pc = read(PC)
    orig = pc
    pc = pc.replace("http://localhost:", "http://127.0.0.1:")
    # Ensure preview server binds to the loopback IPv4 address explicitly.
    if "--strictPort" in pc and "--host 127.0.0.1" not in pc:
        pc = pc.replace("--strictPort", "--strictPort --host 127.0.0.1")
    if pc != orig:
        write(PC, pc)
        log("   playwright.config.ts: normalised host -> 127.0.0.1")
    else:
        log("   playwright.config.ts: host already 127.0.0.1")
    log("   has 127.0.0.1: %s" % ("127.0.0.1" in pc))
    log("   has --host 127.0.0.1: %s" % ("--host 127.0.0.1" in pc))
    log("   has webServer timeout: %s" % ("timeout" in pc))

# --------------------------------------------------------- docs / ci probe ----
log("== docs/accessibility.md exists: %s" % os.path.exists("docs/accessibility.md"))
CI = ".github/workflows/ci.yml"
if os.path.exists(CI):
    ci = read(CI)
    log("== ci.yml has 'accessibility' job: %s" % ("accessibility" in ci))
    log("== ci.yml has 'test:a11y': %s" % ("test:a11y" in ci))
else:
    log("== ci.yml: MISSING")

# --------------------------------------------------------- e2e files probe ----
log("== e2e files: %s" % sorted(os.listdir("web/e2e")) if os.path.exists("web/e2e") else "no e2e")
log("== a11y.spec has emulateMedia: %s" % ("emulateMedia" in read("web/e2e/a11y.spec.ts")))
log("== a11y.spec has getAnimations: %s" % ("getAnimations" in read("web/e2e/a11y.spec.ts")))

write("APPLY_LOG.txt", "\n".join(log_lines) + "\n")
print("=== DONE ===", flush=True)
