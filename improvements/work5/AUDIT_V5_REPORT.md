# Teleton Agent — Full Logic Audit V5 (Issue #583)

**Source issue:** [#583](https://github.com/xlabtg/teleton-agent/issues/583) ·
**PR:** [#584](https://github.com/xlabtg/teleton-agent/pull/584) ·
**Branch:** `issue-583-b7a5759ff7c4`

**Audited commit:** `50dbfe8` · **Compared base (`main`):** `908b991`
(release 0.8.40) · **Auditor:** Claude Fable 5 (Claude Code).

## 1. Executive Summary

Issue #583 asked for a thorough, end-to-end review of the application logic so
that every flaw, bug, and vulnerability could be filed as a separate,
professional issue with labels and implementation stages, allowing the team to
fix them step by step.

This audit fanned out across the whole tree — agent runtime and tools, services
(policy, scheduling, caching, metrics, integrations, webhooks), memory/RAG,
Telegram/bot, SDK, API/WebUI, TON/deals, autonomous mode, backup/restore, config,
and the web frontend — and then adversarially verified each candidate against the
exact source before filing. It builds on the prior audit waves in
`improvements/work`, `work2`, `work3`, and `work4`, and deliberately avoids
re-filing findings already captured there (notably `#252`–`#296`, `#306`–`#329`,
`#400`–`#404`, `#447`–`#451`, and `#523`–`#540`).

**8 findings** are confirmed against the current source, each has its own
professional issue template in [`issues/`](issues/), and each has been filed
upstream as a separate issue ([#585](https://github.com/xlabtg/teleton-agent/issues/585)–[#592](https://github.com/xlabtg/teleton-agent/issues/592)).
**2** additional `low` findings are documented in this report only (§5).

The single most important finding is **WORK5-001**: `restoreBackup` writes every
archive entry to `join(root, file.path)` with no containment check, so a crafted
backup archive (zip-slip / tar path traversal) yields arbitrary file write with
the agent's privileges — in the same process that holds the TON mnemonic and
integration credentials.

### Severity breakdown

| Severity | Count | IDs                                              |
| -------- | ----- | ------------------------------------------------ |
| High     | 4     | WORK5-001, -002, -003, -004                      |
| Medium   | 4     | WORK5-005, -006, -007, -008                      |
| Low      | 2     | L1 (cache FIFO eviction), L2 (spoofable client IP) — §5 |

### Category breakdown

| Category        | IDs                          |
| --------------- | ---------------------------- |
| security        | 001, 002, 003, 004, 005      |
| data-integrity  | 006                          |
| reliability     | 007, 008                     |

## 2. Method

- Read issue #583 and the prior audit folders (`improvements/work`, `work2`,
  `work3`, `work4`) plus the closed audit issues/PRs to build a duplicate
  baseline (~119 previously-filed findings).
- Decomposed the system into ~12 subsystem lanes and reviewed each in parallel,
  producing a candidate list of ~45 observations.
- **Adversarially verified** every candidate against the exact file and line on
  the audited commit `50dbfe8` (current `main` = `908b991`, release 0.8.40),
  discarding false positives and duplicates. Notable discards:
  - API key written to stdout under `TELETON_JSON_CREDENTIALS=true` — duplicate
    of `#258` (`audit-c4-auth-token-in-stdout`) and gated behind an explicit
    opt-in flag.
  - Network replay window — duplicate of `#402` / `#536`.
  - `hybrid.ts` `WHERE embedding MATCH ? AND k = ?` — **not** a bug; `k = ?` is
    valid sqlite-vec KNN syntax and the two placeholders bind correctly.
  - `webhook-dispatcher.stop()` "orphaned timers" — false; `stop()` clears every
    timer and empties the map (`:236-241`).
  - `anomaly-detector` `tool_share:<tool>` metrics — bounded by the registered
    tool set, not attacker-controlled cardinality.
- Recorded reproduction steps, a regression test, and acceptance criteria per
  confirmed finding.

## 3. Findings index

| ID        | Severity | Category       | Summary                                                                 | Task file | GitHub |
| --------- | -------- | -------------- | ----------------------------------------------------------------------- | --------- | ------ |
| WORK5-001 | High     | security       | Backup restore writes entries outside root (zip-slip / path traversal)  | [file](issues/WORK5-001-backup-restore-path-traversal.md) | [#585](https://github.com/xlabtg/teleton-agent/issues/585) |
| WORK5-002 | High     | security       | Integration credentials fall back to a hardcoded public encryption key  | [file](issues/WORK5-002-integration-credentials-hardcoded-fallback-key.md) | [#586](https://github.com/xlabtg/teleton-agent/issues/586) |
| WORK5-003 | High     | security       | Policy engine compiles untrusted regex (ReDoS / crash on evaluation)    | [file](issues/WORK5-003-policy-engine-untrusted-regex.md) | [#587](https://github.com/xlabtg/teleton-agent/issues/587) |
| WORK5-004 | High     | security       | MCP server URL validation never resolves DNS (SSRF via hostname)        | [file](issues/WORK5-004-mcp-server-url-ssrf-skips-dns.md) | [#588](https://github.com/xlabtg/teleton-agent/issues/588) |
| WORK5-005 | Medium   | security       | Autonomous TON budget/confirmation rely on self-reported `tonAmount`    | [file](issues/WORK5-005-autonomous-ton-budget-bypass.md) | [#589](https://github.com/xlabtg/teleton-agent/issues/589) |
| WORK5-006 | Medium   | data-integrity | Memory retention leaves phantom remote vectors on partial delete        | [file](issues/WORK5-006-retention-phantom-remote-vectors.md) | [#590](https://github.com/xlabtg/teleton-agent/issues/590) |
| WORK5-007 | Medium   | reliability    | Runtime retry backoff not abort-interruptible; uneven iteration accounting | [file](issues/WORK5-007-runtime-retry-backoff-not-abortable.md) | [#591](https://github.com/xlabtg/teleton-agent/issues/591) |
| WORK5-008 | Medium   | reliability    | Plugin inline/callback rate limit keyed per-plugin, not per-user        | [file](issues/WORK5-008-plugin-inline-rate-limit-not-per-user.md) | [#592](https://github.com/xlabtg/teleton-agent/issues/592) |

## 4. Findings detail

### WORK5-001 — Backup restore path traversal (zip-slip) {#work5-001}

`restoreBackup` (`src/backup/restore.ts:117-127`) joins each manifest
`file.path` onto `root` and writes it with no check that the destination stays
inside `root`. The tar reader (`src/backup/archive.ts:99`) preserves raw entry
names, so `../` sequences and absolute paths survive. Checksum verification only
proves byte integrity, not destination safety. A tampered/malicious archive
yields arbitrary file write → host compromise. See
[issue template](issues/WORK5-001-backup-restore-path-traversal.md).

### WORK5-002 — Integration credentials hardcoded fallback key {#work5-002}

`IntegrationAuthManager` (`src/services/integrations/auth.ts:143-147`) derives
its AES key from the literal `"default-insecure-key-set-TELETON_INTEGRATIONS_KEY"`
when no key material is configured. All stored secrets become decryptable by
anyone who reads the DB. Distinct from #525 (key co-located in DB). See
[issue template](issues/WORK5-002-integration-credentials-hardcoded-fallback-key.md).

### WORK5-003 — Policy engine compiles untrusted regex {#work5-003}

`matchesParam` (`src/services/policy-engine.ts:471-476`) runs
`new RegExp(matcher.pattern).test(value)` per evaluation with no validation,
caching, or try/catch. A pathological pattern causes ReDoS that stalls the
security-decision path; an invalid pattern throws at evaluation time. See
[issue template](issues/WORK5-003-policy-engine-untrusted-regex.md).

### WORK5-004 — MCP server URL SSRF skips DNS {#work5-004}

`validateMcpServerUrl` (`src/config/mcp-security.ts:36-62`) blocks only IP
literals and a tiny hostname denylist; a domain resolving to an internal IP is
allowed and never re-validated at connect time (DNS rebinding). Distinct code
path from #527/#530. See
[issue template](issues/WORK5-004-mcp-server-url-ssrf-skips-dns.md).

### WORK5-005 — Autonomous TON budget bypass {#work5-005}

`src/autonomous/policy-engine.ts:205-223` gates the per-task budget and the
confirmation threshold on `action.tonAmount`, a self-reported field decoupled
from the tool's real params (`loop.ts:55,320`). An action that spends via params
with `tonAmount` omitted/0 skips both gates. Compounds #534. See
[issue template](issues/WORK5-005-autonomous-ton-budget-bypass.md).

### WORK5-006 — Memory retention phantom remote vectors {#work5-006}

`src/memory/retention.ts:255-288` deletes local rows inside the transaction and
commits, then attempts the remote (Upstash) delete after commit with only a
`log.warn` on failure → orphaned remote vectors and local/remote divergence with
no repair path. See
[issue template](issues/WORK5-006-retention-phantom-remote-vectors.md).

### WORK5-007 — Runtime retry backoff not abort-interruptible {#work5-007}

`src/agent/runtime.ts` retry paths (`:1035`, `:1057`, `:1072`, `:1107`) sleep
with a bare `setTimeout` Promise that does not race the abort signal, so cancel
/ shutdown is delayed by up to the max backoff. The rate-limit path also omits
the `iteration--` the other paths apply, making the iteration cap non-uniform.
See [issue template](issues/WORK5-007-runtime-retry-backoff-not-abortable.md).

### WORK5-008 — Plugin inline rate limit not per-user {#work5-008}

`PluginRateLimiter.check` (`src/bot/rate-limiter.ts:18-44`) keys the window on
`pluginName:action` only; the inline router (`src/bot/inline-router.ts:138-185`)
runs handlers for any user against that shared bucket, so one user can exhaust a
plugin's limit for everyone. See
[issue template](issues/WORK5-008-plugin-inline-rate-limit-not-per-user.md).

## 5. Low-severity findings (report only, not filed)

These are real but low-impact; documented here rather than filed as separate
issues, consistent with the prior waves' handling of `low` findings.

- **L1 — Cache eviction is insertion-order (FIFO), not access-aware.**
  `src/services/cache.ts:411-423` evicts `entries.keys().next().value` (the
  oldest *inserted* key), and `getByKey` (`:333`) never reorders on access, so a
  frequently-read hot entry is evicted before a cold one once `max_entries` is
  exceeded. The comments call the victim "oldest", but the policy is FIFO, not
  the LRU one might expect. Low impact (correctness unaffected; only hit-rate),
  but worth aligning the behavior with the intended policy.

- **L2 — API rate-limit / IP-whitelist source IP falls back to a spoofable
  header.** `src/api/middleware/auth.ts:71-73` uses
  `c.env.ip ?? c.req.header("x-real-ip") ?? "unknown"`. When the socket IP is
  unavailable, the source IP for the whitelist check and the failed-attempt
  throttle comes from the client-supplied `x-real-ip`, which a direct client can
  set to evade a block or poison another address's counter. Only exploitable
  when `c.env.ip` is unset (no trusted proxy populating it); harden by trusting
  `x-real-ip`/`x-forwarded-for` only from configured proxies.

## 6. Implementation stages (suggested)

The findings map onto the same staged rollout the team used for prior waves:

1. **Stage 1 — contain host/credential compromise:** WORK5-001 (backup
   traversal), WORK5-002 (fallback key).
2. **Stage 2 — close SSRF and policy-engine hardening:** WORK5-004 (MCP DNS),
   WORK5-003 (regex guard).
3. **Stage 3 — financial & data integrity:** WORK5-005 (TON budget), WORK5-006
   (retention vectors).
4. **Stage 4 — reliability & fairness:** WORK5-007 (abortable backoff),
   WORK5-008 (per-user rate limit), plus L1/L2 polish.

## 7. Filing note

The automation account used for issue creation has no triage rights on the
upstream repository, so the issue bodies carry the suggested labels/milestone in
their frontmatter and a footer, and **maintainers still need to apply the
labels, milestone, and assignment** in GitHub. The `github-issue` frontmatter
field and the index table above are updated with the issue URLs once filed.
