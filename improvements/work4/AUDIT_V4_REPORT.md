# Teleton Agent — Full Logic Audit V4 (Issue #521)

**Source issue:** [#521](https://github.com/xlabtg/teleton-agent/issues/521) ·
**PR:** [#522](https://github.com/xlabtg/teleton-agent/pull/522) ·
**Branch:** `issue-521-1ecdc5e12017`

**Audited commit:** `5ad0d0f` · **Compared base (`main`):** `2d53385`
(release 0.8.23) · **Auditor:** Claude Opus 4.8 (Claude Code).

## 1. Executive Summary

Issue #521 asked for a thorough, end-to-end review of the application logic so
that every flaw, bug, and vulnerability could be filed as a separate,
professional issue with labels and implementation stages, allowing the team to
fix them step by step.

This audit reviewed the high-risk subsystems that handle untrusted input,
money, host capabilities, and persistent state: the exec sandbox, the plugin /
MCP loaders, the WebUI Management API, the workflow / pipeline / autonomous
executors, the TON and gift payment-verification paths, and the memory / RAG
storage layer. It builds on the prior audit work in `improvements/work`,
`improvements/work2`, and `improvements/work3`, and deliberately avoids
re-filing findings already captured there (`#400`–`#404`, `#447`–`#451`).

**20 findings** are confirmed against the current source. **18** of them are at
`medium` severity or above and each has its own professional issue template in
[`issues/`](issues/) ready to be filed; **2** `low` findings are documented in
this report only (§5).

The single most important finding is **WORK4-001**: `exec_install` and
`exec_service` build shell command strings by interpolating model-controlled
arguments and never consult the exec allowlist, giving arbitrary host command
execution (and a full `allowlist`-mode bypass) in the same process that holds
the TON mnemonic and integration credentials.

### Severity breakdown

| Severity | Count | IDs                                                        |
| -------- | ----- | ---------------------------------------------------------- |
| High     | 7     | WORK4-001, -002, -006, -009, -010, -013, -015              |
| Medium   | 11    | WORK4-003, -004, -005, -007, -008, -011, -012, -014, -016, -017, -018 |
| Low      | 2     | L1 (cron tick), L2 (inline-keyboard parseMode) — §5        |

### Category breakdown

| Category        | IDs                                              |
| --------------- | ------------------------------------------------ |
| security        | 001, 002, 003, 005, 006, 007, 008, 009, 018      |
| logic           | 004, 012, 013, 016                               |
| reliability     | 010, 011                                         |
| financial       | 014                                              |
| data-integrity  | 015                                              |
| performance     | 017                                              |

## 2. Method

- Read issue #521 and prior audit folders (`improvements/work`, `work2`,
  `work3`) and the closed audit issues / PRs to establish a duplicate baseline.
- Read the source on the audited commit `5ad0d0f` (current `main` = `2d53385`,
  release 0.8.23).
- Decomposed the system into six high-risk lanes and reviewed each:
  1. TON / financial (payment verification, gifts, SDK).
  2. Autonomous / pipeline / scheduler executors.
  3. Plugin / MCP / exec sandbox security boundaries.
  4. WebUI + Management API auth and routes.
  5. Memory / RAG / SQL / migrations.
  6. Telegram / bot / providers / CLI / installer.
- Verified every top-severity claim against the exact file and line before
  filing, and recorded reproduction steps + a regression test per finding.
- Consolidated closely-related observations into single issues (e.g. the gift
  `fromId` omission and the seconds/milliseconds mismatch are one issue,
  WORK4-013; the hardcoded vector dimension and the non-isolated vector insert
  are one issue, WORK4-015; the pipeline primary-agent timeout and the orphaned
  step write are one issue, WORK4-010).

## 3. Findings index

| ID        | Severity | Category       | Summary                                                                  | Task file | GitHub |
| --------- | -------- | -------------- | ------------------------------------------------------------------------ | --------- | ------ |
| WORK4-001 | High     | security       | `exec_install`/`exec_service` shell injection + allowlist bypass         | [file](issues/WORK4-001-exec-install-service-shell-injection.md) |  |
| WORK4-002 | High     | security       | Plugin `migrateFromMainDb` copies core `memory.db` tables into plugin DB | [file](issues/WORK4-002-plugin-migratefrommaindb-core-table-exfiltration.md) |  |
| WORK4-003 | Medium   | security       | Integration AES key co-located with ciphertext in `memory.db`            | [file](issues/WORK4-003-integration-credentials-key-colocated.md) |  |
| WORK4-004 | Medium   | logic          | exec `scope: allowlist` ignores `exec.allowlist`, grants all admins      | [file](issues/WORK4-004-exec-scope-allowlist-ignored.md) |  |
| WORK4-005 | Medium   | security       | WebUI add-MCP-server writes `url`/`env` unvalidated (SSRF + env inject)   | [file](issues/WORK4-005-webui-mcp-url-env-unvalidated-ssrf.md) |  |
| WORK4-006 | High     | security       | Workflow `call_api` unrestricted server-side fetch (SSRF via webhook)    | [file](issues/WORK4-006-workflow-call-api-no-ssrf-protection.md) |  |
| WORK4-007 | Medium   | security       | Public workflow webhook secret compared with timing-unsafe `===`         | [file](issues/WORK4-007-workflow-webhook-secret-timing-unsafe.md) |  |
| WORK4-008 | Medium   | security       | Outbound webhook SSRF guard never resolves DNS (rebinding bypass)        | [file](issues/WORK4-008-webhook-ssrf-guard-skips-dns.md) |  |
| WORK4-009 | High     | security       | `/api/export/import` merges config outside `CONFIGURABLE_KEYS`           | [file](issues/WORK4-009-config-import-bypasses-allowlist.md) |  |
| WORK4-010 | High     | reliability    | Pipeline timeout doesn't stop a primary-agent run; orphaned step write   | [file](issues/WORK4-010-pipeline-timeout-does-not-stop-primary-agent.md) |  |
| WORK4-011 | Medium   | reliability    | `restoreInterruptedTasks` bypasses `maxParallelTasks` after a crash      | [file](issues/WORK4-011-restore-interrupted-tasks-bypasses-cap.md) |  |
| WORK4-012 | Medium   | logic          | Unconstrained autonomous task has no default iteration cap (→500)        | [file](issues/WORK4-012-autonomous-task-no-default-iteration-cap.md) |  |
| WORK4-013 | High     | logic          | Gift payment verification can never match (no `fromId`; s vs ms)         | [file](issues/WORK4-013-gift-payment-verification-always-fails.md) |  |
| WORK4-014 | Medium   | financial      | SDK `ton.verifyPayment` has no lower time bound (replay)                 | [file](issues/WORK4-014-sdk-verifypayment-missing-lower-time-bound.md) |  |
| WORK4-015 | High     | data-integrity | Hardcoded vector dimension (384) drops rows for non-local providers      | [file](issues/WORK4-015-hardcoded-vector-dimension.md) |  |
| WORK4-016 | Medium   | logic          | Hybrid message search never queries the semantic vector store           | [file](issues/WORK4-016-message-search-skips-semantic-vector-store.md) |  |
| WORK4-017 | Medium   | performance    | `memory getStats` forces a full recalculate on every call               | [file](issues/WORK4-017-memory-getstats-forces-full-recalculate.md) |  |
| WORK4-018 | Medium   | security       | Groq STT/TTS leak raw, untruncated upstream error bodies                 | [file](issues/WORK4-018-groq-stt-tts-raw-error-body-leak.md) |  |

The `GitHub` column is filled in after the issues are created upstream (see
[README.md](README.md)); the `github-issue` frontmatter field in each task file
is backfilled at the same time.

## 4. Findings detail

### WORK4-001 — exec_install/exec_service shell injection + allowlist bypass (High, security)

`exec_install` and `exec_service` build their command by interpolating
free-form, model-controlled arguments and pass the string to `runCommand`,
which defaults to `useShell = true` (`bash -c`). Neither consults the exec
allowlist — only `exec_run` does (`run.ts:35-42`). An operator running in
`allowlist` mode still gets arbitrary command execution. See
[issues/WORK4-001](issues/WORK4-001-exec-install-service-shell-injection.md).

### WORK4-002 — plugin migrateFromMainDb core-table exfiltration (High, security)

During plugin load every table a (untrusted) plugin creates in its own DB is
treated as a request to copy that table's rows out of the shared `memory.db`.
A plugin declaring `tg_messages` / `integration_credentials` /
`security_settings` has those core rows copied into its readable DB, defeating
per-plugin isolation. See
[issues/WORK4-002](issues/WORK4-002-plugin-migratefrommaindb-core-table-exfiltration.md).

### WORK4-003 — integration AES key co-located with ciphertext (Medium, security)

With `TELETON_INTEGRATIONS_KEY` unset (default), the AES-256-GCM key is
auto-generated and stored in `security_settings` inside the same `memory.db` as
the encrypted credentials, so encryption-at-rest adds no confidentiality against
DB read access. Compounds WORK4-002. See
[issues/WORK4-003](issues/WORK4-003-integration-credentials-key-colocated.md).

### WORK4-004 — exec scope "allowlist" ignores exec.allowlist (Medium, logic)

`resolveScope` collapses `allowlist` to `admin-only` and nothing reads
`exec.allowlist`, so the documented per-user restriction does not exist; every
admin keeps exec and listed non-admins are denied. See
[issues/WORK4-004](issues/WORK4-004-exec-scope-allowlist-ignored.md).

### WORK4-005 — WebUI add-MCP-server writes url/env unvalidated (Medium, security)

The route strictly validates `package`/`args` but writes `url`/`env` to
`config.yaml` verbatim; the loader then connects to the URL and forwards `env`
to the spawned child — SSRF + env injection behind the admin token. See
[issues/WORK4-005](issues/WORK4-005-webui-mcp-url-env-unvalidated-ssrf.md).

### WORK4-006 — workflow call_api unrestricted fetch / SSRF (High, security)

`call_api` does `fetch(action.url)` with no SSRF guard (only a
`startsWith("http")` check), and the workflow can be fired through the
**unauthenticated** `POST /api/workflows/webhook/:secret` endpoint, turning the
agent into a proxy into the internal network / cloud metadata. See
[issues/WORK4-006](issues/WORK4-006-workflow-call-api-no-ssrf-protection.md).

### WORK4-007 — workflow webhook secret timing-unsafe (Medium, security)

The sole authenticator for the public webhook endpoint is compared with `===`,
which short-circuits on the first differing byte, while the rest of the codebase
uses `timingSafeEqual`. See
[issues/WORK4-007](issues/WORK4-007-workflow-webhook-secret-timing-unsafe.md).

### WORK4-008 — webhook SSRF guard skips DNS (Medium, security)

`validateWebhookUrl` blocks private IP literals but, for DNS names, only
string-matches a tiny loopback denylist; it never resolves the host, so any
attacker-controlled domain (incl. DNS rebinding) bypasses the private-IP checks.
See [issues/WORK4-008](issues/WORK4-008-webhook-ssrf-guard-skips-dns.md).

### WORK4-009 — config import bypasses CONFIGURABLE_KEYS (High, security)

The bulk import endpoint shallow-spreads `bundle.config` over the existing
config (only restoring 7 token keys), letting an authenticated user flip
`exec.mode` to `yolo`, drop `webui.auth_token_hash`, or overwrite immutable
soul/security files. See
[issues/WORK4-009](issues/WORK4-009-config-import-bypasses-allowlist.md).

### WORK4-010 — pipeline timeout does not stop primary agent (High, reliability)

For a `primary`-agent step the `AbortController` is never handed to
`processMessage`, so a timed-out/cancelled run keeps executing tools (including
financial tools) detached, and a late `updateStep(..., "completed")` can
overwrite the failed run. See
[issues/WORK4-010](issues/WORK4-010-pipeline-timeout-does-not-stop-primary-agent.md).

### WORK4-011 — restoreInterruptedTasks bypasses concurrency cap (Medium, reliability)

The restore path calls `runLoop` unconditionally for every `running`/`pending`
task, ignoring `maxParallelTasks`, so a crash with more than the cap active
tasks restarts them all concurrently. See
[issues/WORK4-011](issues/WORK4-011-restore-interrupted-tasks-bypasses-cap.md).

### WORK4-012 — autonomous task has no default iteration cap (Medium, logic)

`evaluateSuccess` always returns `false` when `successCriteria` is non-empty, so
completion depends solely on the LLM `reflection.goalAchieved`; an unconstrained
task can run to `MAX_GLOBAL_ITERATIONS = 500` (~1000 LLM calls). See
[issues/WORK4-012](issues/WORK4-012-autonomous-task-no-default-iteration-cap.md).

### WORK4-013 — gift payment verification always fails (High, logic)

`compactGift` omits the sender (`fromId`), so the buyer-match
(`fromUserId === deal.user_telegram_id`) is always false and
`Number(undefined) = NaN`; additionally gift `receivedAt` (seconds) is compared
to `deal.created_at * 1000` (ms). Gift-settled deals can never auto-verify. See
[issues/WORK4-013](issues/WORK4-013-gift-payment-verification-always-fails.md).

### WORK4-014 — SDK verifyPayment missing lower time bound (Medium, financial)

The SDK verifier enforces only an upper age bound, no `requestTime` lower bound
(the core verifier has `if (txTime < requestTime) continue`), so a prior
unrelated payment of the right amount can satisfy a new deal — double-spend of
one transfer. See
[issues/WORK4-014](issues/WORK4-014-sdk-verifypayment-missing-lower-time-bound.md).

### WORK4-015 — hardcoded vector dimension (High, data-integrity)

`vectorDimensions: 384` is hardcoded regardless of the active embedder (Voyage =
512/1024). Switching providers fails the dimension check, and because vector
inserts run inside transactions with no per-insert isolation, the surrounding
message/knowledge row is rolled back — silent data loss. See
[issues/WORK4-015](issues/WORK4-015-hardcoded-vector-dimension.md).

### WORK4-016 — message search skips semantic vector store (Medium, logic)

`searchMessages` never queries the remote semantic store (Upstash) that
`searchKnowledge` uses, so semantic message recall is silently degraded relative
to knowledge search. See
[issues/WORK4-016](issues/WORK4-016-message-search-skips-semantic-vector-store.md).

### WORK4-017 — getStats forces full recalculate (Medium, performance)

`getStats` unconditionally calls `recalculateAll` (O(N) rescoring + O(N·M)
centrality), so a read-only stats/dashboard call triggers a full recompute that
scales poorly with memory size. See
[issues/WORK4-017](issues/WORK4-017-memory-getstats-forces-full-recalculate.md).

### WORK4-018 — Groq STT/TTS raw error body leak (Medium, security)

The Groq text provider sanitizes upstream error bodies, but the STT and TTS
providers throw the raw, untruncated body, which is surfaced through the WebUI
Groq routes — information disclosure. See
[issues/WORK4-018](issues/WORK4-018-groq-stt-tts-raw-error-body-leak.md).

## 5. Low-severity findings (report-only, not filed)

These are documented here for completeness; per the finding policy
(`audit-config.yaml`), only `medium`+ findings get individual issue files.

- **L1 — cron tick has no per-tick time budget.** The workflow scheduler's cron
  tick (`src/services/workflow-scheduler.ts:78-112`) evaluates due workflows
  serially with no overall time budget; a slow batch can delay subsequent ticks.
  Low impact at expected workflow counts. Suggested fix: bound per-tick work /
  run due workflows with a concurrency limit and a deadline.
- **L2 — inline-keyboard message send bypasses HTML conversion.** The bot bridge
  inline-keyboard send path (`src/bot/bridge.ts:200-205`) does not route text
  through `markdownToTelegramHtml`/`parse_mode`, so markdown in those messages is
  shown literally. Cosmetic. Suggested fix: apply the same conversion/`parse_mode`
  used by the normal send path.

## 6. Cross-cutting themes

- **Asymmetric validation.** Several modules validate one input strictly while
  leaving a sibling input wide open (exec_run vs exec_install/exec_service;
  MCP package vs url/env; single-key config write vs bulk import). The fix
  pattern is to centralize the guard and apply it on every path.
- **SSRF guard fragmentation.** Three different code paths (alerting,
  webhook-dispatcher, workflow-executor) implement or skip SSRF protection
  inconsistently, and none resolve DNS. A single shared, DNS-resolving,
  connection-pinning guard (WORK4-006/-008) should back all outbound fetches.
- **Cancellation that does not cancel.** The pipeline primary-agent path
  (WORK4-010) and the autonomous default cap (WORK4-012) both show control
  signals (timeout / success criteria) that do not actually bound execution.
- **Payment-verification correctness.** The gift path (WORK4-013) can never
  match and the SDK path (WORK4-014) accepts replays — both warrant focused
  tests with fixtures before any production settlement is trusted.

## 7. Suggested remediation order (stages)

1. **Stage 1 — capability containment (security High):** WORK4-001, WORK4-009,
   WORK4-002 (+003).
2. **Stage 2 — outbound request safety (security High/Medium):** WORK4-006,
   WORK4-008, WORK4-005, WORK4-007.
3. **Stage 3 — money correctness:** WORK4-013, WORK4-014.
4. **Stage 4 — executor reliability:** WORK4-010, WORK4-011, WORK4-012.
5. **Stage 5 — data integrity & quality:** WORK4-015, WORK4-016, WORK4-017,
   WORK4-018, WORK4-004, and the two L findings.

## 8. Validation

```bash
node improvements/work4/validation/check-artifacts.mjs     # structural check of artifacts
node improvements/work4/validation/reproduce-findings.mjs  # asserts the audited code patterns still exist
```

`reproduce-findings.mjs` exits non-zero while the audited patterns remain in the
code; after a fix PR it acts as a quick guard that the pattern is gone.
