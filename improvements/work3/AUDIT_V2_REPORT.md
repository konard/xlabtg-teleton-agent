# V2 Architecture Full Audit - Teleton Agent

## Executed

- Date: 2026-04-27
- Model: OpenAI Codex GPT-5
- Audit issue: [#445](https://github.com/xlabtg/teleton-agent/issues/445)
- Branch: `issue-445-2a5fadc82968`
- Audit commit: `1824d777e9ac37acb2b530d7de195f3cbb17891a`
- Compared base: `upstream/main` at `3eacbbf976023a4aaa7eda290a827ca589d76c47`

Note: the issue requested Claude/Hive Mind execution. This run was performed by
OpenAI Codex in the prepared issue-solver workspace. The report records the
actual execution environment for traceability.

## Executive Summary

Overall assessment: Red for production use of the affected V2 paths.

Top release blockers:

1. Public webhook ingress for V2 webhooks and workflow webhooks is effectively
   unreachable because global WebUI auth and CSRF middleware only bypass the
   signed agent-network endpoint.
2. Pipeline steps delegated to managed agents are marked complete as soon as an
   inbox message is sent, so downstream steps consume dispatch metadata instead
   of the delegated agent's real result.
3. Pipeline-level timeouts do not bound an already-running step or level; a
   hanging agent call can leave a run stuck in `running`.
4. The WebUI/Management API memory search endpoint bypasses embeddings and
   semantic vector retrieval even when semantic memory is configured.
5. Workflow `call_api` actions use raw `fetch()` without a timeout, so one slow
   endpoint can block webhook/event/cron workflow execution.

Recommendation: No-Go for production use of public webhook automation and
cross-agent pipeline execution until V2-001, V2-002, and V2-003 are fixed.
Conditional Go for semantic memory and simple workflows only if operators accept
the documented fallback and hanging-call risks.

## Quick Links

- Task files: [issues/](./issues/)
- Filed GitHub issues: [#447](https://github.com/xlabtg/teleton-agent/issues/447),
  [#448](https://github.com/xlabtg/teleton-agent/issues/448),
  [#449](https://github.com/xlabtg/teleton-agent/issues/449),
  [#450](https://github.com/xlabtg/teleton-agent/issues/450), and
  [#451](https://github.com/xlabtg/teleton-agent/issues/451)
- Validation scripts: [validation/](./validation/)
- Previous V2 audit workspace: [README.md](./README.md)

## Finding Statistics

| Severity | Count | Task Files Created | GitHub Issues Created | Draft PRs |
| -------- | ----- | ------------------ | --------------------- | --------- |
| Critical | 0     | 0                  | 0                     | 0         |
| High     | 3     | 3                  | 3                     | 0         |
| Medium   | 2     | 2                  | 2                     | 0         |
| Low      | 0     | 0                  | 0                     | 0         |

## Filed GitHub Issues

The five follow-up issues were created from the task templates on 2026-04-27.
The issue bodies preserve the requested frontmatter metadata for labels,
milestone, audit source, finding id, severity, and category.

| Finding | GitHub Issue                                               | Source Template                                                                                                                           |
| ------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| V2-001  | [#447](https://github.com/xlabtg/teleton-agent/issues/447) | [V2-001-public-v2-webhooks-blocked-by-webui-auth.md](./issues/V2-001-public-v2-webhooks-blocked-by-webui-auth.md)                         |
| V2-002  | [#448](https://github.com/xlabtg/teleton-agent/issues/448) | [V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md](./issues/V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md) |
| V2-003  | [#449](https://github.com/xlabtg/teleton-agent/issues/449) | [V2-003-pipeline-run-timeout-does-not-bound-running-steps.md](./issues/V2-003-pipeline-run-timeout-does-not-bound-running-steps.md)       |
| V2-004  | [#450](https://github.com/xlabtg/teleton-agent/issues/450) | [V2-004-memory-search-skips-semantic-vector-retrieval.md](./issues/V2-004-memory-search-skips-semantic-vector-retrieval.md)               |
| V2-005  | [#451](https://github.com/xlabtg/teleton-agent/issues/451) | [V2-005-workflow-call-api-actions-have-no-timeout.md](./issues/V2-005-workflow-call-api-actions-have-no-timeout.md)                       |

Metadata application note: the automation token has `READ` permission on
`xlabtg/teleton-agent`, so GitHub accepted issue creation but rejected upstream
label and milestone management. Maintainers with triage/write access should add
the frontmatter labels (`bug`, `audit-finding-v2`, severity, `v3.0-blocker`),
assign the issues as needed, and create/apply the `v3.0 - Production Ready`
milestone.

## Prioritized Fix Plan

### Priority 0 - Fix before any production webhook or multi-agent pipeline use

1. [V2-001](./issues/V2-001-public-v2-webhooks-blocked-by-webui-auth.md) -
   Public V2 webhook ingress is blocked by WebUI auth and CSRF
   ([#447](https://github.com/xlabtg/teleton-agent/issues/447)).
   - Effort: Medium
   - Validation: route-level tests that unsigned browser mutations still require
     auth/CSRF while signed webhook ingress reaches the route handler.
2. [V2-002](./issues/V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md) -
   Delegated pipeline steps complete on inbox dispatch rather than remote result
   ([#448](https://github.com/xlabtg/teleton-agent/issues/448)).
   - Effort: High
   - Validation: pipeline test where step B depends on the textual result of a
     managed-agent step A.
3. [V2-003](./issues/V2-003-pipeline-run-timeout-does-not-bound-running-steps.md) -
   Pipeline-level timeouts do not stop hung step execution
   ([#449](https://github.com/xlabtg/teleton-agent/issues/449)).
   - Effort: Medium
   - Validation: fake-timer test with a never-resolving `processMessage()` and a
     short `timeoutSeconds` pipeline limit.

### Priority 1 - Fix before v3.0 release

4. [V2-004](./issues/V2-004-memory-search-skips-semantic-vector-retrieval.md) -
   Memory search API never computes query embeddings for semantic retrieval
   ([#450](https://github.com/xlabtg/teleton-agent/issues/450)).
   - Effort: Medium
   - Validation: route test with a mock embedder/vector store proving semantic
     results are returned for queries that keyword search misses.
5. [V2-005](./issues/V2-005-workflow-call-api-actions-have-no-timeout.md) -
   Workflow `call_api` actions have no timeout or abort path
   ([#451](https://github.com/xlabtg/teleton-agent/issues/451)).
   - Effort: Small
   - Validation: fake-timer test where `fetch()` never resolves and the workflow
     records an error instead of hanging.

## Confirmed Findings

### V2-001 - Public V2 webhook ingress is blocked by WebUI auth and CSRF

- Severity: High
- Category: Integration / security boundary
- Evidence:
  - `src/webui/server.ts:180` installs CSRF globally before route mounting.
  - `src/webui/server.ts:213` applies auth to `/api/*` and only bypasses
    `/api/agent-network`.
  - `src/webui/server.ts:321` and `src/webui/server.ts:324` mount workflows and
    webhooks under `/api`.
  - `src/webui/routes/workflows.ts:192` describes `/webhook/:secret` as public,
    but it is still mounted below `/api/workflows`.
  - `src/webui/routes/webhooks.ts:72` verifies `X-Webhook-Signature`, but the
    request cannot reach that verifier without WebUI auth and CSRF.
- Impact: external providers cannot trigger configured webhooks or workflows
  using their advertised secret/signature model. Operators may conclude
  webhooks are active while all real inbound calls fail with 401/403.
- Task: [V2-001](./issues/V2-001-public-v2-webhooks-blocked-by-webui-auth.md)
- GitHub issue: [#447](https://github.com/xlabtg/teleton-agent/issues/447)

### V2-002 - Managed-agent pipeline steps complete on dispatch metadata

- Severity: High
- Category: Runtime integration
- Evidence:
  - `src/services/pipeline/executor.ts:267` sends a message to the selected
    managed agent.
  - `src/services/pipeline/executor.ts:272` immediately returns dispatch
    metadata: `messageId`, `toAgentId`, `toAgentName`, `createdAt`, and
    `action`.
  - The returned dispatch object is stored as the step output and can feed
    downstream interpolation, even though it is not the delegated result.
- Impact: multi-agent pipelines report success before delegated work is done,
  dependent steps run on metadata rather than real outputs, and failures in the
  managed agent are invisible to the pipeline run.
- Task: [V2-002](./issues/V2-002-pipeline-delegated-agent-output-is-dispatch-metadata.md)
- GitHub issue: [#448](https://github.com/xlabtg/teleton-agent/issues/448)

### V2-003 - Pipeline run timeout does not bound running steps

- Severity: High
- Category: Reliability
- Evidence:
  - `src/services/pipeline/executor.ts:117` computes a pipeline-level deadline.
  - `src/services/pipeline/executor.ts:125` checks that deadline only before
    starting each level.
  - `src/services/pipeline/executor.ts:136` then awaits the whole level with
    `Promise.all(...)`.
  - `src/services/pipeline/executor.ts:281` applies timeout wrapping only when a
    step has `step.timeoutSeconds`.
- Impact: a pipeline with `timeoutSeconds` can remain stuck in `running` if a
  step without its own timeout never resolves. Cancellation only changes stored
  state; it does not abort the in-flight promise.
- Task: [V2-003](./issues/V2-003-pipeline-run-timeout-does-not-bound-running-steps.md)
- GitHub issue: [#449](https://github.com/xlabtg/teleton-agent/issues/449)

### V2-004 - Memory search API skips semantic vector retrieval

- Severity: Medium
- Category: UI/API parity
- Evidence:
  - `src/webui/routes/memory.ts:95` constructs `HybridSearch` with
    `vectorEnabled = false`.
  - `src/webui/routes/memory.ts:101` calls `searchKnowledge(query, [], ...)`
    with an empty embedding array.
  - `HybridSearch` requires a non-empty query embedding before it calls the
    semantic vector store.
- Impact: the user-facing memory search API remains keyword-only even when
  semantic vector memory is configured and synchronized. Natural-language
  queries that should be answered by semantic similarity return empty or
  incomplete results.
- Task: [V2-004](./issues/V2-004-memory-search-skips-semantic-vector-retrieval.md)
- GitHub issue: [#450](https://github.com/xlabtg/teleton-agent/issues/450)

### V2-005 - Workflow `call_api` actions have no timeout

- Severity: Medium
- Category: Reliability / integrations
- Evidence:
  - `src/services/workflow-executor.ts:51` builds the `call_api` action request.
  - `src/services/workflow-executor.ts:59` awaits `fetch(action.url, init)`
    without `AbortController`, `AbortSignal.timeout`, or a configured action
    timeout.
- Impact: one slow or never-responding endpoint can block webhook, event, or
  cron workflow execution. Because `WorkflowScheduler.execute()` awaits the
  executor, scheduler progress and later workflow actions can stall behind the
  hung fetch.
- Task: [V2-005](./issues/V2-005-workflow-call-api-actions-have-no-timeout.md)
- GitHub issue: [#451](https://github.com/xlabtg/teleton-agent/issues/451)

## Non-Duplicate Check

The five findings above were checked against the previous V2 work3 findings and
their follow-up fixes:

- #400 / #405 / #410: agent-network allowlist and recipient checks.
- #401 / #406: agent-network ingress task dispatch.
- #402 / #407: replayed signed network messages.
- #403 / #408: Management API route parity.
- #404 / #409: widget generator preview parity.

The new findings target public webhook ingress, delegated pipeline result
semantics, pipeline timeout enforcement, semantic search wiring, and workflow
HTTP action timeouts. They do not duplicate the closed work3 issues.

## Verification Performed

- Read issue #445, existing PR #446 metadata, issue comments, PR comments,
  review comments, and recent merged V2/audit PRs.
- Reviewed prior audit folders `improvements/work`, `improvements/work2`, and
  `improvements/work3`.
- Reviewed V2 specifications under `improvements/v2-*.md`.
- Inspected current implementations in:
  - `src/webui/server.ts`
  - `src/webui/routes/workflows.ts`
  - `src/webui/routes/webhooks.ts`
  - `src/services/pipeline/executor.ts`
  - `src/webui/routes/memory.ts`
  - `src/services/workflow-executor.ts`
- Installed dependencies with `npm ci --ignore-scripts`; npm reported zero
  vulnerabilities.
- Added validation tooling:
  - `node improvements/work3/validation/check-artifacts.mjs`
  - `node improvements/work3/validation/reproduce-findings.mjs`

## Out Of Scope

- Applying the five production fixes in this PR. Issue #445 asks for an audit
  report and ready-to-import issue templates.
- Applying labels, milestone, or assignees to the created follow-up issues. The
  upstream token available to this automation has read-only repository
  permission, so the requested metadata remains in each issue body frontmatter
  for maintainers to apply.
- Load testing, browser screenshots, or end-to-end webhook calls against a
  deployed instance.
