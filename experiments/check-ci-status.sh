#!/bin/bash
# Check CI status for issue #244 investigation
# This script verifies why CI is not running on PRs

UPSTREAM="xlabtg/teleton-agent"
FORK="konard/xlabtg-teleton-agent"

echo "=== Upstream CI runs ==="
gh api repos/$UPSTREAM/actions/runs --jq '.total_count'

echo ""
echo "=== Fork CI runs ==="
gh api repos/$FORK/actions/runs --jq '.total_count'

echo ""
echo "=== Fork event types ==="
gh api repos/$FORK/actions/runs --jq '[.workflow_runs[] | .event] | unique'

echo ""
echo "=== konard's permissions on upstream ==="
gh api repos/$UPSTREAM --jq '.permissions'

echo ""
echo "=== Workflow triggers in ci.yml ==="
python3 -c "
import yaml
with open('.github/workflows/ci.yml') as f:
    data = yaml.safe_load(f)
print('Triggers:', list(data[True].keys()))
"
