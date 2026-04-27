# V2 Full Audit Work Folder

This folder contains V2 audit workspaces for
[`#398`](https://github.com/xlabtg/teleton-agent/issues/398) and
[`#445`](https://github.com/xlabtg/teleton-agent/issues/445). It is not a
scratchpad: each report covers one requested audit lane, and each confirmed
defect uses a reproducible record format.

## Scope

- Architecture consistency
- Security and trust boundaries
- Runtime integration
- UI/API parity
- Regression and backward compatibility
- Performance and reliability
- Operational readiness

The audit was performed against branch `issue-398-974a2c1185a7` after the V2
feature series had landed on `main`, including the recent multi-agent network,
adaptive prompting, widget generator, audit trail, webhooks/event bus,
integrations, dynamic dashboards, feedback learning, and agent network work.

## Reports

| File                                                                       | Purpose                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [AUDIT_V2_REPORT.md](AUDIT_V2_REPORT.md)                                   | Issue #445 full V2 audit report and task index                 |
| [01-architecture-consistency.md](01-architecture-consistency.md)           | Cross-feature architecture shape and ownership boundaries      |
| [02-security-and-trust.md](02-security-and-trust.md)                       | Signed ingress, trust config, replay, and privilege boundaries |
| [03-runtime-and-integrations.md](03-runtime-and-integrations.md)           | Whether V2 endpoints connect to executable runtime paths       |
| [04-ui-api-parity.md](04-ui-api-parity.md)                                 | WebUI route, Management API, and generated-widget parity       |
| [05-regressions-and-compatibility.md](05-regressions-and-compatibility.md) | Backward compatibility and externally visible route behavior   |
| [06-performance-and-reliability.md](06-performance-and-reliability.md)     | Idempotency, duplicate work, and preview reliability           |
| [07-final-v2-summary.md](07-final-v2-summary.md)                           | Final summary, issue index, and follow-up order                |
| [audit-config.yaml](audit-config.yaml)                                     | Issue #445 audit metadata and inspected paths                  |

## Confirmed Findings From #445

| ID     | Severity | Task File                                                                                                                                      | GitHub Issue                                               | Status  |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------- |
| V2-001 | High     | [issues/V2-001-public-v2-webhooks-blocked-by-webui-auth.md](issues/V2-001-public-v2-webhooks-blocked-by-webui-auth.md)                         | [#447](https://github.com/xlabtg/teleton-agent/issues/447) | Created |
| V2-002 | High     | [issues/V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md](issues/V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md) | [#448](https://github.com/xlabtg/teleton-agent/issues/448) | Created |
| V2-003 | High     | [issues/V2-003-pipeline-run-timeout-does-not-bound-running-steps.md](issues/V2-003-pipeline-run-timeout-does-not-bound-running-steps.md)       | [#449](https://github.com/xlabtg/teleton-agent/issues/449) | Created |
| V2-004 | Medium   | [issues/V2-004-memory-search-skips-semantic-vector-retrieval.md](issues/V2-004-memory-search-skips-semantic-vector-retrieval.md)               | [#450](https://github.com/xlabtg/teleton-agent/issues/450) | Created |
| V2-005 | Medium   | [issues/V2-005-workflow-call-api-actions-have-no-timeout.md](issues/V2-005-workflow-call-api-actions-have-no-timeout.md)                       | [#451](https://github.com/xlabtg/teleton-agent/issues/451) | Created |

The issue body frontmatter contains the requested labels and milestone metadata.
The automation token used for creation has read-only upstream repository
permission, so maintainers need to apply the labels, milestone, and assignment
in GitHub.

## Validation For #445

Run the structural artifact check:

```bash
node improvements/work3/validation/check-artifacts.mjs
```

Run the current-code reproduction check:

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

The reproduction check exits non-zero while the five audit findings remain
present. After future fix PRs, the same script can be used as a quick guard that
the audited code patterns are gone.

## Confirmed Findings From #398

| ID       | Seriousness | Primary Report                                                                                                                           | GitHub Issue                                               | Status |
| -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| WORK3-H1 | High        | [02-security-and-trust.md](02-security-and-trust.md#work3-h1-agent-network-ingress-ignores-allowlist-and-message-recipient)              | [#400](https://github.com/xlabtg/teleton-agent/issues/400) | Filed  |
| WORK3-H2 | High        | [03-runtime-and-integrations.md](03-runtime-and-integrations.md#work3-h2-agent-network-ingress-creates-pending-tasks-that-never-execute) | [#401](https://github.com/xlabtg/teleton-agent/issues/401) | Filed  |
| WORK3-M1 | Medium      | [06-performance-and-reliability.md](06-performance-and-reliability.md#work3-m1-agent-network-accepts-replayed-signed-task-requests)      | [#402](https://github.com/xlabtg/teleton-agent/issues/402) | Filed  |
| WORK3-H3 | High        | [04-ui-api-parity.md](04-ui-api-parity.md#work3-h3-management-api-does-not-expose-most-v2-webui-routes)                                  | [#403](https://github.com/xlabtg/teleton-agent/issues/403) | Filed  |
| WORK3-M2 | Medium      | [04-ui-api-parity.md](04-ui-api-parity.md#work3-m2-widget-generator-previews-return-empty-data-for-advertised-sources)                   | [#404](https://github.com/xlabtg/teleton-agent/issues/404) | Filed  |

## Method

- Read issue `#398`, prior audit folders `improvements/work` and
  `improvements/work2`, and recent audit PR context to avoid duplicate
  findings.
- Compared current WebUI route mounts against Management API route mounts.
- Exercised signed agent-network ingress in memory with Hono, SQLite, and
  Ed25519 keys to verify trust, recipient, pending-task, and replay behavior.
- Exercised widget generation and preview route behavior for an advertised
  performance data source.
- Checked all new findings against the current open issue list before filing
  separate GitHub issues.

## Finding Format

Each detailed defect entry uses this structure:

- component
- seriousness
- symptoms
- how to reproduce
- expected behavior
- actual behavior
- hypothesis of the cause
- recommended fix
- link to issue/PR
