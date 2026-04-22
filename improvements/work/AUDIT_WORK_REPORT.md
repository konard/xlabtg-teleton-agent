# Post-Audit Work Report

- **Audit issue:** [#250 — Комплексный аудит кодовой базы](https://github.com/xlabtg/teleton-agent/issues/250)
- **Audit PR:** [#251 — docs(audit): comprehensive codebase audit report](https://github.com/xlabtg/teleton-agent/pull/251)
- **Audit report:** [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md)
- **Generated:** 2026-04-22
- **Scope:** All 23 findings from the audit (4 Critical · 7 High · 8 Medium · 4 Low) plus CI infrastructure fixes.

This document records every finding from the audit, the GitHub issue filed for it, and the pull request that resolved it.

---

## Summary

| Severity | Findings | Issues filed | PRs merged |
|----------|----------|--------------|------------|
| 🔴 Critical | 4 | 4 | 4 |
| 🟠 High | 7 | 7 | 7 |
| 🟡 Medium | 8 | 8 | 8 |
| 🟢 Low | 4 | 4 | 4 |
| CI infrastructure | — | 2 | 2 |
| **Total** | **23** | **25** | **25** |

All 23 audit findings have been resolved. Every fix was filed as a dedicated GitHub issue, implemented in a dedicated branch, and merged via a pull request.

---

## 🔴 Critical Findings

### AUDIT-C1 — Policy `restrictedTools` list does not match any real tool name

| | |
|---|---|
| **Issue** | [#252 — audit-c1-policy-restricted-tools-mismatch](https://github.com/xlabtg/teleton-agent/issues/252) |
| **PR** | [#253 — fix(autonomous): restrict real TON wallet tools by name](https://github.com/xlabtg/teleton-agent/pull/253) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** `DEFAULT_POLICY_CONFIG.restrictedTools` listed tool names in the format `"wallet:send"`, `"contract:deploy"`, `"system:exec"` — names that do not exist in the tool registry. Real TON tools are registered in snake_case (`ton_send`, `jetton_send`, `exec`). As a result `PolicyEngine.checkAction()` never matched any real tool and never triggered `requiresEscalation` — autonomous tasks could call `ton_send`/`jetton_send` (real-money transfers) without user confirmation.

**Fix:** Changed the defaults to real tool names: `["ton_send", "jetton_send", "exec", "exec_run"]`. Added regression tests asserting that `ton_send` and `jetton_send` trigger `requiresEscalation`.

---

### AUDIT-C2 — `AutonomousTaskManager` is never stopped on agent shutdown

| | |
|---|---|
| **Issue** | [#254 — audit-c2-autonomous-manager-shutdown-leak](https://github.com/xlabtg/teleton-agent/issues/254) |
| **PR** | [#255 — fix(autonomous): stop task loops on agent shutdown](https://github.com/xlabtg/teleton-agent/pull/255) |
| **Severity** | 🔴 Critical · Reliability |
| **Status** | ✅ Fixed |

**Problem:** `autonomousManager` was declared as a local variable inside `startAgent()`. `stopAgent()` had no reference to it and never called `stopAll()`. Running loops continued executing LLM calls and writing to SQLite after shutdown, causing `SqliteError: database is closed` and duplicate/corrupted task state on restart.

**Fix:** Promoted `autonomousManager` to an instance field. Added `this.autonomousManager.stopAll()` in `stopAgent()` before `bridge.disconnect()`.

---

### AUDIT-C3 — Pause/resume resets rate-limits and loop-detection (policy bypass)

| | |
|---|---|
| **Issue** | [#256 — audit-c3-pause-resume-policy-bypass](https://github.com/xlabtg/teleton-agent/issues/256) |
| **PR** | [#257 — fix(autonomous): persist PolicyEngine state across pause/resume](https://github.com/xlabtg/teleton-agent/pull/257) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** When a task was paused and resumed, a fresh `PolicyEngine` instance was created, resetting all rate-limit counters and loop-detection state. An adversarial goal could exploit this by pausing and resuming repeatedly to bypass spending limits.

**Fix:** Serialised `PolicyEngine` state (rate-limit timestamps, loop detection windows, iteration counters) into the task checkpoint on pause, and restored it on resume.

---

### AUDIT-C4 — Full WebUI auth token printed to stdout at startup

| | |
|---|---|
| **Issue** | [#258 — audit-c4-auth-token-in-stdout](https://github.com/xlabtg/teleton-agent/issues/258) |
| **PR** | [#259 — fix(webui): stop leaking full auth token to stdout at startup](https://github.com/xlabtg/teleton-agent/pull/259) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** The startup log printed the full `auth_token` value to stdout, making it visible in process managers, log aggregation systems, and CI job output.

**Fix:** Replaced the full token with a redacted prefix (`token[:8]…`) in the startup log line.

---

## 🟠 High Findings

### AUDIT-H1 — `JSON.parse` in `rowTo*` has no try/catch

| | |
|---|---|
| **Issue** | [#260 — audit-h1-json-parse-no-try-catch](https://github.com/xlabtg/teleton-agent/issues/260) |
| **PR** | [#261 — fix(autonomous): guard rowTo\* JSON.parse with safe fallback](https://github.com/xlabtg/teleton-agent/pull/261) |
| **Severity** | 🟠 High · Reliability · P1 |
| **Status** | ✅ Fixed |

**Problem:** `rowToTask()`, `rowToCheckpoint()`, and similar DB-row helpers called `JSON.parse()` on stored JSON columns without a try/catch. A single malformed row in the database could crash the entire task-loading path and bring down autonomous mode.

**Fix:** Wrapped all `JSON.parse` calls in try/catch with safe fallbacks (empty arrays/objects). Added unit tests covering malformed JSON inputs.

---

### AUDIT-H2 — Escalations never reach the user

| | |
|---|---|
| **Issue** | [#262 — audit-h2-escalations-never-reach-user](https://github.com/xlabtg/teleton-agent/issues/262) |
| **PR** | [#263 — fix(autonomous): deliver escalations to user](https://github.com/xlabtg/teleton-agent/pull/263) |
| **Severity** | 🟠 High · UX · P1 |
| **Status** | ✅ Fixed |

**Problem:** When `PolicyEngine.checkAction()` set `requiresEscalation = true`, the code paused the task in the database but never sent a Telegram message to the admin. Escalations were silently log-only; the user would never know a task was waiting for approval.

**Fix:** Added a Telegram notification call after a task is moved to `paused` status due to escalation, including the task ID, goal summary, and the violation reason.

---

### AUDIT-H3 — `deps_planWithTimeout` leaks a `setTimeout`

| | |
|---|---|
| **Issue** | [#264 — audit-h3-settimeout-leak-plan-step](https://github.com/xlabtg/teleton-agent/issues/264) |
| **PR** | [#265 — fix(autonomous): clear planning timeout timer to prevent leak](https://github.com/xlabtg/teleton-agent/pull/265) |
| **Severity** | 🟠 High · Reliability · P2 |
| **Status** | ✅ Fixed |

**Problem:** `deps_planWithTimeout` started a `setTimeout` for the planning deadline but never cleared it when planning completed normally. This leaked a live timer that could fire after the task loop had already moved on, causing spurious cancellations or race conditions.

**Fix:** Stored the timer handle and called `clearTimeout()` in the `finally` block of the planning wrapper.

---

### AUDIT-H4 — Race between `pauseTask()` and in-flight step

| | |
|---|---|
| **Issue** | [#266 — audit-h4-pause-race-in-flight-step](https://github.com/xlabtg/teleton-agent/issues/266) |
| **PR** | [#267 — fix(autonomous): guard pause/cancel status from in-flight loop race](https://github.com/xlabtg/teleton-agent/pull/267) |
| **Severity** | 🟠 High · Reliability · P2 |
| **Status** | ✅ Fixed |

**Problem:** `pauseTask()` updated the task status in the DB without any mutex. If an in-flight execution step completed at the same moment, it could overwrite the `paused` status back to `running`, making the pause ineffective.

**Fix:** Added an in-memory abort flag per task that the loop checks before writing any status updates. `pauseTask()` and `cancelTask()` set the flag atomically before touching the DB.

---

### AUDIT-H5 — Unbounded `task_checkpoints` growth

| | |
|---|---|
| **Issue** | [#268 — audit-h5-unbounded-checkpoints-growth](https://github.com/xlabtg/teleton-agent/issues/268) |
| **PR** | [#269 — fix(autonomous): cap task_checkpoints growth](https://github.com/xlabtg/teleton-agent/pull/269) |
| **Severity** | 🟠 High · Performance · P2 |
| **Status** | ✅ Fixed |

**Problem:** The autonomous loop wrote a new checkpoint row after every step with no pruning. Long-running tasks would accumulate thousands of rows in `task_checkpoints`, eventually causing disk pressure and slow checkpoint reads.

**Fix:** Added a rolling-window pruning step: after inserting a new checkpoint, delete all but the most recent N checkpoints (configurable, default 50) for the same task.

---

### AUDIT-H6 — `admin_ids[0] ?? 0` silently escalates to non-existent user

| | |
|---|---|
| **Issue** | [#270 — audit-h6-admin-ids-fallback-zero](https://github.com/xlabtg/teleton-agent/issues/270) |
| **PR** | [#271 — fix(autonomous): refuse empty admin\_ids instead of silent senderId=0](https://github.com/xlabtg/teleton-agent/pull/271) |
| **Severity** | 🟠 High · Security · P2 |
| **Status** | ✅ Fixed |

**Problem:** When `admin_ids` was empty, the expression `admin_ids[0] ?? 0` silently used `senderId = 0`. Telegram user ID 0 does not correspond to any real user, so escalation messages were sent into a void with no error.

**Fix:** Added an early-exit check: if `admin_ids` is empty when the autonomous manager starts, throw a configuration error and refuse to start autonomous mode rather than silently failing.

---

### AUDIT-H7 — Setup wizard writes `auth_token` unauthenticated and unrate-limited

| | |
|---|---|
| **Issue** | [#272 — audit-h7-setup-wizard-unauth-unrate-limited](https://github.com/xlabtg/teleton-agent/issues/272) |
| **PR** | [#274 — fix(webui): gate setup launch with nonce, rate limit, hashed token](https://github.com/xlabtg/teleton-agent/pull/274) |
| **Severity** | 🟠 High · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** The setup wizard endpoint (`POST /api/setup`) accepted and persisted a new `auth_token` with no authentication and no rate limiting. Any unauthenticated attacker with network access to the agent port could call the endpoint, overwrite the token, and lock the legitimate user out.

**Fix:** Gated the setup endpoint behind a one-time-use nonce (printed to stdout at first launch), added an in-memory rate limiter (5 attempts per 15 minutes per IP), and stored only the bcrypt hash of the token, not the plaintext.

---

## 🟡 Medium Findings

### AUDIT-M1 — No global max-iteration safety cap

| | |
|---|---|
| **Issue** | [#282 — audit-m1-no-global-max-iteration-cap](https://github.com/xlabtg/teleton-agent/issues/282) |
| **PR** | [#283 — fix(autonomous): add global max-iteration safety cap](https://github.com/xlabtg/teleton-agent/pull/283) |
| **Severity** | 🟡 Medium · Reliability · P2 |
| **Status** | ✅ Fixed |

**Problem:** The per-task `maxSteps` limit could be set to any value in the goal, including very large numbers. There was no global ceiling, so a goal crafted to run `maxSteps = 100000` could hold a CPU core and burn LLM budget indefinitely.

**Fix:** Added `GLOBAL_MAX_ITERATIONS = 200` (configurable via `policy.globalMaxIterations`) as a hard ceiling enforced by the loop regardless of per-task settings.

---

### AUDIT-M2 — Rate-limit timestamps only pruned during `checkAction()`

| | |
|---|---|
| **Issue** | [#284 — audit-m2-rate-limit-timestamps-unbounded](https://github.com/xlabtg/teleton-agent/issues/284) |
| **PR** | [#285 — fix(AUDIT-M2): prune rate-limit timestamp arrays in record\* methods](https://github.com/xlabtg/teleton-agent/pull/285) |
| **Severity** | 🟡 Medium · Performance · P2 |
| **Status** | ✅ Fixed |

**Problem:** The in-memory rate-limit arrays (timestamps of past tool calls, TON spends, etc.) were only pruned when `checkAction()` was called. For tasks that ran many steps without hitting the rate-limit check path, the arrays grew without bound.

**Fix:** Added pruning at the start of every `record*()` method, not just during checks, so expired timestamps are removed on every write.

---

### AUDIT-M3 — `DEFAULT_POLICY_CONFIG.tonSpending` defaults are permissive

| | |
|---|---|
| **Issue** | [#286 — audit-m3-permissive-ton-spending-defaults](https://github.com/xlabtg/teleton-agent/issues/286) |
| **PR** | [#287 — fix(autonomous): tighten DEFAULT\_POLICY\_CONFIG.tonSpending defaults](https://github.com/xlabtg/teleton-agent/pull/287) |
| **Severity** | 🟡 Medium · Config · P3 |
| **Status** | ✅ Fixed |

**Problem:** Default spending limits were `1 TON/task` and `5 TON/day` — values that represent real money and are too high for an out-of-the-box default on a new installation.

**Fix:** Tightened defaults to `0.1 TON/task` and `0.5 TON/day`. Added documentation noting these should be configured explicitly for production use.

---

### AUDIT-M4 — `requiresEscalation` without recorded violation yields empty reason

| | |
|---|---|
| **Issue** | [#288 — audit-m4-empty-reason-on-escalation](https://github.com/xlabtg/teleton-agent/issues/288) |
| **PR** | [#289 — fix(autonomous): always record violation when escalation is triggered](https://github.com/xlabtg/teleton-agent/pull/289) |
| **Severity** | 🟡 Medium · UX · P2 |
| **Status** | ✅ Fixed |

**Problem:** Some code paths set `requiresEscalation = true` without calling `recordViolation()`. The escalation Telegram message then showed an empty reason string, leaving the user unable to understand why the task was paused.

**Fix:** Added a guard that ensures `recordViolation()` is always called before `requiresEscalation` is set to true, with a fallback reason `"policy check triggered escalation"` when the calling code does not supply one.

---

### AUDIT-M5 — Escalated/paused tasks have no auto-timeout

| | |
|---|---|
| **Issue** | [#290 — audit-m5-paused-forever-tasks](https://github.com/xlabtg/teleton-agent/issues/290) |
| **PR** | [#291 — feat(autonomous): add paused\_at timestamp and auto-cancel stale paused tasks](https://github.com/xlabtg/teleton-agent/pull/291) |
| **Severity** | 🟡 Medium · Reliability · P3 |
| **Status** | ✅ Fixed |

**Problem:** Tasks paused waiting for user approval had no timeout. If the user never responded, the task would remain in `paused` state forever, accumulating stale entries in the database.

**Fix:** Added a `paused_at` timestamp column to `autonomous_tasks`. A background sweeper (runs every 10 minutes) auto-cancels tasks that have been paused longer than `policy.escalationTimeoutHours` (default: 24 hours), notifying the admin via Telegram.

---

### AUDIT-M6 — Path-traversal guard inconsistent between servers

| | |
|---|---|
| **Issue** | [#292 — audit-m6-inconsistent-path-traversal-checks](https://github.com/xlabtg/teleton-agent/issues/292) |
| **PR** | [#293 — fix(security): unify path-traversal guard behind shared isPathInside helper](https://github.com/xlabtg/teleton-agent/pull/293) |
| **Severity** | 🟡 Medium · Security · P3 |
| **Status** | ✅ Fixed |

**Problem:** The WebUI server and the management API server each had their own path-traversal guard implementations. They used different normalisation logic, so a path that was correctly blocked by one could slip through the other.

**Fix:** Extracted a shared `isPathInside(base, target)` helper in `src/security/path.ts`, applied it consistently across both servers, and added tests covering symlink-based and `..`-based traversal attempts.

---

### AUDIT-M7 — Setup writes `api.host = "0.0.0.0"` by default

| | |
|---|---|
| **Issue** | [#294 — audit-m7-management-api-default-host](https://github.com/xlabtg/teleton-agent/issues/294) |
| **PR** | [#295 — fix(AUDIT-M7): default Management API host to 127.0.0.1 to prevent LAN exposure](https://github.com/xlabtg/teleton-agent/pull/295) |
| **Severity** | 🟡 Medium · Security · P3 |
| **Status** | ✅ Fixed |

**Problem:** The setup wizard wrote `api.host = "0.0.0.0"` into the generated config, binding the management API to all interfaces by default. This exposed the unauthenticated management API to the LAN (and to the internet on a cloud VM).

**Fix:** Changed the setup default to `"127.0.0.1"`. Added a warning comment in `config.example.yaml` explaining the risk of changing this to `0.0.0.0`.

---

### AUDIT-M8 — Setup Telegram sessions validate TTL only on creation

| | |
|---|---|
| **Issue** | [#296 — audit-m8-session-ttl-only-on-creation](https://github.com/xlabtg/teleton-agent/issues/296) |
| **PR** | [#297 — fix(AUDIT-M8): route all session access through getSession() to enforce TTL](https://github.com/xlabtg/teleton-agent/pull/297) |
| **Severity** | 🟡 Medium · Security · P3 |
| **Status** | ✅ Fixed |

**Problem:** Session TTL was checked only when a session was first loaded. Subsequent accesses within the same process lifetime used the cached session object without re-validating its expiry, so a session that expired during a long run remained active.

**Fix:** Routed all session access through a `getSession()` helper that re-checks TTL on every access and evicts expired sessions from the in-memory cache.

---

## 🟢 Low Findings

### AUDIT-L1 — Config schema `version` default disagrees with `package.json`

| | |
|---|---|
| **Issue** | [#273 — audit-l1-config-version-default-mismatch](https://github.com/xlabtg/teleton-agent/issues/273) |
| **PR** | [#275 — fix(config): sync MetaConfigSchema version default with package.json](https://github.com/xlabtg/teleton-agent/pull/275) |
| **Severity** | 🟢 Low · Config |
| **Status** | ✅ Fixed |

**Problem:** `MetaConfigSchema` had `version: z.string().default("1.0.0")` while `package.json` was at `0.8.10`. This mismatch could confuse migration logic that reads the config version to decide which SQL migrations to run.

**Fix:** Changed the default to read from `package.json` at build time, so the schema default always matches the deployed version.

---

### AUDIT-L2 — Error responses leak workspace absolute paths

| | |
|---|---|
| **Issue** | [#276 — audit-l2-error-responses-leak-workspace-paths](https://github.com/xlabtg/teleton-agent/issues/276) |
| **PR** | [#277 — fix(webui): sanitize WorkspaceSecurityError messages in API responses](https://github.com/xlabtg/teleton-agent/pull/277) |
| **Severity** | 🟢 Low · Security |
| **Status** | ✅ Fixed |

**Problem:** `WorkspaceSecurityError` messages included the absolute path of the workspace root (e.g. `/home/user/.teleton/workspace`). These were returned verbatim in 403 API responses, leaking server filesystem layout to any client.

**Fix:** Sanitised `WorkspaceSecurityError` messages in the error-handling middleware to strip the workspace root prefix before including them in responses.

---

### AUDIT-L3 — Audit middleware skips failed (4xx/5xx) mutations

| | |
|---|---|
| **Issue** | [#278 — audit-l3-audit-middleware-skips-failed-mutations](https://github.com/xlabtg/teleton-agent/issues/278) |
| **PR** | [#279 — fix(audit): log all mutations including 4xx/5xx responses](https://github.com/xlabtg/teleton-agent/pull/279) |
| **Severity** | 🟢 Low · Observability |
| **Status** | ✅ Fixed |

**Problem:** The audit-log middleware only logged mutations (`POST`/`PUT`/`DELETE`) that completed with a 2xx status. Failed mutations (validation errors, auth failures, server errors) were silently skipped, making the audit log an incomplete record.

**Fix:** Changed the middleware to log all non-`GET` requests regardless of response status, including the HTTP status code in the log entry so failures are distinguishable from successes.

---

### AUDIT-L4 — `maxParallelTasks` overflow throws instead of queuing

| | |
|---|---|
| **Issue** | [#280 — audit-l4-max-parallel-tasks-overflow-throws](https://github.com/xlabtg/teleton-agent/issues/280) |
| **PR** | [#281 — fix(autonomous): queue tasks instead of throwing when maxParallelTasks is reached](https://github.com/xlabtg/teleton-agent/pull/281) |
| **Severity** | 🟢 Low · UX |
| **Status** | ✅ Fixed |

**Problem:** When the number of running tasks reached `maxParallelTasks`, submitting a new task threw an unhandled error that surfaced as a 500 response. Users received no indication that their task would run later.

**Fix:** Implemented a FIFO pending queue. Overflow tasks enter `queued` status and are started automatically as running slots free up. The Telegram reply for a queued task tells the user their task is queued and will start soon.

---

## CI Infrastructure Fixes

### Issue #244 / #298 — CI workflows never ran

| | |
|---|---|
| **Issue** | [#244 — Check why CI workflows tests stopped running](https://github.com/xlabtg/teleton-agent/issues/244) · [#298 — Check why CI workflows tests stopped running](https://github.com/xlabtg/teleton-agent/issues/298) |
| **PR** | [#245 — fix(ci): restore CI checks on pull requests using pull\_request\_target](https://github.com/xlabtg/teleton-agent/pull/245) · [#299 — fix(ci): restore CI runs — enable Actions, fix concurrency, add workflow\_dispatch](https://github.com/xlabtg/teleton-agent/pull/299) |
| **Status** | ✅ Fixed |

**Problem (first occurrence, PR #245):** The workflow used a `pull_request` trigger on a forked repository, which GitHub disables by default — so CI never ran on PRs from the fork.

**Fix:** Switched to `pull_request_target`, which runs in the context of the base repository and is not subject to the fork restriction.

**Problem (recurrence, PR #299):** Even after the trigger fix, CI still never ran because GitHub Actions was not enabled at the repository level for the fork. Additionally, the concurrency group used `github.ref` under `pull_request_target`, which resolves to the base branch (`refs/heads/main`) for all PRs — causing every new PR to cancel all other in-flight PR runs.

**Fix:** Added instructions for the repository owner to enable Actions in settings. Fixed the concurrency group to use `github.event.pull_request.number || github.ref` so each PR gets its own slot. Added a `workflow_dispatch` trigger for manual testing.

---

## Files in This Folder

| File | Audit ID | Severity |
|------|----------|----------|
| [audit-c1-policy-restricted-tools-mismatch.md](audit-c1-policy-restricted-tools-mismatch.md) | C1 | 🔴 Critical |
| [audit-c2-autonomous-manager-shutdown-leak.md](audit-c2-autonomous-manager-shutdown-leak.md) | C2 | 🔴 Critical |
| [audit-c3-pause-resume-policy-bypass.md](audit-c3-pause-resume-policy-bypass.md) | C3 | 🔴 Critical |
| [audit-c4-auth-token-in-stdout.md](audit-c4-auth-token-in-stdout.md) | C4 | 🔴 Critical |
| [audit-h1-json-parse-no-try-catch.md](audit-h1-json-parse-no-try-catch.md) | H1 | 🟠 High |
| [audit-h2-escalations-never-reach-user.md](audit-h2-escalations-never-reach-user.md) | H2 | 🟠 High |
| [audit-h3-settimeout-leak-plan-step.md](audit-h3-settimeout-leak-plan-step.md) | H3 | 🟠 High |
| [audit-h4-pause-race-in-flight-step.md](audit-h4-pause-race-in-flight-step.md) | H4 | 🟠 High |
| [audit-h5-unbounded-checkpoints-growth.md](audit-h5-unbounded-checkpoints-growth.md) | H5 | 🟠 High |
| [audit-h6-admin-ids-fallback-zero.md](audit-h6-admin-ids-fallback-zero.md) | H6 | 🟠 High |
| [audit-h7-setup-wizard-unauth-unrate-limited.md](audit-h7-setup-wizard-unauth-unrate-limited.md) | H7 | 🟠 High |
| [audit-m1-no-global-max-iteration-cap.md](audit-m1-no-global-max-iteration-cap.md) | M1 | 🟡 Medium |
| [audit-m2-rate-limit-timestamps-unbounded.md](audit-m2-rate-limit-timestamps-unbounded.md) | M2 | 🟡 Medium |
| [audit-m3-permissive-ton-spending-defaults.md](audit-m3-permissive-ton-spending-defaults.md) | M3 | 🟡 Medium |
| [audit-m4-empty-reason-on-escalation.md](audit-m4-empty-reason-on-escalation.md) | M4 | 🟡 Medium |
| [audit-m5-paused-forever-tasks.md](audit-m5-paused-forever-tasks.md) | M5 | 🟡 Medium |
| [audit-m6-inconsistent-path-traversal-checks.md](audit-m6-inconsistent-path-traversal-checks.md) | M6 | 🟡 Medium |
| [audit-m7-management-api-default-host.md](audit-m7-management-api-default-host.md) | M7 | 🟡 Medium |
| [audit-m8-session-ttl-only-on-creation.md](audit-m8-session-ttl-only-on-creation.md) | M8 | 🟡 Medium |
| [audit-l1-config-version-default-mismatch.md](audit-l1-config-version-default-mismatch.md) | L1 | 🟢 Low |
| [audit-l2-error-responses-leak-workspace-paths.md](audit-l2-error-responses-leak-workspace-paths.md) | L2 | 🟢 Low |
| [audit-l3-audit-middleware-skips-failed-mutations.md](audit-l3-audit-middleware-skips-failed-mutations.md) | L3 | 🟢 Low |
| [audit-l4-max-parallel-tasks-overflow-throws.md](audit-l4-max-parallel-tasks-overflow-throws.md) | L4 | 🟢 Low |
