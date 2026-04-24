# 06 - Performance And Reliability

## Scope

This report checks reliability behavior under duplicate delivery, partial
integration, empty data, and operational repeatability. Performance-specific
load testing was not part of this issue; confirmed findings here focus on
reliability risks with clear reproduction.

## Confirmed Defects

### WORK3-M1: Agent network accepts replayed signed task requests

- component: Agent network messaging / replay protection
  (`src/services/network/messenger.ts`, `src/services/network/discovery.ts`,
  `src/memory/schema.ts`)
- seriousness: Medium - reliability / trust boundary
- symptoms: Posting the exact same signed `task_request` envelope twice within
  the allowed clock-skew window returns HTTP 202 twice and creates two local
  tasks. `network_messages` records duplicate rows with the same
  `correlation_id`.
- how to reproduce:
  1. Enable the network and register a verified peer with a public key.
  2. Build one signed `task_request` envelope with a fixed `correlationId`.
  3. POST the exact same JSON body twice to `/api/agent-network` within five
     minutes.
  4. Query `network_messages` and `tasks`.
  5. The audit exercise observed two HTTP 202 responses, two
     `network_messages` rows for the same correlation id, and two created
     tasks.
- expected behavior: The second delivery of the same signed envelope should be
  idempotent or rejected as a replay. It should not create another task.
- actual behavior: The schema has only a non-unique index on
  `network_messages.correlation_id`, and `receiveMessage()` does not check
  prior envelopes or correlation ids before logging and routing the message.
- hypothesis of the cause: The implementation verifies signature and timestamp
  skew but lacks nonce/correlation uniqueness semantics for inbound messages.
- recommended fix: Add replay protection keyed by sender + recipient +
  correlation id, or by a hash of the canonical signed envelope. Enforce it
  with a unique index and route-level idempotency behavior, then cover
  duplicate `task_request`, `heartbeat`, and `task_response` cases in tests.
- link to issue/PR: [#402](https://github.com/xlabtg/teleton-agent/issues/402),
  PR [#399](https://github.com/xlabtg/teleton-agent/pull/399)

## Cross-linked Reliability Findings

- [WORK3-H2](03-runtime-and-integrations.md#work3-h2-agent-network-ingress-creates-pending-tasks-that-never-execute)
  is a runtime reliability issue because accepted remote work can remain
  pending indefinitely.
- [WORK3-M2](04-ui-api-parity.md#work3-m2-widget-generator-previews-return-empty-data-for-advertised-sources)
  is a UI reliability issue because valid generated widgets can render as empty
  previews even when the route returns success.

## Performance Notes

- No new algorithmic hot path was confirmed as a performance defect in this
  pass.
- Agent-network replay protection should be enforced with database constraints
  or indexed lookups to avoid turning idempotency into an unbounded scan.
