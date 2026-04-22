# Audit Work Folder — Ready-to-file Issue Templates

This folder contains **ready-made GitHub Issue templates** for each finding
from the audit performed for [`#250`](https://github.com/xlabtg/teleton-agent/issues/250).

Every finding in [`../../AUDIT_REPORT.md`](../../AUDIT_REPORT.md) has a
corresponding Markdown file here. Each file is a **self-contained issue
template** — its YAML front-matter holds the title, labels, milestone,
severity, category, effort and priority; its body holds the source,
description, location, impact, remediation and acceptance criteria.

To file an issue from one of these templates, copy the body into
`gh issue create --title "<title>" --label "<labels>" --milestone "<milestone>" --body-file <file>`
or paste it into the GitHub web UI.

## Templates

### Critical (P1 — fix before re-enabling autonomous wallet mode)

| ID | File | Title |
|----|------|-------|
| C1 | [audit-c1-policy-restricted-tools-mismatch.md](audit-c1-policy-restricted-tools-mismatch.md) | Policy `restrictedTools` list does not match any real tool name |
| C2 | [audit-c2-autonomous-manager-shutdown-leak.md](audit-c2-autonomous-manager-shutdown-leak.md) | `AutonomousTaskManager` is never stopped on agent shutdown |
| C3 | [audit-c3-pause-resume-policy-bypass.md](audit-c3-pause-resume-policy-bypass.md) | Pause/resume resets rate-limits and loop-detection (policy bypass) |
| C4 | [audit-c4-auth-token-in-stdout.md](audit-c4-auth-token-in-stdout.md) | Full WebUI auth token printed to stdout at startup |

### High (P1/P2)

| ID | File | Title | Priority |
|----|------|-------|----------|
| H1 | [audit-h1-json-parse-no-try-catch.md](audit-h1-json-parse-no-try-catch.md) | `JSON.parse` in `rowTo*` has no try/catch | P1 |
| H2 | [audit-h2-escalations-never-reach-user.md](audit-h2-escalations-never-reach-user.md) | Escalations never reach the user | P1 |
| H3 | [audit-h3-settimeout-leak-plan-step.md](audit-h3-settimeout-leak-plan-step.md) | `deps_planWithTimeout` leaks a `setTimeout` | P2 |
| H4 | [audit-h4-pause-race-in-flight-step.md](audit-h4-pause-race-in-flight-step.md) | Race between `pauseTask()` and in-flight step | P2 |
| H5 | [audit-h5-unbounded-checkpoints-growth.md](audit-h5-unbounded-checkpoints-growth.md) | Unbounded `task_checkpoints` growth | P2 |
| H6 | [audit-h6-admin-ids-fallback-zero.md](audit-h6-admin-ids-fallback-zero.md) | `admin_ids[0] ?? 0` silently escalates to non-existent user | P2 |
| H7 | [audit-h7-setup-wizard-unauth-unrate-limited.md](audit-h7-setup-wizard-unauth-unrate-limited.md) | Setup wizard writes `auth_token` unauthenticated | P1 |

### Medium (P2/P3)

| ID | File | Title | Priority |
|----|------|-------|----------|
| M1 | [audit-m1-no-global-max-iteration-cap.md](audit-m1-no-global-max-iteration-cap.md) | No global max-iteration safety cap | P2 |
| M2 | [audit-m2-rate-limit-timestamps-unbounded.md](audit-m2-rate-limit-timestamps-unbounded.md) | Rate-limit timestamps only pruned during `checkAction()` | P2 |
| M3 | [audit-m3-permissive-ton-spending-defaults.md](audit-m3-permissive-ton-spending-defaults.md) | `DEFAULT_POLICY_CONFIG.tonSpending` defaults are permissive | P3 |
| M4 | [audit-m4-empty-reason-on-escalation.md](audit-m4-empty-reason-on-escalation.md) | `requiresEscalation` without recorded violation yields empty reason | P2 |
| M5 | [audit-m5-paused-forever-tasks.md](audit-m5-paused-forever-tasks.md) | Escalated/paused tasks have no auto-timeout | P3 |
| M6 | [audit-m6-inconsistent-path-traversal-checks.md](audit-m6-inconsistent-path-traversal-checks.md) | Path-traversal guard inconsistent between servers | P3 |
| M7 | [audit-m7-management-api-default-host.md](audit-m7-management-api-default-host.md) | Setup writes `api.host = "0.0.0.0"` by default | P3 |
| M8 | [audit-m8-session-ttl-only-on-creation.md](audit-m8-session-ttl-only-on-creation.md) | Setup Telegram sessions validate TTL only on creation | P3 |

### Low (P3)

| ID | File | Title |
|----|------|-------|
| L1 | [audit-l1-config-version-default-mismatch.md](audit-l1-config-version-default-mismatch.md) | Config schema `version` default disagrees with package version |
| L2 | [audit-l2-error-responses-leak-workspace-paths.md](audit-l2-error-responses-leak-workspace-paths.md) | Error responses leak workspace absolute paths |
| L3 | [audit-l3-audit-middleware-skips-failed-mutations.md](audit-l3-audit-middleware-skips-failed-mutations.md) | Audit middleware skips failed (4xx/5xx) mutations |
| L4 | [audit-l4-max-parallel-tasks-overflow-throws.md](audit-l4-max-parallel-tasks-overflow-throws.md) | `maxParallelTasks` overflow throws instead of queuing |

## Priority Legend

- **P1 — Before re-enabling autonomous wallet mode.** C1, C2, C3, C4, H1, H2, H7.
- **P2 — Next minor release.** H3, H4, H5, H6, M1, M2, M4.
- **P3 — Opportunistic (hardening, defaults).** M3, M5, M6, M7, M8, L1, L2, L3, L4.

## Template Structure

Each file follows the same structure:

```markdown
---
title: "[AUDIT-<ID>] <short description>"
labels: [...]
milestone: "v2.2 - Stability & Reliability"
severity: critical|high|medium|low
category: bug|logic|conflict|security|reliability|technical-debt|ux|config
effort: small|medium|large
priority: P1|P2|P3
---

## Источник
## Описание
## Местоположение
## Влияние
## Предложенное исправление
## Критерии приёмки
## Оценка
```

This matches the format requested in issue #250 (section **📋 Ожидаемый
результат** → "Приоритизированный список задач (GitHub Issues)"), with
a few additions (`severity`, `category`, `effort`, `priority`) for
traceability back to the audit report.

## Creating issues from the CLI

Example:

```bash
cd improvements/work
for f in audit-c*.md audit-h*.md; do
  title=$(awk -F'"' '/^title:/{print $2; exit}' "$f")
  labels=$(awk '/^labels:/{gsub(/^labels:[[:space:]]*\[|\]$/,""); print}' "$f")
  # Strip the YAML front-matter from the body before piping to gh:
  body=$(awk '/^---$/{c++; next} c==2' "$f")
  gh issue create \
    --repo xlabtg/teleton-agent \
    --title "$title" \
    --body "$body" \
    --label "$labels" \
    --milestone "v2.2 - Stability & Reliability"
done
```

(Adjust `--label` to pass labels one at a time if `gh` complains.)
