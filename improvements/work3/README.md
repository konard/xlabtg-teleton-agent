# V2 Full Audit Work Folder

This folder is the audit workspace for
[`#398`](https://github.com/xlabtg/teleton-agent/issues/398). It is not a
scratchpad: each report covers one requested audit lane, and each confirmed
defect uses the same record format.

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
| [01-architecture-consistency.md](01-architecture-consistency.md)           | Cross-feature architecture shape and ownership boundaries      |
| [02-security-and-trust.md](02-security-and-trust.md)                       | Signed ingress, trust config, replay, and privilege boundaries |
| [03-runtime-and-integrations.md](03-runtime-and-integrations.md)           | Whether V2 endpoints connect to executable runtime paths       |
| [04-ui-api-parity.md](04-ui-api-parity.md)                                 | WebUI route, Management API, and generated-widget parity       |
| [05-regressions-and-compatibility.md](05-regressions-and-compatibility.md) | Backward compatibility and externally visible route behavior   |
| [06-performance-and-reliability.md](06-performance-and-reliability.md)     | Idempotency, duplicate work, and preview reliability           |
| [07-final-v2-summary.md](07-final-v2-summary.md)                           | Final summary, issue index, and follow-up order                |

## Confirmed Findings

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
