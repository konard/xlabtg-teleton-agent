# Audit Report: Teleton Agent

- **Issue:** [xlabtg/teleton-agent#250](https://github.com/xlabtg/teleton-agent/issues/250)
- **Executed:** 2026-04-22
- **Model:** Claude Opus 4.7 (`claude-opus-4-7`)
- **Scope:** `src/autonomous/**`, `src/memory/agent/autonomous-tasks.ts`,
  `src/webui/**`, `src/security/**`, `src/cli/commands/autonomous.ts`,
  `src/index.ts` lifecycle, `src/memory/migrations/1.20.0.sql`.
- **Version audited:** `package.json` → `0.8.10`; schema version `1.20.0`.

## Executive Summary

Teleton Agent is structurally solid: the autonomous loop has clear phases
(plan → policy-check → execute → reflect → checkpoint), the WebUI
implements auth + CSRF + body-size limits + basic security headers, and
SQL migrations use FK cascades with sensible indexes. However, the audit
uncovered **several real, reproducible defects** — two of which are
security-relevant in the autonomous/financial flow and one which is a
direct lifecycle bug that leaks the running autonomous loops past agent
shutdown.

| Severity | Count | Headline |
| --- | --- | --- |
| 🔴 Critical | 4 | Tool-restriction list does not match real tool names; autonomous manager is never stopped on shutdown; pause-resume resets rate-limits/loop-detection; full auth token printed to logs. |
| 🟠 High | 7 | JSON.parse crashes on malformed rows; escalations are log-only (never reach user); timer leak in planning timeout; race between pause and in-flight step; unbounded checkpoint growth; `admin_ids[0]` falls back to `0`; setup wizard writes auth token to disk unauthenticated and unrate-limited. |
| 🟡 Medium | 8 | Missing global max-iteration safety cap; rate-limit timestamps unbounded between checks; default TON budget very permissive; escalation without recorded violation hides reason; unhelpful UX on empty `admin_ids`; escalated tasks pause without timeout; inconsistent path-traversal checks between servers; management API host defaults to `0.0.0.0` during setup. |
| 🟢 Low | 4 | Config schema default `version = 1.0.0` disagrees with `package.json`; 404/403 leak workspace absolute paths; audit middleware skips failed mutations; `maxParallelTasks` overflow throws instead of queuing. |

**Risk for production: 🟠 Conditional Go.** Fix the four critical findings
and the highest-priority high findings (especially H-1, H-2, H-7) before
enabling autonomous mode on wallets with material balances. Outside the
autonomous/TON path the code is low-risk.

---

## Critical findings

### AUDIT-C1 — Policy `restrictedTools` list does not match any real tool name
**Severity:** 🔴 Critical · **Category:** security · **Effort:** small

**Location:** `src/autonomous/policy-engine.ts:34`

```ts
restrictedTools: ["wallet:send", "contract:deploy", "system:exec"],
```

**Evidence:** The real TON tools register under snake_case names, e.g.
`src/agent/tools/ton/send.ts:16` → `name: "ton_send"`,
`src/agent/tools/ton/jetton-send.ts:22` → `name: "jetton_send"`. There
is no tool named `wallet:send`, `contract:deploy`, or `system:exec` in
`src/agent/tools/**` or `src/plugins/**`. Therefore the
`restrictedTools` gate in `PolicyEngine.checkAction()` never matches and
**never sets `requiresEscalation`** for TON sends.

**Impact:** Autonomous tasks can call `ton_send` / `jetton_send` without
user confirmation up to `constraints.budgetTON` (default `1 TON/task`,
`5 TON/day`), bypassing the human-in-the-loop safeguard the design
intends. This is the single highest-impact finding because the project
touches real-money transfers.

**Remediation:**
1. Change default to real tool names:
   `restrictedTools: ["ton_send", "jetton_send", "exec", "exec_run"]`.
2. Add a regression test in
   `src/autonomous/__tests__/policy-engine.test.ts` that asserts
   `ton_send` triggers `requiresEscalation`.
3. Longer-term: introduce tool categories (e.g. `tool.category = "wallet_write"`)
   and let the policy engine match by category instead of exact name.

---

### AUDIT-C2 — `AutonomousTaskManager` is never stopped on agent shutdown
**Severity:** 🔴 Critical · **Category:** reliability · **Effort:** small

**Location:** `src/index.ts:333-414` vs `src/index.ts:1487-1583`

**Evidence:** `autonomousManager` is declared as a **local variable
inside `startAgent()`** (line 333), passed into `WebUIServer`/`ApiServer`,
then goes out of scope. `stopAgent()` (line 1487) clears the heartbeat,
workflow scheduler, plugin watcher, bridge — but has no reference to
the manager and never calls `stopAll()`. The running loops therefore
keep executing LLM calls, tool calls, and writing to SQLite after
`agent.stop`, which is the exact teardown path SIGTERM triggers.

**Impact:**
- On shutdown, in-flight autonomous steps race the DB close and can
  throw `SqliteError: database is closed`.
- On WebUI-driven "stop agent" + "start agent", the OLD loops keep running
  on the old DB handle and a NEW manager is created, producing duplicate
  work and corrupted task state.
- SIGTERM is effectively a kill for autonomous tasks — checkpoints may
  be half-written.

**Remediation:**
1. Promote to instance field:
   `private autonomousManager: AutonomousTaskManager | null = null;`
2. In `stopAgent()` add (before `bridge.disconnect()`):
   ```ts
   if (this.autonomousManager) {
     this.autonomousManager.stopAll();
     this.autonomousManager = null;
   }
   ```
3. Optionally await loop termination via a `stopAllAndWait()` helper
   that resolves when all `runningLoops` .finally blocks have fired.

---

### AUDIT-C3 — Pause/resume resets rate-limits and loop-detection (policy bypass)
**Severity:** 🔴 Critical · **Category:** security · **Effort:** medium

**Location:** `src/autonomous/manager.ts:84-126`, `src/autonomous/loop.ts:68-80`

**Evidence:** `AutonomousTaskManager.runLoop()` constructs a **new**
`AutonomousLoop` on both start and resume (`new AutonomousLoop(...)`
at line 85). The new loop creates a new `PolicyEngine`
(`this.policyEngine = new PolicyEngine(...)`) and an empty
`recentActions: string[] = []`. Neither is persisted. On
`pauseTask()` + `resumeTask()`:
- `toolCallTimestamps` / `apiCallTimestamps` arrays are wiped →
  `rateLimit.toolCallsPerHour` and `apiCallsPerMinute` are reset.
- `recentActions` is wiped → `loopDetection.maxIdenticalActions` is
  reset.
- `consecutiveUncertainCount` is wiped → uncertainty escalation resets.

**Impact:** A user or buggy caller can bypass the 100-calls-per-hour
cap and the 5-identical-action loop detector by scripting
pause/resume. In practice this also defeats the uncertainty escalator,
letting a stuck agent keep burning API credit.

**Remediation:**
1. Persist rate-limit state to a new `policy_state` table keyed by
   `task_id`, or inline it into `task_checkpoints.state`.
2. In `runLoop()` on resume, hydrate the `PolicyEngine` from storage
   instead of constructing fresh.
3. Add a test that calls pause+resume between two rate-limited
   batches and asserts the limit still trips.

---

### AUDIT-C4 — Full WebUI auth token printed to stdout at startup
**Status:** ✅ Fixed (issue #258) · **Severity:** 🔴 Critical · **Category:** security (information disclosure) · **Effort:** small

**Location:** `src/webui/server.ts` (see `start()`)

**Evidence (before fix):** `start()` used to print the plaintext token
as part of the `/auth/exchange` URL via `log.info(...)` even though
`maskToken()` was already used on the next line. Any centralized log
drain (journalctl, Docker log driver, `tsx --log-file`, CI artefact,
`teleton --debug > log.txt`) would permanently store a session token
that is valid for 7 days (`COOKIE_MAX_AGE` in
`src/webui/middleware/auth.ts`).

**Impact (before fix):** Anyone with access to the agent's process logs
gained full API access to the WebUI for up to 7 days, including the
wallet and autonomous task endpoints.

**Resolution:** `start()` now logs only the URL without the token and
the masked token. The full one-time exchange link is written with a
raw `process.stderr.write(...)`, which bypasses the pino logger and
therefore does not flow into stdout, the WebUI SSE stream, `pino-pretty`
output, file log redirection, or any `LogListener`. A regression test
in `src/webui/__tests__/server-auth-token-log.test.ts` asserts the full
token never appears in logger output.

---

## High findings

### AUDIT-H1 — `JSON.parse` in `rowTo*` has no try/catch
**Severity:** 🟠 High · **Category:** reliability · **Effort:** small

**Location:** `src/memory/agent/autonomous-tasks.ts:119-163`

**Evidence:** Seven `JSON.parse(...)` calls in `rowToTask`, two in
`rowToCheckpoint`, one in `rowToLogEntry`. No try/catch. A single row
with corrupt JSON (manual DB edit, crash mid-write, backfill bug)
throws out of `listTasks`/`getTask`/`getExecutionLogs` and breaks the
`/api/autonomous` screen entirely.

**Impact:** A single bad row DoSes the autonomous dashboard.

**Remediation:** Wrap each parse with a helper
`safeJSONParse(value, fallback, { taskId })` that logs the error and
returns the fallback (`{}`, `[]`, or `undefined`). Skip truly broken
rows rather than throwing.

---

### AUDIT-H2 — Escalations never reach the user
**Severity:** 🟠 High · **Category:** security / UX · **Effort:** small

**Location:** `src/autonomous/integration.ts:110-115`

```ts
notify: async (message: string, taskId: string): Promise<void> => {
  log.warn({ taskId, message }, "Autonomous task escalation");
},
```

**Evidence:** The production `notify` function only writes to the
logger. There is no Telegram message via `deps.bridge`, no WebUI event,
no database entry separate from the execution log. A policy-triggered
escalation (`requiresEscalation === true` in `loop.ts:192-209`) pauses
the task and the user finds out only by polling the UI.

**Impact:** The human-in-the-loop safeguard that the policy engine
implements does not actually loop a human in. For TON-spending
escalations, this is a direct safety regression.

**Remediation:** Route escalations through `deps.bridge.sendMessage` to
`admin_ids[0]` (or every admin in `admin_ids`) and emit a
`notificationBus` event so the WebUI surfaces it. Keep the log line as
a fallback.

---

### AUDIT-H3 — `deps_planWithTimeout` leaks a `setTimeout` on every plan step
**Severity:** 🟠 High · **Category:** reliability · **Effort:** small

**Location:** `src/autonomous/loop.ts:359-370`

```ts
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Planning timed out after 30s")), PLAN_TIMEOUT_MS)
);
return Promise.race([deps.planNextAction(task, history, checkpoint), timeout]);
```

**Evidence:** The timer is not captured, not cleared when
`planNextAction` resolves first, and the outer race winner cannot
cancel the losing promise. Every successful plan leaves a
30-second-armed timer on the event loop.

**Impact:** For tasks with hundreds/thousands of iterations the event
loop fills with pending timers; GC also retains the closures they
reference (the `task`, `history`, `checkpoint`). Memory grows roughly
linearly with loop iterations until the timers fire.

**Remediation:**
```ts
const controller = new AbortController();
const timeout = new Promise<never>((_, reject) => {
  const t = setTimeout(() => reject(new Error("Planning timed out")), PLAN_TIMEOUT_MS);
  controller.signal.addEventListener("abort", () => clearTimeout(t));
});
try {
  return await Promise.race([deps.planNextAction(task, history, checkpoint), timeout]);
} finally {
  controller.abort();
}
```

---

### AUDIT-H4 — Race between `pauseTask()` and the in-flight loop's `.finally`
**Severity:** 🟠 High · **Category:** reliability / consistency · **Effort:** medium

**Location:** `src/autonomous/manager.ts:84-118`

**Evidence:** `pauseTask()` calls `loop.stop()`, deletes the map entry,
and calls `updateTaskStatus("paused")`. The `.then/.catch/.finally` on
`loop.run(task)` runs **later**; if the currently-awaited step
(`executeTool` or `selfReflect`) resolves or throws before observing
`abortController.aborted`, the loop can still call
`updateTaskStatus("failed", { error })` (see `loop.ts:150`) **after**
pause has written `paused`. Also, if the step succeeds and the loop
continues past line 115's abort check, it runs another full cycle.

**Impact:** A paused task can land in status `failed` or silently keep
running. Particularly visible in tests that pause immediately after
start.

**Remediation:**
1. Gate status transitions in `loop.run()` by reading the current DB
   status before every `updateTaskStatus` — do not overwrite `paused`
   or `cancelled`.
2. Check `abortController.signal.aborted` immediately after each
   `await` inside the loop, not only at the `while` header.

---

### AUDIT-H5 — Unbounded `task_checkpoints` growth
**Severity:** 🟠 High · **Category:** technical debt · **Effort:** small

**Location:** `src/autonomous/loop.ts:306-320`, `src/memory/agent/autonomous-tasks.ts:359-368`

**Evidence:** `saveCheckpoint` runs once per iteration with no per-task
cap. `cleanOldCheckpoints()` (7-day TTL) skips active tasks and is
never called automatically.

**Impact:** Long-running tasks accumulate tens of thousands of rows;
`getLastCheckpoint` is indexed so it stays fast, but backup / export /
`listCheckpoints` operations slow down and disk usage is
unpredictable.

**Remediation:** Add `keepLastN` parameter (default 20) to
`saveCheckpoint` and delete older ones in the same transaction.
Schedule `cleanOldCheckpoints()` from the same cron / interval that
other retention jobs use (`src/memory/retention.ts`).

---

### AUDIT-H6 — `admin_ids[0] ?? 0` silently escalates to a non-existent user
**Severity:** 🟠 High · **Category:** security · **Effort:** small

**Location:** `src/autonomous/integration.ts:91`, `src/index.ts:839,1436`

```ts
const adminSenderId = config.telegram.admin_ids[0] ?? 0;
```

**Evidence:** When `admin_ids` is empty, the autonomous task runs as
`senderId = 0`. Some tools check `senderId` against `admin_ids` to
gate admin-only behaviour; with `0` the check fails silently. Tool
failures propagate as generic "Tool execution failed" errors, making
diagnosis hard.

**Impact:** Admin-only tools never succeed when `admin_ids` is empty;
autonomous mode appears broken with no clear error. Also, logs/audit
trail attribute actions to user ID 0, a real Telegram ID collision
(the bot itself).

**Remediation:** If `admin_ids` is empty, refuse to start the
autonomous manager with a clear error (or fall back to explicit
"system" marker). Same fix makes the heartbeat path (`index.ts:839`)
log a warning instead of silently skipping.

---

### AUDIT-H7 — Setup wizard writes `auth_token` to `config.yaml` unauthenticated & unrate-limited
**Severity:** 🟠 High · **Category:** security · **Effort:** small

**Location:** `src/webui/setup-server.ts:132-161`

**Evidence:** `POST /api/setup/launch` on port 7777 generates a random
token, writes it in **plaintext** to `config.yaml`, and returns it in
the response body. The setup server is bound to `127.0.0.1:7777` but
has **no auth**, no CSRF and no rate-limit. Anything on the same host
— browser extensions, other processes, local malware, a rogue docker
container sharing the network namespace — can call this endpoint
repeatedly to rotate the token and lock out the real user, or to
harvest the new token.

**Impact:** Confidentiality and availability of the setup flow.

**Remediation:**
1. Require `POST /api/setup/launch` to carry a one-shot bootstrap
   nonce that the CLI prints at startup (`--setup-nonce ...`).
2. Add a simple in-process rate limiter (e.g., 5 requests / minute).
3. Store the token as a salted hash (bcrypt / scrypt) and compare
   hashes, so a config leak does not equal a token leak.

---

## Medium findings

### AUDIT-M1 — No global max-iteration safety cap
**Location:** `src/autonomous/loop.ts:115`, `src/autonomous/policy-engine.ts:84-90`
A task created without `constraints.maxIterations` has no hard upper
bound; only `evaluateSuccess`, the policy engine, manual stop, or
uncertainty escalation can end it. Add a hard-coded
`MAX_GLOBAL_ITERATIONS = 500` check in `AutonomousLoop.run()`.

### AUDIT-M2 — Rate-limit timestamps only pruned during `checkAction()`
**Location:** `src/autonomous/policy-engine.ts:142-156,179-185`
`recordToolCall()` / `recordApiCall()` push without bounds; pruning
only happens on the next check. Move the `.filter(...)` into the
`record*` methods or bound arrays by length.

### AUDIT-M3 — `DEFAULT_POLICY_CONFIG.tonSpending` is permissive
**Location:** `src/autonomous/policy-engine.ts:28-33`
`perTask: 1 TON`, `daily: 5 TON`, `requireConfirmationAbove: 0.5`
defaults are aggressive for a wallet-bound agent. Consider dropping
defaults to `perTask: 0.1`, `daily: 0.5`, `requireConfirmationAbove:
0.05` and documenting the knob.

### AUDIT-M4 — `requiresEscalation` without recorded violation yields empty reason
**Location:** `src/autonomous/loop.ts:192-201`, `src/autonomous/policy-engine.ts:117-123`
When a restricted tool triggers `requiresEscalation` but no violation
is pushed, the escalation message falls back to "Requires
confirmation", hiding the real reason. Always push an informational
violation so the user sees *what* was flagged.

### AUDIT-M5 — Escalated/paused tasks have no auto-timeout
**Location:** `src/autonomous/loop.ts:197-209`
If the user never resumes, the task sits paused forever, keeping a
slot in `runningLoops` (0 after pause, actually, but the DB row stays
`paused`). Add a `pausedAt` timestamp and auto-cancel after e.g. 24 h.

### AUDIT-M6 — Path-traversal guard inconsistent between servers
**Location:** `src/webui/setup-server.ts:198-199` vs `src/webui/server.ts:417-418`
One uses `rel.startsWith("..")` after `relative()`; the other also
checks `resolve(filePath) !== filePath`. Unify via a shared helper.

### AUDIT-M7 — Setup writes `api.host = "0.0.0.0"` by default
**Location:** `src/webui/routes/setup.ts:602`
The Management API's generated config binds to all interfaces,
exposing the admin surface to LAN/VPN. Default should be
`"127.0.0.1"` and require the user to opt in to `0.0.0.0`.

### AUDIT-M8 — Setup Telegram sessions validate TTL only on creation
**Location:** `src/webui/setup-auth.ts:463-469`
The getter checks TTL, but request handlers read the session directly
without re-validating; expired sessions can remain until the
`setTimeout` fires. Always re-check `Date.now() - createdAt` per
request (the current `getSession()` already does this, so the fix is
to route all access through `getSession()`).

---

## Low findings

### AUDIT-L1 — Config schema `version` default disagrees with package version
**Location:** `src/config/schema.ts:189`
`version: z.string().default("1.0.0")` while `package.json` is
`0.8.10`. Either drive the default from `package.json` or drop the
default.

### AUDIT-L2 — Error responses leak workspace paths
**Location:** `src/webui/routes/workspace.ts:116`
`WorkspaceSecurityError` includes `inputPath` in the message; return a
generic error and log the detail server-side.

### AUDIT-L3 — Audit middleware skips 4xx/5xx mutations
**Location:** `src/webui/middleware/audit.ts:70-74`
Failed mutations (e.g. blocked writes) are not audited; attackers
probing for forbidden endpoints leave no trail. Log all mutations.

### AUDIT-L4 — `maxParallelTasks` overflow throws instead of queuing
**Location:** `src/autonomous/manager.ts:58-64`
The 11th concurrent task fails outright. A simple FIFO queue drained
in `runLoop`'s `.finally` would be kinder and avoid lost work.

---

## Action plan

| Priority | Findings | Rationale | Rough effort |
| --- | --- | --- | --- |
| **P1 — before re-enabling autonomous wallet mode** | C1, C2, C3, C4, H1, H2, H7 | Every item above either bypasses a safety gate, leaks a long-lived credential, or leaves autonomous loops running past shutdown. | 1–2 engineering days |
| **P2 — next minor release** | H3, H4, H5, H6, M1, M2, M4 | Race/leak/ergonomics fixes; test-covered. | 1 day |
| **P3 — opportunistic** | M3, M5, M6, M7, M8, L1–L4 | Hardening and defaults; do alongside docs pass. | 0.5 day |

**Validation plan for fixes:**
1. Unit-test policy engine with real tool names (`ton_send`) to prove
   escalation triggers (addresses C1).
2. Integration-test `agent start → autonomous task → agent stop`
   ensures no "database is closed" in logs (addresses C2).
3. Script-test pause/resume N=10 times and verify
   `toolCallsPerHour` still enforces the cap (addresses C3).
4. Grep the final log output for the `authToken` after boot
   (addresses C4); expect zero matches.

**Go/No-Go recommendation:** 🟠 **Conditional Go** — safe to run in a
non-wallet / read-only configuration today; autonomous mode with a TON
wallet should wait until the P1 findings (especially C1, C2, C3) land.

---

## Methodology

1. **Discovery.** Read `src/autonomous/*.ts`,
   `src/memory/agent/autonomous-tasks.ts`,
   `src/webui/server.ts` + all `src/webui/routes/*.ts`,
   `src/webui/setup-server.ts`, `src/webui/middleware/*.ts`,
   `src/index.ts` (start/stop flow), and `src/memory/migrations/1.20.0.sql`.
2. **Deep-scan.** Three parallel focused sub-audits: WebUI/security,
   autonomous core, CLI/lifecycle/config. Each produced its own
   findings list keyed to file:line.
3. **Cross-reference.** Confirmed C1 by grepping `name: "` across
   `src/agent/tools/**` to verify `restrictedTools` values never
   match. Confirmed C2 by reading `stopAgent()` and checking the
   `autonomousManager` variable scope. Confirmed C3 by reading
   `AutonomousLoop` constructor and `manager.runLoop`. Confirmed C4
   by reading `server.ts:503` directly.
4. **Synthesis.** Deduplicated overlapping findings from the three
   sub-audits, ranked by severity × exploitability × blast radius.
5. **Tooling.** Only the repository state at commit
   `d6b09c0` on branch `issue-250-294bf2f3de08` was inspected; no tests
   were run as part of the audit itself — follow-up PRs should add the
   regression tests enumerated in the Validation Plan.

---

## What this audit did NOT cover

- Runtime behaviour (no live execution / tracing); findings are
  derived from static reading only.
- `node_modules` and third-party SDK code (out of scope per the issue).
- `web/` React frontend (only the backend API surface was audited).
- Cryptographic primitives of TON (assumed correct via `@ton/ton`).
- Performance / load behaviour beyond what the `task_checkpoints`
  growth finding implies.

The P1 fixes are small and well-scoped; suggest they land as a
dedicated PR (not squashed with this audit) so each finding has its
own regression test and review.
