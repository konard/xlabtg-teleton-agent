# Full Audit Work Folder — Ready-to-file Issue Templates (v3.0)

This folder contains **ready-made GitHub Issue templates** for each finding
from the full-repo audit performed for
[`#304`](https://github.com/xlabtg/teleton-agent/issues/304) (PR
[`#305`](https://github.com/xlabtg/teleton-agent/pull/305)).

Every finding in [`../../FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md)
has a corresponding Markdown file here. Each file is a **self-contained
issue template** — its YAML front-matter holds the title, labels,
milestone, severity, category, effort and priority; its body holds the
source, description, location, impact, remediation and acceptance
criteria.

To file an issue from one of these templates, copy the body into
`gh issue create --title "<title>" --label "<labels>" --milestone "<milestone>" --body-file <file>`
or paste it into the GitHub web UI.

## Templates

### Critical (P0 — fix before enabling plugins/MCP or autonomous TON above 0.1)

| ID | File | Title |
|----|------|-------|
| C1 | [full-c1-plugins-load-without-isolation.md](full-c1-plugins-load-without-isolation.md) | External plugins load with no isolation (full Node privileges) |
| C2 | [full-c2-exec-allowlist-prefix-bypass.md](full-c2-exec-allowlist-prefix-bypass.md) | Exec allowlist mode is a prefix match; allowing `"git"` allows arbitrary shell |
| C3 | [full-c3-ton-proxy-binary-no-integrity-check.md](full-c3-ton-proxy-binary-no-integrity-check.md) | TON-proxy binary downloaded from GitHub Releases with no integrity verification |

### High (P0/P1)

| ID | File | Title | Priority |
|----|------|-------|----------|
| H1 | [full-h1-createsafedb-blocklist-incomplete.md](full-h1-createsafedb-blocklist-incomplete.md) | `createSafeDb` is a block-list; `loadExtension`/`backup`/`pragma`/`function` remain callable from plugins | P0 |
| H2 | [full-h2-mcp-tools-missing-schema.md](full-h2-mcp-tools-missing-schema.md) | MCP tools with empty/missing `inputSchema` are registered and bypass parameter validation | P0 |
| H3 | [full-h3-sendton-fabricated-hash.md](full-h3-sendton-fabricated-hash.md) | `sendTon` fabricates a tx hash and does not wait for on-chain confirmation | P1 |
| H4 | [full-h4-dependent-tasks-prompt-injection.md](full-h4-dependent-tasks-prompt-injection.md) | Dependent tasks post untrusted `description` into Saved Messages, re-entering as a prompt | P1 |
| H5 | [full-h5-admin-ids-leaked-to-plugins.md](full-h5-admin-ids-leaked-to-plugins.md) | `~/.teleton/plugins/` leaks `admin_ids` to every plugin | P0 |
| H6 | [full-h6-agent-restart-no-lock.md](full-h6-agent-restart-no-lock.md) | Management API `/v1/agent/restart` has no concurrency lock | P1 |
| H7 | [full-h7-cli-secrets-on-argv.md](full-h7-cli-secrets-on-argv.md) | CLI secrets on `argv` and in shell history | P1 |
| H8 | [full-h8-installer-trusts-existing-remote.md](full-h8-installer-trusts-existing-remote.md) | `install.sh install_git` re-pulls from whatever remote an existing `~/.teleton-app` points to | P1 |

### Medium (P1/P2)

| ID | File | Title | Priority |
|----|------|-------|----------|
| M1 | [full-m1-hookrunner-global-counter.md](full-m1-hookrunner-global-counter.md) | `HookRunner.hookDepth` is a single process-global counter; unrelated concurrent events are skipped | P1 |
| M2 | [full-m2-alerting-webhook-ssrf.md](full-m2-alerting-webhook-ssrf.md) | `AlertingService` webhook has no SSRF guard, no timeout, no body redaction | P1 |
| M3 | [full-m3-workspace-validator-toctou-symlink.md](full-m3-workspace-validator-toctou-symlink.md) | Workspace path validator has a TOCTOU and `existsSync` follows symlinks in a parent chain | P1 |
| M4 | [full-m4-attach-database-sql-injection.md](full-m4-attach-database-sql-injection.md) | `ATTACH DATABASE` interpolates an unescaped `TELETON_ROOT`; apostrophe in home dir → SQL injection | P1 |
| M5 | [full-m5-transcripts-unbounded-growth.md](full-m5-transcripts-unbounded-growth.md) | Per-session transcripts grow unbounded in RAM and on disk | P2 |
| M6 | [full-m6-sse-listener-leak.md](full-m6-sse-listener-leak.md) | SSE listener on `/v1/agent/events` survives up to 30 s after disconnect | P2 |
| M7 | [full-m7-workflow-scheduler-no-dedupe.md](full-m7-workflow-scheduler-no-dedupe.md) | `WorkflowScheduler.tick()` has no per-workflow dedupe; slow workflows duplicate | P2 |
| M8 | [full-m8-markdown-to-telegram-html-link-text.md](full-m8-markdown-to-telegram-html-link-text.md) | `markdownToTelegramHtml` does not escape link text; one `<` in a title DoSes outbound replies | P2 |
| M9 | [full-m9-npm-audit-vulnerabilities.md](full-m9-npm-audit-vulnerabilities.md) | npm audit reports 14 vulnerabilities (7 high, 7 moderate) in transitive deps | P2 |

### Low (P3)

| ID | File | Title |
|----|------|-------|
| L1 | [full-l1-invalid-port-env-silently-dropped.md](full-l1-invalid-port-env-silently-dropped.md) | `loadConfig` silently drops invalid `TELETON_WEBUI_PORT`/`TELETON_API_PORT` |
| L2 | [full-l2-doctor-skips-wallet-decryption.md](full-l2-doctor-skips-wallet-decryption.md) | `doctor` does not exercise encrypted-wallet decryption |
| L3 | [full-l3-secretkey-cached-for-lifetime.md](full-l3-secretkey-cached-for-lifetime.md) | Derived `secretKey` cached for the process lifetime with no zeroize path |
| L4 | [full-l4-provider-error-body-forwarded.md](full-l4-provider-error-body-forwarded.md) | Provider error messages forward raw upstream bodies |

## Priority Legend

- **P0 — Before enabling plugins/MCP or autonomous TON above 0.1.** FULL-C1, FULL-C2, FULL-C3, FULL-H1, FULL-H2, FULL-H5.
- **P1 — Before v3.0 release.** FULL-H3, FULL-H4, FULL-H6, FULL-H7, FULL-H8, FULL-M1, FULL-M2, FULL-M3, FULL-M4.
- **P2 — Next maintenance release.** FULL-M5, FULL-M6, FULL-M7, FULL-M8, FULL-M9.
- **P3 — Opportunistic (hardening, ergonomics).** FULL-L1, FULL-L2, FULL-L3, FULL-L4.

## Template Structure

Each file follows the same structure:

```markdown
---
title: "[AUDIT-FULL-<ID>] <short description>"
labels: [...]
milestone: "v3.0 - Production Ready"
severity: critical|high|medium|low
category: security|reliability|performance|ux|config|output-encoding|dependency
effort: small|medium|large
priority: P0|P1|P2|P3
---

## Источник
## Описание
## Местоположение
## Влияние
## Предложенное исправление
## Критерии приёмки
## Оценка
```

This matches the format used in the first audit work folder
([`../work/`](../work/)), with the severity / category / effort /
priority front-matter fields kept for traceability back to the audit
report.

## Creating issues from the CLI

Example:

```bash
cd improvements/work2
for f in full-c*.md full-h*.md full-m*.md full-l*.md; do
  title=$(awk -F'"' '/^title:/{print $2; exit}' "$f")
  # Strip the YAML front-matter from the body before piping to gh:
  body=$(awk '/^---$/{c++; next} c==2' "$f")
  gh issue create \
    --repo xlabtg/teleton-agent \
    --title "$title" \
    --body "$body" \
    --label "bug,audit-finding-full" \
    --milestone "v3.0 - Production Ready"
done
```

(Adjust `--label` to pass labels one at a time if `gh` complains, and
cherry-pick files if you prefer to open them one at a time.)

## Relationship to the first audit

- First audit: `#250` → PR `#251` → templates in
  [`../work/`](../work/) (23 findings, all fixed).
- Full-repo audit: `#304` → PR `#305` → templates here (24 new
  findings, all distinct from the first audit).
