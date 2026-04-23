#!/bin/bash
# Diagnose GitHub Actions status for xlabtg/teleton-agent
# Run: bash experiments/check-ci-status.sh

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
echo "=== Pending approval runs ==="
WAITING=$(gh api "repos/$UPSTREAM/actions/runs?status=waiting" --jq '.total_count')
ACTION_REQ=$(gh api "repos/$UPSTREAM/actions/runs?status=action_required" --jq '.total_count')
echo "Waiting for approval: $WAITING"
echo "Action required: $ACTION_REQ"
if [ "$ACTION_REQ" -gt 0 ]; then
  echo ""
  echo "ACTION REQUIRED: The following runs need your approval:"
  gh api "repos/$UPSTREAM/actions/runs?status=action_required" \
    --jq '.workflow_runs[] | "  - Run \(.id): \(.name) (PR #\(.pull_requests[0].number // "none")) — approve at: \(.html_url)"'
fi

echo ""
echo "=== Recent upstream runs (if any) ==="
gh api repos/$UPSTREAM/actions/runs --jq '.workflow_runs[:5][] | "\(.event) | \(.status) | \(.conclusion) | branch:\(.head_branch) | \(.created_at)"' 2>/dev/null || echo "(no runs)"

echo ""
echo "=== Open PRs with their check status ==="
gh pr list --repo $UPSTREAM --state open --json number,title,statusCheckRollup \
  --jq '.[] | "PR #\(.number): \(.title)\n  checks: \(.statusCheckRollup | length) check(s)"'

echo ""
echo "=== Upstream repo properties ==="
gh api repos/$UPSTREAM --jq '{fork, visibility, created_at, pushed_at, default_branch}'

echo ""
echo "=== Workflow triggers in ci.yml ==="
python3 -c "
import yaml, sys
try:
  with open('.github/workflows/ci.yml') as f:
    data = yaml.safe_load(f)
  triggers = data.get(True) or data.get('on') or {}
  print('Triggers:', list(triggers.keys()))
  concurrency = data.get('concurrency', {})
  print('Concurrency group:', concurrency.get('group', 'none'))
except Exception as e:
  print('Could not parse workflow:', e)
" 2>/dev/null || echo "(pyyaml not available — skipping yaml parse)"

echo ""
echo "=== Diagnosis ==="
if [ "$UPSTREAM_RUNS" -eq 0 ]; then
  echo "PROBLEM: GitHub Actions has NEVER run on $UPSTREAM (0 total runs)."
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "COMPLETE SETUP GUIDE FOR @xlabtg:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "STEP 1 — Enable GitHub Actions in Settings:"
  echo "  1. Go to: https://github.com/$UPSTREAM/settings/actions"
  echo "  2. Under 'Actions permissions', select:"
  echo "     ◉ Allow all actions and reusable workflows"
  echo "  3. Under 'Fork pull request workflows from outside collaborators':"
  echo "     ◉ Require approval for first-time contributors"
  echo "     (Only a contributor's FIRST PR needs manual approval;"
  echo "      subsequent PRs from the same person run automatically)"
  echo "  4. Click Save."
  echo ""
  echo "STEP 2 — Verify Actions are enabled in the Actions tab:"
  echo "  1. Go to: https://github.com/$UPSTREAM/actions"
  echo "  2. If you see a yellow banner saying 'Workflows aren't being run',"
  echo "     click 'Enable GitHub Actions workflows' or 'I understand my workflows'."
  echo "  3. This step is SEPARATE from Settings and is required for forked repos."
  echo ""
  echo "STEP 3 — Approve pending workflow runs for outside contributors:"
  echo "  After enabling Actions, open PRs from first-time contributors will show"
  echo "  a 'Waiting for approval' banner in the Actions tab."
  echo "  1. Go to: https://github.com/$UPSTREAM/actions"
  echo "  2. Click on any run with 'Action required' status"
  echo "  3. Click 'Approve and run' to allow the contributor's workflow to execute"
  echo ""
  echo "STEP 4 — Verify the fix:"
  echo "  After completing Steps 1-3, run this script again:"
  echo "    bash experiments/check-ci-status.sh"
  echo "  You should see a non-zero run count and passing checks on open PRs."
  echo ""
  echo "TROUBLESHOOTING:"
  echo "  - If count is still 0 after Steps 1-2, try disabling then re-enabling Actions."
  echo "  - Manually trigger a test run with:"
  echo "    gh workflow run ci.yml --repo $UPSTREAM"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
elif [ "$ACTION_REQ" -gt 0 ]; then
  echo "PARTIAL: Actions is enabled ($UPSTREAM_RUNS total runs) but $ACTION_REQ run(s) need approval."
  echo "Go to https://github.com/$UPSTREAM/actions and click 'Approve and run' on pending runs."
else
  echo "OK: Actions is running correctly ($UPSTREAM_RUNS total runs)."
fi
