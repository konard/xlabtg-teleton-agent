---
title: "[AUDIT/V2] Pipeline delegated-agent steps complete on dispatch metadata"
labels: ["bug", "audit-finding-v2", "high", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
audit-source: "#445"
finding-id: "V2-002"
severity: "high"
category: "runtime-integration"
github-issue: "https://github.com/xlabtg/teleton-agent/issues/448"
---

## Problem Description

Pipeline steps can target a managed agent by setting `step.agent` to a non-primary
agent name/type/id. The executor sends an inbox message to that agent and then
immediately marks the step completed with dispatch metadata (`messageId`,
`toAgentId`, `createdAt`, and `action`). It does not wait for the managed agent
to process the message or return a step result.

This breaks the V2 pipeline contract where a step output feeds dependent steps.
Downstream steps receive message-delivery metadata rather than the delegated
agent's actual result.

## Location

- `src/services/pipeline/executor.ts:241`
- `src/services/pipeline/executor.ts:267`
- `src/services/pipeline/executor.ts:272`

## How To Reproduce

```bash
node improvements/work3/validation/reproduce-findings.mjs
```

Manual minimal scenario:

1. Configure a pipeline with step A assigned to `ResearchAgent`, output
   `research_notes`.
2. Configure step B with `dependsOn: ["A"]` and action
   `Summarize {research_notes}`.
3. Run the pipeline.
4. Observe that step A completes immediately and step B interpolates an object
   containing message dispatch metadata instead of research notes.

## Impact

Cross-agent pipelines can report successful completion while delegated work is
still pending, failed, or never executed. Dependent steps cannot reliably consume
remote outputs, so multi-agent task delegation becomes a notification system
rather than an executable pipeline.

## Proposed Fix

Define a delegated step lifecycle and persist it in the pipeline run:

```typescript
// Sketch only.
const dispatch = agentManager.sendMessage("primary", agent.id, payload);
store.updateStep(runId, step.id, {
  status: "running",
  outputValue: { messageId: dispatch.id, pending: true },
});

const result = await agentManager.waitForMessageResult(dispatch.id, {
  timeoutSeconds: step.timeoutSeconds ?? pipelineRemainingTimeout,
});

return result.content;
```

Possible implementation options:

- add a managed-agent result callback and correlate by message id;
- add an inbox/result table consumed by `PipelineExecutor`;
- disallow non-primary pipeline steps until result correlation exists.

## Regression Test

```typescript
it("waits for managed-agent output before running dependent pipeline steps", async () => {
  const agentManager = fakeManagedAgentManager({
    resultForMessage: "actual research notes",
  });
  const pipeline = store.create({
    name: "delegated",
    steps: [
      { id: "research", agent: "ResearchAgent", action: "Research TON", output: "notes" },
      { id: "summary", agent: "primary", action: "Summarize {notes}", depends_on: ["research"] },
    ],
  });

  const detail = await executor.execute(pipeline);

  expect(detail.run.context.notes).toBe("actual research notes");
  expect(primaryProcessMessage).toHaveBeenCalledWith(
    expect.objectContaining({ userMessage: "Summarize actual research notes" })
  );
});
```

## Acceptance Criteria

- [ ] Managed-agent pipeline steps do not complete until a real delegated result
      or terminal failure is available.
- [ ] Dependent steps interpolate the delegated result, not dispatch metadata.
- [ ] Timeout, cancellation, and failure states are persisted for delegated
      steps.
- [ ] Regression tests cover success, remote failure, timeout, and cancellation.

## Related Artifacts

- GitHub issue: https://github.com/xlabtg/teleton-agent/issues/448
- Report: `improvements/work3/AUDIT_V2_REPORT.md#v2-002---managed-agent-pipeline-steps-complete-on-dispatch-metadata`
- Module: `src/services/pipeline/executor.ts`
- Related V2 specs: `improvements/v2-08-task-delegation.md`,
  `improvements/v2-09-pipeline-execution.md`
