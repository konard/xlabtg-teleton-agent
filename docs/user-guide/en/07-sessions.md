# Sessions

The Sessions page is the searchable archive of every chat the agent has touched. It is the page you open when a user asks why the agent answered a certain way, when an audit needs evidence, or when you are investigating an incident in a specific chat.

![Self-correction monitoring](../assets/screenshots/en/self-correction-monitoring.png)

## Page layout

The page is split horizontally:

- **Left column — session list.** Each row carries the chat title (or first name + last name for DMs), a chat-type badge (`dm`, `group`, `channel`, `bot`), the last message preview, and the time of the last activity. A search box at the top filters by chat title, username, or message content; a chat-type dropdown narrows the list further.
- **Right column — session detail.** Empty until a session is selected. Shows the metadata header, the full message list, and the corrections panel.

## Session list

Each row in the list summarises:

| Field | Description |
| --- | --- |
| **Chat title** | Group title, channel name, or contact name. |
| **Chat type** | `dm` (direct), `group`, `channel`, or `bot`. |
| **Last message** | Preview of the last message, truncated. |
| **Last activity** | Locale-formatted timestamp. |
| **Provider / model** | The model that handled the most recent reply. |

The search box matches on chat title, Telegram username, and message content. Wrap a phrase in quotes to search exact text. The chat-type dropdown lets you scope a search ("`buy`" inside DMs only).

## Inspecting a session

Open a session by clicking a row. The detail pane shows:

- **Header** — chat ID, title, username, chat type, provider, model, message count, total input tokens, total output tokens, start and last-update timestamps.
- **Messages** — a chronological list. Each message is tagged with the source (`user`, `agent`, `system`, `tool`), shows whether media was attached, whether the message was edited, the timestamp, reply relationships, and the model that produced it (for agent messages).
- **Tool calls** — inline boxes inside agent messages show the tool name, the arguments, and the abbreviated result.
- **Corrections** — when the self-correction loop ran, the message includes a small *corrected* badge; expand to see original vs. corrected output.

Use the message-level **Copy** action to lift a single message out of the conversation; use the session-level **Export** action to download the full conversation as Markdown or JSON.

## Restoring context

When a user asks "why did the agent reply X?":

1. Search by username or chat title.
2. Open the session and scroll to the message in question.
3. Read the **previous user message** — that is the prompt the agent acted on.
4. Expand any **tool calls** between the user message and the agent reply — those are the facts the agent based its answer on.
5. If a correction occurred, read the **original output** and the **reflection** to see why the loop preferred the correction.

Only after this trail does it make sense to consider a prompt change in [Soul Editor](05-soul-editor.md) or a policy change in [Security Center](08-security.md).

## Self-corrections

![Feedback learning context](../assets/screenshots/en/feedback-learning-dashboard.png)

A *correction* is a record produced when the self-correcting loop replaced an output. Each correction shows:

- **Original output** — what the agent first generated.
- **Evaluation score** — how the loop graded the original.
- **Reflection** — the natural-language explanation of why a rewrite was needed.
- **Corrected output** — what the user actually saw.
- **Escalation state** — whether human approval was triggered (links to [Security Center](08-security.md)).
- **Tool recovery guidance** — when a failed tool call was bypassed.

Patterns to watch:

- Frequent corrections in one chat type usually mean a tone or context mismatch — fix in [Soul Editor](05-soul-editor.md).
- Corrections clustered around a single tool mean the tool itself is unstable — open [Tools](04-tools.md) and check the failure rate.
- Repeated escalations on the same goal mean a policy is too strict or a goal is poorly bounded — review [Autonomous Mode](03-autonomous-mode.md).

## Inline feedback

Each agent message has small thumbs-up / thumbs-down icons. Operators can rate replies inline. Ratings flow into [Feedback](10-advanced-features.md#feedback) and the [Analytics](06-analytics.md) feedback view.

> ℹ️ **Note** — Inline feedback is operator-side only. End users do not see the icons; they remain in the WebUI.

## Exporting a session

Use **Export** in the detail header to download:

- **Markdown** — human-readable conversation transcript.
- **JSON** — full structured payload, including tool calls, model identifiers, and timestamps.

> ⚠️ **Treat exports as sensitive** — they contain message text, Telegram usernames, media metadata, and operator decisions. Never paste them into public issue trackers; share via the same channels you use for credentials.

## Good practices

- **Filter by chat type** before a broad review — DMs and groups have different signal-to-noise ratios.
- **Use user wording, not internal labels** — search the way the user typed, not the way the agent classified.
- **Export only the sessions you need** for an investigation; resist the urge to dump everything.
- **Do not paste exports into public issue trackers**, GitHub PRs, or Slack channels visible to non-operators.
- When a session reveals a **policy gap**, update [Security Center](08-security.md) first (hard rule) and [Soul Editor](05-soul-editor.md) second (soft rule).
