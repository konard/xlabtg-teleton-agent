#!/usr/bin/env sh
# bin/restore.sh — thin, cross-platform wrapper around `teleton restore`.
#
# Restores Teleton data from a backup archive. A safety backup of the current
# state is created before anything is overwritten. STOP THE AGENT FIRST.
#
# Usage:
#   bin/restore.sh --file <archive.tar.gz> [--force] [--yes]
#
# Omit --file to restore the most recent archive from <data>/backups.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if command -v teleton >/dev/null 2>&1; then
  exec teleton restore "$@"
elif [ -f "$REPO_ROOT/dist/cli/index.js" ]; then
  exec node "$REPO_ROOT/dist/cli/index.js" restore "$@"
else
  exec npx tsx "$REPO_ROOT/src/cli/index.ts" restore "$@"
fi
