#!/bin/bash
# Check CI status for issue #298 investigation
# This script verifies why CI is not running on PRs and reports the diagnosis.

set -euo pipefail

UPSTREAM="xlabtg/teleton-agent"
FORK="konard/xlabtg-teleton-agent"

echo "=== GitHub Actions run counts ==="
UPSTREAM_RUNS=$(gh api repos/$UPSTREAM/actions/runs --jq '.total_count')
FORK_RUNS=$(gh api repos/$FORK/actions/runs --jq '.total_count')
echo "Upstream ($UPSTREAM) total runs: $UPSTREAM_RUNS"
echo "Fork ($FORK) total runs: $FORK_RUNS"

echo ""
echo "=== Workflow states on upstream ==="
gh api repos/$UPSTREAM/actions/workflows --jq '.workflows[] | "\(.name): \(.state)"'

echo ""
echo "=== Recent upstream runs (if any) ==="
gh api repos/$UPSTREAM/actions/runs --jq '.workflow_runs[:5][] | "\(.event) | \(.status) | \(.conclusion) | branch:\(.head_branch) | \(.created_at)"' 2>/dev/null || echo "(no runs)"

echo ""
echo "=== konard permissions on upstream ==="
gh api repos/$UPSTREAM --jq '.permissions'

echo ""
echo "=== Upstream repo properties ==="
gh api repos/$UPSTREAM --jq '{fork, visibility, created_at, pushed_at, default_branch}'

echo ""
echo "=== Workflow triggers in ci.yml ==="
python3 -c "
import yaml
with open('.github/workflows/ci.yml') as f:
    data = yaml.safe_load(f)
triggers = data.get(True) or data.get('on') or {}
print('Triggers:', list(triggers.keys()))
concurrency = data.get('concurrency', {})
print('Concurrency group:', concurrency.get('group', 'none'))
"

echo ""
echo "=== Diagnosis ==="
if [ "$UPSTREAM_RUNS" -eq 0 ]; then
  echo "PROBLEM: GitHub Actions has never run on $UPSTREAM (0 total runs)."
  echo ""
  echo "Root cause: GitHub Actions is disabled on this repository."
  echo ""
  echo "ACTION REQUIRED (for repo owner @xlabtg):"
  echo "  1. Go to: https://github.com/$UPSTREAM/settings/actions"
  echo "  2. Under 'Actions permissions', select 'Allow all actions and reusable workflows'"
  echo "  3. Under 'Fork pull request workflows from outside collaborators',"
  echo "     select 'Require approval for first-time contributors' (or less restrictive)."
  echo "  4. Save changes."
  echo ""
  echo "After enabling Actions, the workflow will trigger on:"
  echo "  - push to main"
  echo "  - pull_request_target (PRs from forks)"
  echo "  - workflow_dispatch (manual trigger)"
else
  echo "Actions is running (total: $UPSTREAM_RUNS runs)."
fi
