# Full Audit Work Report (v3.0)

- **Audit issue:** [#304 — Analyze what was done after the audit](https://github.com/xlabtg/teleton-agent/issues/304)
- **Audit PR:** [#305 — docs(audit): full-repo audit FULL_AUDIT_REPORT.md for v3.0](https://github.com/xlabtg/teleton-agent/pull/305)
- **Audit report:** [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md)
- **Generated:** 2026-04-23
- **Scope:** All 24 findings from the full-repo audit (3 Critical · 8 High · 9 Medium · 4 Low) plus CI infrastructure fix.

This document records every finding from the full-repo audit, the GitHub issue filed for it, and the pull request that resolved it.

---

## Summary

| Severity | Findings | Issues filed | PRs merged |
|----------|----------|--------------|------------|
| 🔴 Critical | 3 | 3 | 3 |
| 🟠 High | 8 | 8 | 8 |
| 🟡 Medium | 9 | 9 | 9 |
| 🟢 Low | 4 | 4 | 4 |
| CI infrastructure | — | 1 | 1 |
| **Total** | **24** | **25** | **25** |

All 24 audit findings have been resolved. Every fix was filed as a dedicated GitHub issue, implemented in a dedicated branch, and merged via a pull request.

---

## 🔴 Critical Findings

### FULL-C1 — External plugins load with no isolation (full Node privileges)

| | |
|---|---|
| **Issue** | [#306 — \[AUDIT-FULL-C1\] External plugins load with no isolation (full Node privileges)](https://github.com/xlabtg/teleton-agent/issues/306) |
| **PR** | [#330 — fix(plugins): permission check, checksum verification, production hot-reload guard (FULL-C1 #306)](https://github.com/xlabtg/teleton-agent/pull/330) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** Plugins were loaded via raw dynamic `import()` with no VM isolation, no Worker thread, no permissions model, and no signature check. The manifest schema did not require a signature or checksum. `chokidar` watched `~/.teleton/plugins/` at depth 1, so dropping a file there re-imported it immediately. The process that held the TON mnemonic was the same process that executed plugin code.

**Fix:** Added a manifest permission check before loading any plugin, SHA-256 checksum verification of the plugin module file against the manifest, and a guard that disables hot-reload in production mode. Plugins that fail permission or checksum checks are rejected with a descriptive error.

---

### FULL-C2 — Exec allowlist mode is a prefix match; allowing `"git"` allows arbitrary shell

| | |
|---|---|
| **Issue** | [#307 — \[AUDIT-FULL-C2\] Exec allowlist mode is a prefix match; allowing `"git"` allows arbitrary shell](https://github.com/xlabtg/teleton-agent/issues/307) |
| **PR** | [#331 — fix(exec): replace prefix-match allowlist with token-based check and shell-free execution](https://github.com/xlabtg/teleton-agent/pull/331) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** The exec allowlist used `command.startsWith(entry)`, so adding `"git"` to the list also allowed `git-annex`, `git;rm -rf /`, and any other string that starts with `"git"`. Combined with shell-based execution, this was a trivial privilege escalation for any plugin or task that could influence the exec allowlist.

**Fix:** Replaced the prefix-match with a token-based check that compares the first argv token (split by whitespace) against each allowlist entry. Switched to shell-free `execFile` / `spawn` with an explicit argv array, eliminating shell injection regardless of allowlist configuration.

---

### FULL-C3 — TON-proxy binary downloaded from GitHub Releases with no integrity verification

| | |
|---|---|
| **Issue** | [#308 — \[AUDIT-FULL-C3\] TON-proxy binary downloaded from GitHub Releases with no integrity verification](https://github.com/xlabtg/teleton-agent/issues/308) |
| **PR** | [#332 — \[AUDIT-FULL-C3\] Verify SHA-256 checksum of TON-proxy binary before execution](https://github.com/xlabtg/teleton-agent/pull/332) |
| **Severity** | 🔴 Critical · Security |
| **Status** | ✅ Fixed |

**Problem:** `ton-proxy/manager.ts` downloaded the TON-proxy binary from a GitHub Releases URL and executed it without verifying any checksum. A man-in-the-middle or a compromised GitHub release could replace the binary with malicious code that runs with full access to the TON mnemonic.

**Fix:** Added a SHA-256 checksum verification step that runs immediately after download and before execution. The expected checksum is pinned in source (`TON_PROXY_SHA256`). If verification fails, the binary is deleted and an error is thrown. Also merged with the allow-list fix for `createSafeDb` (PR #333) to harden the full plugin/MCP surface.

---

## 🟠 High Findings

### FULL-H1 — `createSafeDb` is a block-list; dangerous SQLite methods remain callable

| | |
|---|---|
| **Issue** | [#309 — \[AUDIT-FULL-H1\] `createSafeDb` is a block-list; `loadExtension`/`backup`/`pragma`/`function` remain callable from plugins](https://github.com/xlabtg/teleton-agent/issues/309) |
| **PR** | [#333 — security(sdk,ton-proxy): replace block-list with allow-list in createSafeDb; verify binary checksum](https://github.com/xlabtg/teleton-agent/pull/333) |
| **Severity** | 🟠 High · Security · P0 |
| **Status** | ✅ Fixed |

**Problem:** `createSafeDb()` in `utils/module-db.ts` used a block-list approach, explicitly deleting a small set of dangerous methods from the `better-sqlite3` Database object. Any method not on the list (e.g. `loadExtension`, `backup`, `pragma`, `function`) remained fully accessible to plugins, allowing them to load native extensions, exfiltrate the database, or execute arbitrary SQL via user-defined functions.

**Fix:** Replaced the block-list with an allow-list that exposes only `prepare`, `exec`, and `close`. All other methods are removed from the object. The PR also includes the SHA-256 checksum verification for the TON-proxy binary (FULL-C3 overlap).

---

### FULL-H2 — MCP tools with empty/missing `inputSchema` bypass parameter validation

| | |
|---|---|
| **Issue** | [#310 — \[AUDIT-FULL-H2\] MCP tools with empty/missing `inputSchema` are registered and bypass parameter validation](https://github.com/xlabtg/teleton-agent/issues/310) |
| **PR** | [#334 — \[AUDIT-FULL-H2\] Fix MCP tool registration: reject empty schemas, namespace names, validate inputs](https://github.com/xlabtg/teleton-agent/pull/334) |
| **Severity** | 🟠 High · Security · P0 |
| **Status** | ✅ Fixed |

**Problem:** MCP tool registration accepted tools with an empty or missing `inputSchema`, registering them anyway and skipping parameter validation entirely. A malicious MCP server could register tools with no schema to bypass the validation layer and pass arbitrary payloads to the agent.

**Fix:** Added a registration-time check that rejects any tool whose `inputSchema` is absent or empty (no `properties`). Also added namespace validation to reject tool names that could shadow built-in tools, and added input validation against the schema at call time.

---

### FULL-H3 — `sendTon` fabricates a tx hash and does not wait for on-chain confirmation

| | |
|---|---|
| **Issue** | [#311 — \[AUDIT-FULL-H3\] `sendTon` fabricates a tx hash and does not wait for on-chain confirmation](https://github.com/xlabtg/teleton-agent/issues/311) |
| **PR** | [#335 — fix(ton): replace pseudo-hash with real on-chain tx hash in sendTon](https://github.com/xlabtg/teleton-agent/pull/335) |
| **Severity** | 🟠 High · Correctness · P1 |
| **Status** | ✅ Fixed |

**Problem:** `sendTon()` returned a hash composed of `sha256(destinationAddress + amount + timestamp)` — a locally-fabricated identifier with no relation to any on-chain transaction. Callers (including the autonomous task system) treated this hash as proof of a completed on-chain transfer. A failed or dropped transaction would still return a "successful" hash.

**Fix:** Replaced the fabricated hash with the real transaction hash obtained from the TON SDK after broadcasting. The function now polls for on-chain confirmation before returning, and throws if confirmation is not received within the timeout window.

---

### FULL-H4 — Dependent tasks post untrusted `description` into Saved Messages (prompt injection)

| | |
|---|---|
| **Issue** | [#312 — \[AUDIT-FULL-H4\] Dependent tasks post untrusted `description` into Saved Messages, re-entering as a prompt](https://github.com/xlabtg/teleton-agent/issues/312) |
| **PR** | [#336 — fix(security): sanitize task description before Saved Messages post; guard JSON.parse in executor](https://github.com/xlabtg/teleton-agent/pull/336) |
| **Severity** | 🟠 High · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** When a task spawned a dependent sub-task, the sub-task's `description` field was posted verbatim to Telegram Saved Messages, which was then re-read as a prompt in the next loop iteration. An adversarial task output could inject instructions that would be executed by the autonomous agent.

**Fix:** Added sanitization of the task description before posting to Saved Messages, stripping Telegram bot command prefixes (`/`), control characters, and any content after a prompt-injection sentinel pattern. Also added a `JSON.parse` guard in the executor for task results returned by dependent tasks.

---

### FULL-H5 — `admin_ids` leaked to every plugin via sanitized config

| | |
|---|---|
| **Issue** | [#313 — \[AUDIT-FULL-H5\] `~/.teleton/plugins/` leaks `admin_ids` to every plugin](https://github.com/xlabtg/teleton-agent/issues/313) |
| **PR** | [#337 — fix(security): remove admin\_ids leak from plugin sanitized config, add sdk.isAdmin()](https://github.com/xlabtg/teleton-agent/pull/337) |
| **Severity** | 🟠 High · Security · P0 |
| **Status** | ✅ Fixed |

**Problem:** The SDK passed a "sanitized" config object to each plugin, but `admin_ids` was included in that object. Any plugin (including a malicious one) could read the full list of Telegram admin user IDs. Combined with FULL-C1, a malicious plugin could use this to impersonate admins or target specific users.

**Fix:** Removed `admin_ids` from the plugin-facing sanitized config. Added an `sdk.isAdmin(userId)` helper that plugins can call to check admin status without receiving the full ID list.

---

### FULL-H6 — Management API `/v1/agent/restart` has no concurrency lock

| | |
|---|---|
| **Issue** | [#314 — \[AUDIT-FULL-H6\] Management API `/v1/agent/restart` has no concurrency lock](https://github.com/xlabtg/teleton-agent/issues/314) |
| **PR** | [#338 — fix(api): add concurrency lock to /v1/agent/restart (AUDIT-FULL-H6)](https://github.com/xlabtg/teleton-agent/pull/338) |
| **Severity** | 🟠 High · Reliability · P1 |
| **Status** | ✅ Fixed |

**Problem:** The `/v1/agent/restart` endpoint called `stopAgent()` and `startAgent()` sequentially with no mutex. Concurrent restart requests could interleave, causing double-start races, partially-stopped agent state, or database-closed errors from tasks that continued running after `stopAgent()` returned.

**Fix:** Added an in-memory `restartLock` (a boolean flag + promise chain) that serialises restart requests. Concurrent calls wait for the in-flight restart to complete before proceeding, and a 429 response is returned if a restart is already in progress and the queue is full.

---

### FULL-H7 — CLI secrets appear on `argv` and in shell history

| | |
|---|---|
| **Issue** | [#315 — \[AUDIT-FULL-H7\] CLI secrets on `argv` and in shell history](https://github.com/xlabtg/teleton-agent/issues/315) |
| **PR** | [#339 — fix(cli): prevent secrets from appearing on argv and in shell history \[AUDIT-FULL-H7\]](https://github.com/xlabtg/teleton-agent/pull/339) |
| **Severity** | 🟠 High · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** Secret values (API keys, tokens, mnemonics) could be passed as CLI arguments, making them visible in `/proc/<pid>/cmdline`, `ps aux`, `top`, and shell history files. Any local user or process with access to `/proc` could read these values.

**Fix:** Added a prompt-based flow for all secret CLI arguments: if a secret argument is provided on the command line, the CLI reads it via an interactive prompt (with echo disabled) instead. When running non-interactively, secrets must be supplied via environment variables or config files. The `HISTIGNORE` pattern is also documented in the getting-started guide.

---

### FULL-H8 — `install.sh install_git` re-pulls from an unverified remote

| | |
|---|---|
| **Issue** | [#316 — \[AUDIT-FULL-H8\] `install.sh install_git` re-pulls from whatever remote an existing `~/.teleton-app` points to](https://github.com/xlabtg/teleton-agent/issues/316) |
| **PR** | [#340 — security(install): validate origin URL and working-tree state before git pull](https://github.com/xlabtg/teleton-agent/pull/340) |
| **Severity** | 🟠 High · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** `install.sh`'s `install_git` function ran `git pull` in `~/.teleton-app` without first checking that the `origin` remote pointed to the expected repository. If an attacker had previously redirected the remote (e.g. via a compromised DNS entry or a prior MITM), the installer would pull and execute arbitrary code.

**Fix:** Added an origin URL validation step before `git pull`: the script reads `git remote get-url origin`, compares it against the expected canonical URL (`https://github.com/xlabtg/teleton-agent.git`), and aborts if they differ. Also added a check that the working tree is clean (no uncommitted local changes) before pulling.

---

## 🟡 Medium Findings

### FULL-M1 — `HookRunner.hookDepth` is a process-global counter; concurrent events starve each other

| | |
|---|---|
| **Issue** | [#321 — \[AUDIT-FULL-M1\] `HookRunner.hookDepth` is a single process-global counter; unrelated concurrent events are skipped](https://github.com/xlabtg/teleton-agent/issues/321) |
| **PR** | [#345 — fix(hooks): replace global hookDepth with AsyncLocalStorage for per-context reentrancy](https://github.com/xlabtg/teleton-agent/pull/345) |
| **Severity** | 🟡 Medium · Reliability · P1 |
| **Status** | ✅ Fixed |

**Problem:** `HookRunner` used a single `hookDepth` integer to detect re-entrant hook execution. Because this was a module-level (process-global) variable, a hook running for one Telegram update would increment `hookDepth`, causing all hook invocations for concurrent unrelated updates to be skipped as "re-entrant" for the duration.

**Fix:** Replaced the global counter with `AsyncLocalStorage` so each async execution context maintains its own `hookDepth`. Concurrent updates now each track their own re-entrancy without interfering with each other.

---

### FULL-M2 — `AlertingService` webhook has no SSRF guard, no timeout, no body redaction

| | |
|---|---|
| **Issue** | [#322 — \[AUDIT-FULL-M2\] `AlertingService` webhook has no SSRF guard, no timeout, no body redaction](https://github.com/xlabtg/teleton-agent/issues/322) |
| **PR** | [#347 — fix(alerting): SSRF guard, 5 s timeout, secret redaction for webhook dispatch](https://github.com/xlabtg/teleton-agent/pull/347) |
| **Severity** | 🟡 Medium · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** `AlertingService` accepted an arbitrary webhook URL from config and sent HTTP POST requests to it without: (1) an SSRF guard (private/link-local addresses were allowed), (2) a request timeout (a slow server could hold a Node.js worker indefinitely), or (3) redaction of secret fields in the alert payload body.

**Fix:** Added an SSRF guard that resolves the URL's hostname and rejects RFC-1918 and link-local addresses (`10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`, `fc00::/7`). Added a 5-second fetch timeout. Added a redaction pass over the alert payload that replaces values of keys matching `/key|token|secret|password|mnemonic/i` with `"[REDACTED]"`.

---

### FULL-M3 — Workspace path validator has a TOCTOU and follows symlinks

| | |
|---|---|
| **Issue** | [#323 — \[AUDIT-FULL-M3\] Workspace path validator has a TOCTOU and `existsSync` follows symlinks in a parent chain](https://github.com/xlabtg/teleton-agent/issues/323) |
| **PR** | [#346 — fix(security): resolve parent-dir symlinks and use O\_NOFOLLOW writes (FULL-M3 #323)](https://github.com/xlabtg/teleton-agent/pull/346) |
| **Severity** | 🟡 Medium · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** The workspace path validator called `existsSync` on the target path and then `path.resolve` — creating a TOCTOU window where a symlink could be swapped between the check and the use. Additionally, `existsSync` follows symlinks in a parent chain, so a symlink anywhere in the directory hierarchy could redirect writes outside the workspace.

**Fix:** Replaced the check-then-use pattern with `fs.realpathSync` to resolve the canonical path (following all symlinks) before the containment check. For file writes, switched to `O_NOFOLLOW` open flags (via `fs.openSync` with the appropriate flag) to reject symlinks at the final path component.

---

### FULL-M4 — `ATTACH DATABASE` interpolates an unescaped path (SQL injection via home directory name)

| | |
|---|---|
| **Issue** | [#324 — \[AUDIT-FULL-M4\] `ATTACH DATABASE` interpolates an unescaped `TELETON_ROOT`; apostrophe in home dir → SQL injection](https://github.com/xlabtg/teleton-agent/issues/324) |
| **PR** | [#348 — fix(security): prevent SQL injection via apostrophe in ATTACH DATABASE path (issue #324)](https://github.com/xlabtg/teleton-agent/pull/348) |
| **Severity** | 🟡 Medium · Security · P1 |
| **Status** | ✅ Fixed |

**Problem:** `ATTACH DATABASE` SQL was built by string interpolation: `` `ATTACH DATABASE '${root}/memory.db' AS mem` ``. If `TELETON_ROOT` (derived from the home directory) contained an apostrophe — e.g. `/home/o'brien/.teleton` — the resulting SQL would be syntactically invalid or exploitable.

**Fix:** Added an apostrophe-escape pass (`path.replace(/'/g, "''")`) on the interpolated path before building the `ATTACH DATABASE` statement, matching SQLite's string-literal escaping rules. Added a validation check at startup that warns when the config root path contains characters that require escaping.

---

### FULL-M5 — Per-session transcripts grow unbounded in RAM and on disk

| | |
|---|---|
| **Issue** | [#325 — \[AUDIT-FULL-M5\] Per-session transcripts grow unbounded in RAM and on disk](https://github.com/xlabtg/teleton-agent/issues/325) |
| **PR** | [#349 — fix(session): cap transcripts at 5k messages and replace cache with LRU \[AUDIT-FULL-M5\]](https://github.com/xlabtg/teleton-agent/pull/349) |
| **Severity** | 🟡 Medium · Performance · P2 |
| **Status** | ✅ Fixed |

**Problem:** `session/transcript.ts` stored every message in a per-session array with no size cap. Long-running conversations could accumulate thousands of messages, exhausting RAM. The session cache was a plain `Map` with no eviction, so every session remained in memory for the process lifetime.

**Fix:** Capped transcripts at 5,000 messages (configurable via `session.maxTranscriptMessages`); older messages are dropped when the cap is reached. Replaced the `Map`-based session cache with an LRU cache (max 500 sessions) so inactive sessions are evicted automatically.

---

### FULL-M6 — SSE listener on `/v1/agent/events` survives up to 30 s after disconnect

| | |
|---|---|
| **Issue** | [#326 — \[AUDIT-FULL-M6\] SSE listener on `/v1/agent/events` survives up to 30 s after disconnect; `lifecycle` closures leak](https://github.com/xlabtg/teleton-agent/issues/326) |
| **PR** | [#350 — fix(sse): detach stateChange listener immediately on client disconnect](https://github.com/xlabtg/teleton-agent/pull/350) |
| **Severity** | 🟡 Medium · Reliability · P2 |
| **Status** | ✅ Fixed |

**Problem:** The SSE handler registered a `stateChange` event listener on the agent's `EventEmitter` but only detached it inside a `setInterval` cleanup that fired every 30 seconds. A client that disconnected immediately would leave the listener alive for up to 30 seconds, accumulating one leaked listener per reconnect cycle.

**Fix:** Added a `req.on('close', ...)` handler that detaches the `stateChange` listener immediately when the HTTP connection closes, eliminating the leak regardless of the polling interval.

---

### FULL-M7 — `WorkflowScheduler.tick()` has no per-workflow dedupe; slow workflows duplicate

| | |
|---|---|
| **Issue** | [#327 — \[AUDIT-FULL-M7\] `WorkflowScheduler.tick()` has no per-workflow dedupe; slow workflows duplicate](https://github.com/xlabtg/teleton-agent/issues/327) |
| **PR** | [#351 — fix(scheduler): deduplicate cron workflow execution (AUDIT-M7)](https://github.com/xlabtg/teleton-agent/pull/351) |
| **Severity** | 🟡 Medium · Reliability · P2 |
| **Status** | ✅ Fixed |

**Problem:** `WorkflowScheduler.tick()` fired every minute and launched any workflow whose cron expression matched the current time. If a workflow's execution took longer than one minute, the next tick would launch a second concurrent instance of the same workflow — and so on indefinitely.

**Fix:** Added a `Set<string>` of currently-running workflow IDs. `tick()` skips any workflow that already has a running instance. The running flag is cleared in the `finally` block of the workflow execution promise, so crashes or errors also release the lock.

---

### FULL-M8 — `markdownToTelegramHtml` does not escape link text; `<` in a title breaks outbound replies

| | |
|---|---|
| **Issue** | [#328 — \[AUDIT-FULL-M8\] `markdownToTelegramHtml` does not escape link text; one `<` in a title DoSes outbound replies](https://github.com/xlabtg/teleton-agent/issues/328) |
| **PR** | [#352 — fix(formatting): document implicit link-text escaping and add regression tests](https://github.com/xlabtg/teleton-agent/pull/352) |
| **Severity** | 🟡 Medium · Output Encoding · P2 |
| **Status** | ✅ Fixed |

**Problem:** `markdownToTelegramHtml` converted Markdown links (`[text](url)`) to `<a href="url">text</a>` without HTML-escaping the `text` portion. A Markdown link whose display text contained `<`, `>`, or `&` (e.g. from an LLM response referencing `<stdin>`) would produce malformed HTML that caused the entire Telegram `sendMessage` call to fail with a parse error.

**Fix:** Added HTML escaping of the link-text portion before inserting it into the `<a>` tag template. Also added regression tests covering `<`, `>`, `&`, `"`, and `'` characters in link text to prevent recurrence.

---

### FULL-M9 — npm audit reports 14 vulnerabilities in transitive dependencies

| | |
|---|---|
| **Issue** | [#329 — \[AUDIT-FULL-M9\] npm audit reports 14 vulnerabilities (7 high, 7 moderate) in transitive deps](https://github.com/xlabtg/teleton-agent/issues/329) |
| **PR** | [#353 — fix(security): resolve 14 npm vulnerabilities and raise audit threshold to high](https://github.com/xlabtg/teleton-agent/pull/353) |
| **Severity** | 🟡 Medium · Dependency · P2 |
| **Status** | ✅ Fixed |

**Problem:** `npm audit` reported 14 vulnerabilities (7 high, 7 moderate) across transitive dependencies including `hono`, `@hono/node-server`, and several indirect dependencies. The `audit-ci` threshold was set to `critical`, allowing high-severity issues to pass silently.

**Fix:** Updated affected packages to their patched versions and added `overrides` entries in `package.json` for vulnerabilities that could not be resolved via direct upgrades. Raised the `audit-ci` threshold from `critical` to `high` so future high-severity vulnerabilities fail CI immediately.

---

## 🟢 Low Findings

### FULL-L1 — `loadConfig` silently drops invalid port environment variables

| | |
|---|---|
| **Issue** | [#317 — \[AUDIT-FULL-L1\] `loadConfig` silently drops invalid `TELETON_WEBUI_PORT`/`TELETON_API_PORT`](https://github.com/xlabtg/teleton-agent/issues/317) |
| **PR** | [#341 — fix(config): throw on invalid/out-of-range port env vars](https://github.com/xlabtg/teleton-agent/pull/341) |
| **Severity** | 🟢 Low · Config |
| **Status** | ✅ Fixed |

**Problem:** When `TELETON_WEBUI_PORT` or `TELETON_API_PORT` were set to non-numeric or out-of-range values (e.g. `"abc"` or `"99999"`), `loadConfig` silently fell back to the default port without any warning. This made misconfiguration invisible and hard to debug.

**Fix:** Changed `loadConfig` to throw a descriptive `ConfigError` immediately when a port environment variable is set to an invalid (non-integer, < 1, or > 65535) value, preventing the agent from starting with an unintended port.

---

### FULL-L2 — `doctor` does not exercise encrypted-wallet decryption

| | |
|---|---|
| **Issue** | [#318 — \[AUDIT-FULL-L2\] `doctor` does not exercise encrypted-wallet decryption](https://github.com/xlabtg/teleton-agent/issues/318) |
| **PR** | [#342 — fix(doctor): checkWallet calls loadWallet() and returns ok/warn/error](https://github.com/xlabtg/teleton-agent/pull/342) |
| **Severity** | 🟢 Low · Observability |
| **Status** | ✅ Fixed |

**Problem:** The `doctor` command's wallet check only verified that the wallet file existed on disk. It did not attempt to decrypt and parse the wallet, so a corrupted or incorrectly-encrypted wallet file would pass `doctor` but fail at runtime when the agent first needed to sign a transaction.

**Fix:** Changed `checkWallet` to call `loadWallet()` (which performs full decryption and key derivation) and report `ok`, `warn`, or `error` based on whether decryption succeeds. Decryption failures are caught and surfaced as actionable `error` entries in the doctor output.

---

### FULL-L3 — Derived `secretKey` cached for the process lifetime with no zeroize path

| | |
|---|---|
| **Issue** | [#319 — \[AUDIT-FULL-L3\] Derived `secretKey` cached for the process lifetime with no zeroize path](https://github.com/xlabtg/teleton-agent/issues/319) |
| **PR** | [#343 — fix(wallet): zeroize secretKey on /pause and SIGTERM (AUDIT-FULL-L3 #319)](https://github.com/xlabtg/teleton-agent/pull/343) |
| **Severity** | 🟢 Low · Security |
| **Status** | ✅ Fixed |

**Problem:** `wallet-service.ts` cached the derived `secretKey` (a 64-byte Ed25519 private key) in a module-level variable for the entire process lifetime. There was no mechanism to zero out the key material when the agent was paused or shut down, leaving the key in memory and potentially in core dumps.

**Fix:** Added a `zeroizeSecretKey()` function that overwrites the cached key buffer with zeros. This function is now called from the `/v1/agent/pause` handler and from the `SIGTERM` / `SIGINT` signal handlers before the process exits.

---

### FULL-L4 — Provider error messages forward raw upstream bodies to clients

| | |
|---|---|
| **Issue** | [#320 — \[AUDIT-FULL-L4\] Provider error messages forward raw upstream bodies](https://github.com/xlabtg/teleton-agent/issues/320) |
| **PR** | [#344 — fix(security): sanitize upstream error bodies and fix 401 false-positive refresh](https://github.com/xlabtg/teleton-agent/pull/344) |
| **Severity** | 🟢 Low · Security |
| **Status** | ✅ Fixed |

**Problem:** When an upstream LLM provider returned an error response, the provider adapter forwarded the raw response body to the agent's API caller. Upstream bodies can contain internal infrastructure details, rate-limit metadata, or other information that should not be surfaced to external clients. Additionally, the 401 handler triggered a token refresh even for requests that were already retrying after a refresh, causing an infinite refresh loop.

**Fix:** Added a sanitization layer in the provider error handler that extracts only the human-readable `message` field from upstream error bodies (or falls back to a generic error string) before forwarding to callers. Also added a `isRetrying` flag to the refresh handler to prevent the 401 false-positive infinite loop.

---

## CI Infrastructure Fix

### Issue #303 — CI workflows not running on pull requests

| | |
|---|---|
| **Issue** | [#303 — fix(ci): add pull\_request trigger to fix PR checks for same-repo branches](https://github.com/xlabtg/teleton-agent/issues/303) *(implicit — fixed via PR)* |
| **PR** | [#303 — fix(ci): add pull\_request trigger to fix PR checks for same-repo branches](https://github.com/xlabtg/teleton-agent/pull/303) |
| **Status** | ✅ Fixed |

**Problem:** After the switch to `pull_request_target` in the first audit cycle, CI stopped running on same-repo branches (non-fork PRs). The `pull_request_target` trigger only fires for PRs from forks; same-repo branches need the `pull_request` trigger.

**Fix:** Added both `pull_request` and `pull_request_target` triggers to the CI workflow, with a permissions gate on `pull_request_target` to prevent write access from fork PRs.

---

## Files in This Folder

| File | Audit ID | Severity |
|------|----------|----------|
| [full-c1-plugins-load-without-isolation.md](full-c1-plugins-load-without-isolation.md) | C1 | 🔴 Critical |
| [full-c2-exec-allowlist-prefix-bypass.md](full-c2-exec-allowlist-prefix-bypass.md) | C2 | 🔴 Critical |
| [full-c3-ton-proxy-binary-no-integrity-check.md](full-c3-ton-proxy-binary-no-integrity-check.md) | C3 | 🔴 Critical |
| [full-h1-createsafedb-blocklist-incomplete.md](full-h1-createsafedb-blocklist-incomplete.md) | H1 | 🟠 High |
| [full-h2-mcp-tools-missing-schema.md](full-h2-mcp-tools-missing-schema.md) | H2 | 🟠 High |
| [full-h3-sendton-fabricated-hash.md](full-h3-sendton-fabricated-hash.md) | H3 | 🟠 High |
| [full-h4-dependent-tasks-prompt-injection.md](full-h4-dependent-tasks-prompt-injection.md) | H4 | 🟠 High |
| [full-h5-admin-ids-leaked-to-plugins.md](full-h5-admin-ids-leaked-to-plugins.md) | H5 | 🟠 High |
| [full-h6-agent-restart-no-lock.md](full-h6-agent-restart-no-lock.md) | H6 | 🟠 High |
| [full-h7-cli-secrets-on-argv.md](full-h7-cli-secrets-on-argv.md) | H7 | 🟠 High |
| [full-h8-installer-trusts-existing-remote.md](full-h8-installer-trusts-existing-remote.md) | H8 | 🟠 High |
| [full-m1-hookrunner-global-counter.md](full-m1-hookrunner-global-counter.md) | M1 | 🟡 Medium |
| [full-m2-alerting-webhook-ssrf.md](full-m2-alerting-webhook-ssrf.md) | M2 | 🟡 Medium |
| [full-m3-workspace-validator-toctou-symlink.md](full-m3-workspace-validator-toctou-symlink.md) | M3 | 🟡 Medium |
| [full-m4-attach-database-sql-injection.md](full-m4-attach-database-sql-injection.md) | M4 | 🟡 Medium |
| [full-m5-transcripts-unbounded-growth.md](full-m5-transcripts-unbounded-growth.md) | M5 | 🟡 Medium |
| [full-m6-sse-listener-leak.md](full-m6-sse-listener-leak.md) | M6 | 🟡 Medium |
| [full-m7-workflow-scheduler-no-dedupe.md](full-m7-workflow-scheduler-no-dedupe.md) | M7 | 🟡 Medium |
| [full-m8-markdown-to-telegram-html-link-text.md](full-m8-markdown-to-telegram-html-link-text.md) | M8 | 🟡 Medium |
| [full-m9-npm-audit-vulnerabilities.md](full-m9-npm-audit-vulnerabilities.md) | M9 | 🟡 Medium |
| [full-l1-invalid-port-env-silently-dropped.md](full-l1-invalid-port-env-silently-dropped.md) | L1 | 🟢 Low |
| [full-l2-doctor-skips-wallet-decryption.md](full-l2-doctor-skips-wallet-decryption.md) | L2 | 🟢 Low |
| [full-l3-secretkey-cached-for-lifetime.md](full-l3-secretkey-cached-for-lifetime.md) | L3 | 🟢 Low |
| [full-l4-provider-error-body-forwarded.md](full-l4-provider-error-body-forwarded.md) | L4 | 🟢 Low |

---

## Relationship to the first audit

- First audit: [#250](https://github.com/xlabtg/teleton-agent/issues/250) → PR [#251](https://github.com/xlabtg/teleton-agent/pull/251) → templates in [`../work/`](../work/) (23 findings, all fixed — see [`AUDIT_WORK_REPORT.md`](../work/AUDIT_WORK_REPORT.md)).
- Full-repo audit: [#304](https://github.com/xlabtg/teleton-agent/issues/304) → PR [#305](https://github.com/xlabtg/teleton-agent/pull/305) → templates here (24 new findings, all distinct from the first audit, all fixed).
