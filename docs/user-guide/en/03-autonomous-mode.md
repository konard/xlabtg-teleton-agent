# Autonomous Mode

Autonomous Mode is the page where Teleton Agent runs long-lived goals on its own. The agent loops through *plan → act → observe → reflect → checkpoint*, persists state to disk so it can resume after a restart, and surfaces every step to the operator. It is **disabled by default** and should only be enabled after the policies in [Configuration](11-settings.md) and the admin IDs are set.

![Autonomous task list](../assets/screenshots/en/autonomous-page-initial.png)

## Page layout

| Region | What it contains |
| --- | --- |
| **Header banner** | Toggle that enables / disables autonomous execution globally; shows the global concurrency limit. |
| **+ New task** | Opens the task creator with both the natural-language box and the structured form. |
| **Task table** | Columns: ID, Status, Goal, Progress bar, Priority, Strategy, Created, Last update, Actions (Start / Pause / Cancel / Delete). |
| **Detail panel** | Opens on row click; tabs for *Goal & constraints*, *Live log*, *Checkpoints*, *Result*, *Errors*. |
| **Filters** | Status (any / pending / running / paused / completed / failed / cancelled), strategy, search by ID or goal substring. |

## Task lifecycle

![Autonomous task state machine](../assets/diagrams/autonomous-state-machine.svg)

States and transitions:

| State | Meaning | Allowed transitions |
| --- | --- | --- |
| `pending` | Task created, not yet picked up by the scheduler. | → `queued`, → `cancelled` |
| `queued` | Waiting for a free runner slot. | → `running`, → `cancelled` |
| `running` | Plan/act/observe loop is active. | → `paused`, → `completed`, → `failed`, → `cancelled` |
| `paused` | Operator suspended; checkpoint preserved. | → `running`, → `cancelled` |
| `completed` | Goal achieved; success criteria satisfied. | terminal |
| `failed` | Failure condition triggered or budget exceeded. | terminal |
| `cancelled` | Operator stopped the task. | terminal |

A `running` task writes a `checkpoint` event roughly every iteration. After agent restart, queued and running tasks resume from the last checkpoint without operator action.

## Creating a task with the AI parser

![Autonomous task form](../assets/screenshots/en/autonomous-create-form.png)
![Natural-language parser — success](../assets/screenshots/en/nl-parser-success.png)

1. Click **+ New task**.
2. In the upper text area, write the goal in plain English. Mention the trigger ("every 5 minutes", "when X happens"), the action, the destination (chat, channel, file), and the success / failure criteria.
3. Click **Parse with AI**. The right pane fills the structured fields; a **confidence** badge appears in the top right.
4. Compare the structured fields with the original prompt:
   - **Goal** — one sentence, action-oriented.
   - **Success criteria** — one item per line; each must be measurable.
   - **Failure conditions** — when the loop must stop instead of retrying.
   - **Allowed tools / Restricted tools** — explicit allow- and deny-lists.
   - **Strategy** — `conservative`, `balanced`, or `aggressive`. Conservative uses fewer iterations and refuses ambiguous tool calls.
   - **Priority** — 1 (low) to 10 (high). Higher numbers preempt lower ones in the queue.
   - **Iteration limit** — hard cap on plan loops.
   - **Duration limit** — wall-clock cap.
   - **Budget** — token spend cap and TON spend cap.
5. Edit anything that does not match your intent. **Always check restricted tools** before saving.
6. Click **💾 Save & Start** (or **Save** to keep it in `pending`).

If the confidence is below 70% the parser shows a warning banner. Re-write the prompt or fill the fields manually; do not save a low-confidence task.

![Task creation flow](../assets/diagrams/task-creation-flow.svg)

## Creating a task manually

Open **+ New task** and use only the structured form when you need precise guardrails:

- One success criterion per line.
- One failure condition per line.
- Put high-risk tools (`ton_send`, `jetton_send`, `exec_run`, `workspace_delete`) into **restricted tools** unless the task explicitly needs them.
- For wallet or account work choose `conservative` and set a small TON budget.

## Monitoring a running task

![Autonomous detail panel](../assets/screenshots/en/autonomous-detail-panel.png)

Open any row in the table to see the detail panel. The **Live log** lists structured events as they happen:

| Event | Meaning |
| --- | --- |
| `plan` | The agent chose the next action and reasoned about it. |
| `tool_call` | A tool was invoked with the listed arguments. |
| `tool_result` | The tool returned a value, an error, or a denial. |
| `reflect` | The agent evaluated progress against success criteria. |
| `checkpoint` | Recovery state was saved to disk. |
| `escalate` | Human approval is required (see [Security Center](08-security.md)). |
| `info` | Free-form annotation: parser hint, scheduling note. |
| `error` | A step failed. The task may retry or stop, depending on strategy. |

Each event has a timestamp, an iteration index, and an expand arrow with the full payload. Long arguments and results are truncated; click the row to read the full body.

## Pause, resume, cancel

| Action | When to use |
| --- | --- |
| **Pause** | The task needs more context, a policy change, or extra approvals. Resumes from the last checkpoint. |
| **Resume** | After a pause, when the change is in place. The next iteration starts from the persisted plan state. |
| **Cancel** | Goal is no longer needed or the task drifted. Cancelled tasks are terminal — recreate rather than try to revive. |
| **Delete** | Removes the task and its log from the table. Audit events stay in [Security Center](08-security.md). |

## Safety rules

- Keep `telegram.admin_ids` populated. Empty admin lists block escalations and prevent autonomous mode from starting.
- Prefer the **`conservative`** strategy for any wallet, account or `exec` work.
- Set an explicit **TON budget** for tasks that can move funds. The agent halts at the budget boundary rather than asking for more.
- Restrict tools that can move funds, write files, or contact external services unless the goal explicitly requires them.
- Review **Security Center → Approvals** before resuming a task that escalated.
- After a task completes, read the **Result** tab — it shows the final reasoning, evidence collected, and remaining open items.

## Recommended patterns

- **Periodic monitoring** — short success criterion ("report when count > N"), conservative strategy, low priority, 24-hour duration.
- **One-shot research** — balanced strategy, small iteration limit, no Telegram send tool, write the report to the workspace and have a separate task notify the chat.
- **Wallet operations** — conservative strategy, restricted to a single wallet tool, small budget, escalate on first failure.
