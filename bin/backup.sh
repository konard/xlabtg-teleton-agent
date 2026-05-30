#!/usr/bin/env sh
# bin/backup.sh — thin, cross-platform wrapper around `teleton backup`.
#
# Creates a timestamped, integrity-verified archive of all critical Teleton
# data (wallet, SQLite databases, sessions, config, workspace) under
# TELETON_HOME (default: ~/.teleton). Safe to run from cron / systemd timers.
#
# Usage:
#   bin/backup.sh [--out <dir>]
#
# The archive is written to <data>/backups by default, or to --out if given.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

# Prefer a globally installed `teleton`; fall back to the built CLI, then tsx.
if command -v teleton >/dev/null 2>&1; then
  exec teleton backup "$@"
elif [ -f "$REPO_ROOT/dist/cli/index.js" ]; then
  exec node "$REPO_ROOT/dist/cli/index.js" backup "$@"
else
  exec npx tsx "$REPO_ROOT/src/cli/index.ts" backup "$@"
fi
