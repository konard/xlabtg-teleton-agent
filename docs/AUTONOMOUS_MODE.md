# Autonomous Mode (Autonomous Task Engine)

Autonomous Mode enables Teleton Agent to work on complex, long-running goals without constant user intervention. The agent autonomously plans actions, executes tools, self-reflects on progress, and adapts its strategy — all while respecting configurable safety guardrails.

---

## Prerequisite: `telegram.admin_ids` must be non-empty

The autonomous task manager attributes every action it takes to a real Telegram user id so that admin-only tools pass their scope check and so that escalations have a destination. If `telegram.admin_ids` is empty, the manager refuses to start with a clear error (`Cannot start autonomous manager: config.telegram.admin_ids is empty.`) and the WebUI/API will boot without the autonomous layer. Add at least one admin id in `config.yaml`:

```yaml
telegram:
  admin_ids: [123456789]   # your Telegram user ID (from @userinfobot)
```

The same requirement applies to the heartbeat timer: it logs a warning and skips ticks when `admin_ids` is empty rather than silently delivering alerts to user id `0`.

---

## Quick Start

### 1. Start a monitoring task via CLI

```sh
teleton autonomous enable \
  --task="Monitor new liquidity pools on DeDust every 5 minutes and report to @mychannel" \
  --priority=high \
  --strategy=balanced \
  --max-hours=8 \
  --success-criteria="at least 1 pool recorded in DB" \
  --success-criteria="report sent to channel"
```

### 2. Check task status

```sh
teleton autonomous status

# Or for a specific task:
teleton autonomous status --id <taskId>
```

### 3. Pause / resume

```sh
teleton autonomous pause  --id <taskId>
teleton autonomous resume --id <taskId>
```

### 4. Stop all active tasks

```sh
teleton autonomous disable --force
```

---

## Key Concepts

### The Autonomous Loop

Each task runs through this cycle until success criteria are met or a limit is hit:

```
goal → plan → check_policies → execute → observe → reflect → adapt → save_checkpoint → repeat
```

1. **Plan**: The LLM selects the next best action given the goal and history.
2. **Check policies**: Guardrails verify budget, tool access, rate limits.
3. **Execute**: The selected tool runs with timeout and retry handling.
4. **Reflect**: The LLM evaluates progress — stuck? goal achieved? pivot needed?
5. **Adapt**: Context is updated with new information from the reflection.
6. **Checkpoint**: State is persisted so the task can resume after a crash.

### Strategies

| Strategy | Behavior |
|----------|----------|
| `conservative` | Requests confirmation more often; slower but safer |
| `balanced` | Default — confirms only for high-risk actions |
| `aggressive` | Fewer confirmations; faster but higher risk of mistakes |

### Priority Levels

`low` → `medium` → `high` → `critical`

Higher priority tasks are queued first when the agent restarts.

---

## Task Configuration

```json
{
  "goal": "Analyze TON project tokenomics and write a report",
  "successCriteria": ["report file written", "summary sent to @user"],
  "failureConditions": ["3 consecutive tool errors"],
  "constraints": {
    "maxIterations": 100,
    "maxDurationHours": 4,
    "allowedTools": ["web_fetch", "exec_run", "telegram_send_message"],
    "restrictedTools": ["wallet:send"],
    "budgetTON": 0.5
  },
  "strategy": "balanced",
  "retryPolicy": {
    "maxRetries": 3,
    "backoff": "exponential"
  },
  "priority": "high"
}
```

---

## REST API

All endpoints are available under `/api/autonomous`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/autonomous` | List tasks (optional `?status=` filter) |
| `POST` | `/api/autonomous` | Create a new task |
| `GET` | `/api/autonomous/:id` | Get task details + logs |
| `GET` | `/api/autonomous/:id/logs` | Get execution logs |
| `POST` | `/api/autonomous/:id/pause` | Pause a running task |
| `POST` | `/api/autonomous/:id/resume` | Resume a paused task |
| `POST` | `/api/autonomous/:id/stop` | Cancel a task |
| `POST` | `/api/autonomous/:id/context` | Inject new context into a running task |
| `DELETE` | `/api/autonomous/:id` | Delete a task |
| `POST` | `/api/autonomous/checkpoints/clean` | Clean old checkpoints |

### Create task (example)

```sh
curl -X POST http://localhost:7778/api/autonomous \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Monitor DeDust pools",
    "priority": "high",
    "strategy": "balanced",
    "constraints": { "maxIterations": 50 }
  }'
```

---

## Safety Guardrails

Autonomous Mode is **disabled by default**. All tasks require explicit user creation.

| Guardrail | Default |
|-----------|---------|
| TON budget per task | 1 TON |
| TON daily budget | 5 TON |
| Require confirmation above | 0.5 TON |
| Tool call rate limit | 100 calls/hour |
| API call rate limit | 30 calls/minute |
| Loop detection | enabled (5 identical actions) |
| Max consecutive uncertainty | 3 reflections |

When a guardrail triggers, the task is **paused** and the user receives an escalation notification before any action is taken.

---

## Checkpoints & Recovery

A checkpoint is saved after every step. If the agent restarts mid-task:

1. On startup, the manager calls `restoreInterruptedTasks()`.
2. Tasks in `running` status are automatically resumed from their last checkpoint.
3. No actions from completed steps are repeated.

Checkpoints older than 7 days (for terminal tasks) are cleaned automatically, or manually with:

```sh
teleton autonomous clean
```

---

## Execution Logs

Every step is logged with event type, timestamp, and optional data payload:

| Event type | Description |
|------------|-------------|
| `plan` | LLM selected next action |
| `tool_call` | Tool invoked |
| `tool_result` | Tool response received |
| `reflect` | Self-reflection completed |
| `checkpoint` | State persisted |
| `escalate` | User escalation triggered |
| `error` | Error occurred |
| `info` | Informational message |

---

## Examples

- [`examples/autonomous/monitoring-dedust.json`](../examples/autonomous/monitoring-dedust.json) — Monitor DeDust pools
- [`examples/autonomous/analyze-project.json`](../examples/autonomous/analyze-project.json) — Analyze a TON project
- [`examples/autonomous/strategy-profiles.md`](../examples/autonomous/strategy-profiles.md) — Strategy comparison guide
