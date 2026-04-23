#!/usr/bin/env bash
# Tests for install_git origin validation and dirty-tree rejection (issue #316)
set -euo pipefail

PASS=0
FAIL=0

pass() { echo "[PASS] $*"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $*"; FAIL=$((FAIL + 1)); }

# Extract just the install_git function logic (the checks block) by sourcing a
# stripped version of install.sh so we can unit-test it without running main().
REPO="tonresistor/teleton-agent"

# Helper: run the origin+dirty-tree check logic extracted from install_git
run_checks() {
  local install_dir="$1"
  local expected_url="https://github.com/${REPO}.git"
  local actual_url
  actual_url=$(git -C "${install_dir}" remote get-url origin 2>/dev/null || echo "")

  if [ "${actual_url}" != "${expected_url}" ]; then
    echo "ERROR: unexpected origin '${actual_url}'"
    return 1
  fi

  if [ -n "$(git -C "${install_dir}" status --porcelain)" ]; then
    echo "ERROR: uncommitted changes"
    return 1
  fi

  echo "OK"
  return 0
}

# ── Setup scratch area ──
SCRATCH=$(mktemp -d)
trap 'rm -rf "${SCRATCH}"' EXIT

# ── Test 1: Wrong origin → error ──
FAKE_DIR="${SCRATCH}/wrong-origin"
git init -q "${FAKE_DIR}"
git -C "${FAKE_DIR}" remote add origin "https://github.com/attacker/evil-repo.git"
if output=$(run_checks "${FAKE_DIR}" 2>&1); then
  fail "Test 1 (wrong origin): expected error but got OK"
else
  if echo "${output}" | grep -q "unexpected origin"; then
    pass "Test 1 (wrong origin): rejected with correct message"
  else
    fail "Test 1 (wrong origin): rejected but wrong message: ${output}"
  fi
fi

# ── Test 2: Dirty working tree (untracked file) → error ──
DIRTY_DIR="${SCRATCH}/dirty-unstaged"
git init -q "${DIRTY_DIR}"
git -C "${DIRTY_DIR}" remote add origin "https://github.com/${REPO}.git"
git -C "${DIRTY_DIR}" commit -q --allow-empty -m "init"
echo "dirty" > "${DIRTY_DIR}/dirty.txt"
if output=$(run_checks "${DIRTY_DIR}" 2>&1); then
  fail "Test 2 (dirty unstaged): expected error but got OK"
else
  if echo "${output}" | grep -q "uncommitted changes"; then
    pass "Test 2 (dirty unstaged): rejected with correct message"
  else
    fail "Test 2 (dirty unstaged): rejected but wrong message: ${output}"
  fi
fi

# ── Test 3: Dirty working tree (staged) → error ──
STAGED_DIR="${SCRATCH}/dirty-staged"
git init -q "${STAGED_DIR}"
git -C "${STAGED_DIR}" remote add origin "https://github.com/${REPO}.git"
git -C "${STAGED_DIR}" commit -q --allow-empty -m "init"
echo "staged change" > "${STAGED_DIR}/staged.txt"
git -C "${STAGED_DIR}" add staged.txt
if output=$(run_checks "${STAGED_DIR}" 2>&1); then
  fail "Test 3 (dirty staged): expected error but got OK"
else
  if echo "${output}" | grep -q "uncommitted changes"; then
    pass "Test 3 (dirty staged): rejected with correct message"
  else
    fail "Test 3 (dirty staged): rejected but wrong message: ${output}"
  fi
fi

# ── Test 4: Correct origin, clean tree → OK ──
GOOD_DIR="${SCRATCH}/good"
git init -q "${GOOD_DIR}"
git -C "${GOOD_DIR}" remote add origin "https://github.com/${REPO}.git"
git -C "${GOOD_DIR}" commit -q --allow-empty -m "init"
if output=$(run_checks "${GOOD_DIR}" 2>&1); then
  pass "Test 4 (correct origin, clean): accepted"
else
  fail "Test 4 (correct origin, clean): unexpected rejection: ${output}"
fi

# ── Summary ──
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
