#!/bin/sh
# Gate on a clean audit, clean up scratch files, make atomic commits, merge main,
# and push. Everything is logged to COMMIT_RESULT.txt.
set -u
cd /tmp/gh-issue-solver-1780101166480
R=COMMIT_RESULT.txt
: > "$R"
say() { echo "=== $* ===" >> "$R"; }

# ---- Gate 1: a11y blocking == 0 -------------------------------------------
BLOCKING=$(node -e "try{console.log(require('./web/a11y-report/baseline.json').totalBlocking)}catch(e){console.log('ERR')}" 2>>"$R")
ADVISORY=$(node -e "try{console.log(require('./web/a11y-report/baseline.json').totalAdvisory)}catch(e){console.log('ERR')}" 2>>"$R")
echo "A11Y_BLOCKING=$BLOCKING A11Y_ADVISORY=$ADVISORY" >> "$R"

# ---- Gate 2: security audit ------------------------------------------------
( cd web && npm audit --audit-level=high >/dev/null 2>&1 ); echo "WEB_AUDIT_EXIT=$?" >> "$R"

if [ "$BLOCKING" != "0" ]; then
  echo "ABORT: a11y blocking violations present; not committing" >> "$R"
  echo "----- summary.md -----" >> "$R"
  cat web/a11y-report/summary.md >> "$R" 2>/dev/null
  exit 0
fi

# ---- Clean up scratch files -----------------------------------------------
say "cleanup"
rm -f apply_a11y.py run_pipeline.sh DUMP.txt APPLY_LOG.txt STATE2.txt \
      VERIFY_STATE.txt FINAL_STATE.txt PIPELINE.log PIPELINE.status \
      v_log.txt v_st.txt 2>>"$R"
rm -f web/audit.clean.txt web/viol.txt 2>>"$R"
rm -rf web/test-results web/a11y-report 2>>"$R"

# ---- Ensure audit artifacts are ignored -----------------------------------
if [ -f web/.gitignore ]; then
  grep -q "a11y-report" web/.gitignore || \
    printf "\n# Playwright accessibility audit artifacts\na11y-report/\ntest-results/\nplaywright-report/\n" >> web/.gitignore
else
  printf "# Playwright accessibility audit artifacts\na11y-report/\ntest-results/\nplaywright-report/\n" > web/.gitignore
fi

git config user.name  >/dev/null 2>&1 || git config user.name  "konard"
git config user.email >/dev/null 2>&1 || git config user.email "link.assistant.team@proton.me"

# ---- Atomic commits -------------------------------------------------------
say "commit 1: a11y test infra"
git add web/e2e/a11y.spec.ts web/e2e/mock-api.ts web/playwright.config.ts \
        web/package.json web/package-lock.json web/.gitignore
git commit -m "test(a11y): добавить axe-core аудит по всем 23 страницам WebUI" >> "$R" 2>&1

say "commit 2: contrast + reduced-motion"
git add web/src/index.css
git commit -m "fix(a11y): исправить контраст активной ссылки навигации и учесть prefers-reduced-motion" >> "$R" 2>&1

say "commit 3: CI a11y gate"
git add .github/workflows/accessibility.yml
git commit -m "ci(a11y): добавить gate доступности WCAG 2.1 AA на каждый PR" >> "$R" 2>&1

say "commit 4: docs"
git add docs/accessibility.md
git commit -m "docs(a11y): добавить docs/accessibility.md (WCAG 2.1 AA)" >> "$R" 2>&1

say "git status after commits"
git status --porcelain >> "$R" 2>&1

# ---- Merge main -----------------------------------------------------------
say "merge origin/main"
git fetch origin >> "$R" 2>&1
git merge origin/main --no-edit >> "$R" 2>&1
echo "MERGE_EXIT=$?" >> "$R"

# ---- Push -----------------------------------------------------------------
say "push"
git push origin issue-499-aa140238a8b8 >> "$R" 2>&1
echo "PUSH_EXIT=$?" >> "$R"

say "final state"
echo "HEAD=$(git rev-parse HEAD)" >> "$R"
echo "HEAD_SHORT=$(git rev-parse --short HEAD)" >> "$R"
echo "ORIGIN=$(git rev-parse origin/issue-499-aa140238a8b8 2>/dev/null)" >> "$R"
git log --oneline -10 >> "$R" 2>&1
echo "DIRTY=$(git status --porcelain | wc -l)" >> "$R"
say "DONE"
