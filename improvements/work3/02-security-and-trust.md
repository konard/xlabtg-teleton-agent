# 02 - Security And Trust

## Scope

This report covers V2 trust boundaries: signed inter-agent ingress,
allowlist/blocklist enforcement, recipient validation, replay protection,
authentication surfaces, and privilege boundaries.

## Confirmed Defects

### WORK3-H1: Agent network ingress ignores allowlist and message recipient

- component: Agent network ingress / trust boundary
  (`src/webui/routes/network.ts`, `src/services/network/messenger.ts`)
- seriousness: High - security / trust boundary
- symptoms: A signed `task_request` from a registered verified peer is
  accepted even when `network.allowlist` excludes that sender. The same ingress
  endpoint also accepts a message whose `to` field targets a different agent id
  than the local configured `network.agent_id`.
- how to reproduce:
  1. Configure `network.enabled = true`, `network.agent_id = primary`, and
     `network.allowlist = ["different-agent"]`.
  2. Register verified peer `agent-003` with a public key.
  3. POST a valid signed `task_request` from `agent-003` to
     `/api/agent-network`.
  4. Repeat with `to = "other-local-agent"`.
  5. The audit exercise returned HTTP 202 for both requests and inserted two
     tasks.
- expected behavior: Ingress rejects non-allowlisted senders and rejects
  messages not addressed to the local agent id before creating tasks or logging
  accepted messages.
- actual behavior: `createCoordinator()` passes `allowlist` and `blocklist`
  into outbound delegation, but `createMessenger()` constructs an inbound
  `NetworkMessenger` without a configured `NetworkTrustService`. Inside
  `NetworkMessenger.receiveMessage()`, the signed envelope is verified, but
  `message.to` is never compared with `localAgentId`.
- hypothesis of the cause: Outbound and inbound trust services were wired
  separately. The outbound path received config, while the inbound path fell
  back to `new NetworkTrustService()` with no allowlist/blocklist options.
  Recipient validation was omitted from the canonical signature verification
  path.
- recommended fix: Pass a configured `NetworkTrustService` into inbound
  `NetworkMessenger`, enforce `message.to === localAgentId`, and add route and
  service tests for allowlist rejection, blocklist rejection, and wrong
  recipient rejection.
- link to issue/PR: [#400](https://github.com/xlabtg/teleton-agent/issues/400),
  PR [#399](https://github.com/xlabtg/teleton-agent/pull/399)

## Cross-linked Security Findings

- Replay/idempotency is also a trust-boundary issue, but it is recorded in the
  reliability report as [WORK3-M1](06-performance-and-reliability.md#work3-m1-agent-network-accepts-replayed-signed-task-requests).

## Non-findings

- Unsigned agent-network messages are rejected by existing tests and by the
  signature verification path.
- The `/api/agent-network` ingress skips browser CSRF intentionally because it
  uses signed inter-agent messages rather than browser cookies.
