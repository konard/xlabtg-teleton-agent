#!/bin/sh
# Full a11y verification pipeline. Logs everything to PIPELINE.log and writes a
# final one-line verdict to PIPELINE.status. Safe to re-run.
set -u
cd /tmp/gh-issue-solver-1780101166480
LOG=PIPELINE.log
: > "$LOG"

say() { echo "=== $* ===" | tee -a "$LOG"; }

say "apply fixes"
python3 apply_a11y.py >> "$LOG" 2>&1

cd web

say "npm install (sync lockfile)"
npm install >> "../$LOG" 2>&1
echo "npm install exit=$?" >> "../$LOG"

say "npm audit --audit-level=high"
npm audit --audit-level=high >> "../$LOG" 2>&1
echo "AUDIT_EXIT=$?" | tee -a "../$LOG"

say "playwright install chromium"
npx playwright install --with-deps chromium >> "../$LOG" 2>&1
echo "pw install exit=$?" >> "../$LOG"

say "build"
npm run build >> "../$LOG" 2>&1
echo "BUILD_EXIT=$?" | tee -a "../$LOG"

say "a11y audit (CI mode)"
rm -rf a11y-report
CI=1 A11Y_PORT=4231 npm run test:a11y >> "../$LOG" 2>&1
A11Y_EXIT=$?
echo "A11Y_EXIT=$A11Y_EXIT" | tee -a "../$LOG"

BLOCKING=$(node -e "try{const r=require('./a11y-report/baseline.json');console.log(r.totalBlocking)}catch(e){console.log('ERR')}" 2>>"../$LOG")
ADVISORY=$(node -e "try{const r=require('./a11y-report/baseline.json');console.log(r.totalAdvisory)}catch(e){console.log('ERR')}" 2>>"../$LOG")
echo "BLOCKING=$BLOCKING ADVISORY=$ADVISORY" | tee -a "../$LOG"

cd ..
echo "VERDICT a11y_exit=$A11Y_EXIT blocking=$BLOCKING advisory=$ADVISORY" > PIPELINE.status
cat PIPELINE.status >> "$LOG"
say "DONE"
