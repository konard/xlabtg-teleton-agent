# 03 - Runtime And Integrations

## Scope

This report checks that V2 APIs connect to the runtime systems they imply:
agent lifecycle, task execution, schedulers, integration registries, generated
widgets, and external network messages.

## Confirmed Defects

### WORK3-H2: Agent network ingress creates pending tasks that never execute

- component: Agent network ingress / task runtime integration
  (`src/webui/routes/network.ts`, `src/index.ts`, `src/telegram/task-executor.ts`)
- seriousness: High - runtime integration
- symptoms: A signed remote `task_request` returns HTTP 202 and a `taskId`,
  but the created row is a generic scheduled-task record with
  `status = pending`, `scheduled_for = NULL`, and `scheduled_message_id = NULL`.
  The existing scheduled-task executor only runs when a Telegram saved message
  in `[TASK:<id>]` format is received, so the network task is accepted but no
  runtime path starts it.
- how to reproduce:
  1. Enable the agent network and register a verified peer with a public key.
  2. POST a signed `task_request` to `/api/agent-network`.
  3. Query `tasks` for the returned id.
  4. The audit exercise observed `status = pending`, `created_by =
network:agent-003`, `scheduled_for = NULL`, and
     `scheduled_message_id = NULL`.
- expected behavior: Remote task ingress either dispatches the task to an
  executor/manager immediately, schedules the existing task executor through a
  supported mechanism, or returns a status that clearly indicates the task is
  only queued and requires operator action.
- actual behavior: The route only calls `getTaskStore(...).createTask(...)`
  and returns success. No Telegram scheduling, autonomous manager handoff,
  lifecycle dispatch, or response callback is wired.
- hypothesis of the cause: The network implementation reused the generic task
  table as a durable inbox, but the generic task execution path is driven by
  Telegram scheduled messages, not database polling.
- recommended fix: Define the network task execution contract: integrate with
  `AutonomousTaskManager`/agent runtime, add a database-backed task dispatcher,
  or rename the behavior to a manual inbox. Add a regression test that a signed
  ingress request transitions beyond inert `pending` or documents an explicit
  queued/manual state.
- link to issue/PR: [#401](https://github.com/xlabtg/teleton-agent/issues/401),
  PR [#399](https://github.com/xlabtg/teleton-agent/pull/399)

## Integration Notes

- `task_response` messages are accepted and logged, but no local task or
  delegation result is completed from them. That should be reviewed when
  [#401](https://github.com/xlabtg/teleton-agent/issues/401) defines the
  network task lifecycle.
- Widget preview integration has a data-source parity issue recorded as
  [WORK3-M2](04-ui-api-parity.md#work3-m2-widget-generator-previews-return-empty-data-for-advertised-sources).
