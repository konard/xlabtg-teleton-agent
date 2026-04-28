# Advanced Features

This chapter is the field guide for everything in the sidebar that is not covered by its own dedicated section: Agents, Plugins, Memory, Workspace, Tasks, Workflows, Pipelines, Events, MCP, Integrations, Network, Feedback, Self-Improve. Each section here is a compact reference for one page.

## Agents

The Agents page manages the primary agent and any **managed agents** — clones with their own personality, model, Telegram session and resource policy. Use it for multi-account operations or specialised personas.

The page is a table at the top and a creation form below.

| Column | Meaning |
| --- | --- |
| **Name** | Display name. |
| **Status** | `running`, `stopped`, `crashed`. |
| **Uptime** | Time since last restart. |
| **Provider / model** | Active LLM combo. |
| **Mode** | `bot` or `personal`. |
| **Actions** | Start / Stop / Restart / Logs / Edit / Clone / Delete. |

The creation form has 30+ fields grouped into:

- **Identity** — name, archetype (research / support / trader / custom), avatar.
- **Transport** — `personal` (API ID + API hash + phone) or `bot` (token + username); the form validates the bot token in place and shows a green tick when it matches a real bot.
- **Resource policy** — token budget per day, concurrent task limit, rate limit per chat.
- **Messaging policy** — DM policy, group policy, mention requirement, allowlist.
- **Memory policy** — fresh vector store or shared with the primary agent.
- **Crash recovery** — auto-restart, max restarts per hour, escalation chat.

![Bot token validation](../assets/screenshots/en/agents-bot-token-validation.png)

For a personal agent, the form opens an authentication panel after you save:

![Personal authentication panel](../assets/screenshots/en/agents-personal-auth-panel.png)
![Personal authentication via QR](../assets/screenshots/en/agents-personal-auth-qr-panel.png)

The same QR or phone-code flow as the setup wizard. Clone an existing agent to inherit its prompts, hooks, and tool scopes.

## Plugins

The Plugins page is split into two tabs:

- **Installed** — plugins active on this agent. Each row shows the plugin name, version, source badge (`official` / `community` / `custom`), author with verified-author badge from GitHub, and the count of tools the plugin contributes.
- **Marketplace** — searchable catalogue of plugins from the registry.

Click a plugin to open the detail modal with three tabs:

- **Overview** — description, requested permissions, supported actions, source URL.
- **Tools** — every tool the plugin registers (also visible on the [Tools](04-tools.md) page).
- **Secrets** — secrets the plugin requires; set them under [Security Center → Secrets](08-security.md).

> ⚠️ **Before installing.** Read **Overview → requested_permissions**. A plugin that asks for `wallet:transfer` or `exec:run` should be installed only if you trust the author. Verified authors carry a green check; unverified ones a yellow circle.

## Memory

The Memory page manages everything the agent retains across sessions. Three tabs:

| Tab | Use |
| --- | --- |
| **Sources** | Files and notes that have been indexed. Expand a source to see its chunks, embeddings status, and priority score. |
| **Graph** | Knowledge-graph visualisation of relationships between entities. Use it for discovery: "what do we know that connects X and Y?" |
| **Priority** | Cleanup view ranked by recency × access. Pin high-value memories; prune the bottom of the list. |

Top of the page:

- **Sync** — pushes embeddings to the configured vector store ([Configuration → Vector Memory](11-settings.md)) and reports the new index size and status.
- **Add source** — upload a file or paste a URL.
- **Search** — semantic search across all sources; the result rows link to the originating source.

![Memory graph](../assets/screenshots/en/memory-graph.png)
![Memory prioritization](../assets/screenshots/en/memory-prioritization.png)
![Vector memory sync status](../assets/screenshots/en/memory-sync-vector.png)

> ℹ️ **Pin durable facts; prune ephemeral ones.** Pinned memories survive cleanup. Unpinned memories age out using the configured TTL.

## Workspace

The Workspace page is a file browser for the sandboxed directory the agent has read/write access to. Use it for:

- Reports the agent generates ("dedust-pools-2025-04-28.md").
- Task artifacts (downloaded JSON, screenshots).
- Safe manual edits to files the agent reads.

The layout is a familiar two-pane browser:

- **Tree** on the left, with breadcrumbs at the top.
- **Editor** on the right with syntax highlighting (CodeMirror) for text files, image preview for images, and a *binary file* indicator for everything else.
- **File operations** — New file, New folder, Rename, Delete, Download.
- **Stats panel** — total files, total size, last modified.

> ⚠️ **Do not store secrets in the workspace.** Anything here is reachable by tools. Secrets belong in [Security Center → Secrets](08-security.md).

## Tasks

The Tasks page is the queue and execution monitor for short-lived agent tasks (as opposed to autonomous goals on the [Autonomous](03-autonomous-mode.md) page). The table columns:

| Column | Meaning |
| --- | --- |
| **ID** | Task identifier. |
| **Title** | Operator-assigned or auto-generated. |
| **Status** | `pending` (yellow), `running` (cyan), `done` (green), `failed` (red), `cancelled` (gray). |
| **Priority** | 1–10, visualised as dots. |
| **Created / Started / Completed** | Timestamps. |

Click a task to open the detail panel: tool calls in order, corrections that ran, feedback scores, full result body, and any error trace.

![Task delegation context](../assets/screenshots/en/task-delegation-ui.png)

Use Tasks to:

- Inspect why an agent reply took unusually long.
- Find a specific tool call after-the-fact (filter by status `failed` for forensics).
- Cancel a stuck task before it eats budget.

## Workflows

The Workflows page is the cron/event/webhook automation surface. The table:

| Column | Meaning |
| --- | --- |
| **Name** | Operator-supplied. |
| **Status** | `enabled`, `disabled`, `error`. |
| **Trigger** | Cron expression, event name, or webhook URL. |
| **Last run** | Timestamp + status. |
| **Next run** | For cron-triggered workflows. |

The editor dialog has three sections:

- **Trigger editor** — pick `Cron`, `Webhook`, or `Event`. For cron, enter the expression; the dialog parses it and shows the next 3 firings. For webhook, the dialog generates the inbound URL and a signing secret.
- **Actions editor** — chain one or more actions: `send_message` (Telegram), `call_api` (HTTP), `set_variable` (workflow-scoped variable). Actions can reference variables from previous steps.
- **Test trigger** — fire the workflow manually with synthetic input.

The **Run history** view lists every execution with status, duration, error, and a link to the [Events](#events) entry it produced.

> ℹ️ **Workflow `call_api` actions** have a hard timeout (default 10s, configurable) so a stuck endpoint cannot block the queue.

## Pipelines

![Pipelines page](../assets/screenshots/en/pipelines-page.png)

Pipelines are DAG-based, multi-step orchestrations — best for repeatable research or reporting chains.

The page shows the pipeline list at the top and the **DAG editor** below:

- **Nodes** — task, tool, script, or delegated-agent node.
- **Edges** — connect outputs of one node to inputs of the next; supports branching and conditional execution.
- **Per-step settings** — timeout, retry count, retry backoff, on-failure action.
- **Run history** — last 50 runs with start time, duration, status, and per-node metrics.

Pipelines are stricter than Workflows: every step has typed inputs, the run timeout bounds the *whole* run (already-running steps are interrupted on timeout), and delegated-agent steps wait for the actual result instead of completing on dispatch.

## Events

The Events page is the unified log of every internal event plus the webhook management.

**Event log** — chronological list with type filter, payload preview, and timestamp. Click a row to expand the full payload. Common event types: `message_received`, `message_replied`, `tool_call`, `tool_result`, `task_started`, `task_completed`, `policy_decision`, `webhook_delivered`, `agent_restart`.

**Webhooks** — register outbound webhooks:

- **URL** — destination.
- **Events** — which event types to deliver.
- **Secret** — used for HMAC signing.
- **Retries** — count and backoff strategy.

Each registered webhook has a **delivery history** with status colors: `delivered` (green), `failed` (red), `retrying` (yellow).

![Events and webhooks](../assets/diagrams/webhooks-event-bus.svg)

> ⚠️ **Use signed secrets for inbound webhooks.** Workflow webhooks ingest external POSTs; verify the signature before trusting the payload.

## MCP

The MCP page connects external **Model Context Protocol** servers — language- or tool-providers exposed to the agent. Each MCP server has:

- **Name** and **description**.
- **Transport** — `stdio` (spawn local process), `sse`, or `streamable_http`.
- **Package / URL** — npm package, command path, or HTTP endpoint.
- **Args** — command-line arguments.
- **Env** — environment variables (use [Security Center → Secrets](08-security.md) for sensitive values).
- **Status** — `connected`, `error`, with last error message.
- **Capabilities** — tools the server offers, with the same enable/scope toggles as built-in tools.

The **Add server** form validates the connection in place. Remove a server with the trash icon — its tools disappear from the catalogue.

## Integrations

![Integrations page](../assets/screenshots/en/integrations-page.png)

The Integrations page manages connections to external services. Two top-level views:

- **Catalogue** — pre-built templates (GitHub, Notion, Slack, OpenWeather, custom HTTP, etc.).
- **Installed** — active integrations with status pills.

Each integration supports several auth types:

- **API Key** — header or query parameter.
- **OAuth2** — full code/token exchange flow.
- **JWT** — signed claims.
- **Basic** — username/password.
- **Custom Headers** — anything else.
- **None** — open APIs.

Per-integration settings include rate limit, per-route timeout, and a **Health check** button that calls a known-safe endpoint to confirm credentials.

## Network

![Agent network page](../assets/screenshots/en/agent-network-page.png)
![Multi-agent network](../assets/diagrams/multi-agent-network.svg)
![Task delegation context](../assets/screenshots/en/task-delegation-ui.png)

The Network page handles multi-agent operations.

**Stats band** — active agents count, queue depth, average ingress latency, uptime.

**Remote agents** table:

| Column | Meaning |
| --- | --- |
| **Name** | Operator-set. |
| **Status** | `online`, `offline`, `degraded`. |
| **Trust** | `untrusted`, `delegate`, `peer`, `admin`. |
| **Capabilities** | Tools the remote exposes. |
| **Last seen** | Timestamp. |

**Message queue** — inbound messages waiting to be dispatched, plus the audit log of recent network exchanges.

**Add / Edit / Remove** controls let you register a new remote, change trust level, or revoke a peer.

> ⚠️ **Ingress is gated.** The agent rejects inbound messages whose recipient does not match the local agent identity, replays previously-signed messages, or come from unallowlisted senders. Capabilities and trust level should drive delegation decisions; never delegate to `untrusted`.

## Feedback

![Feedback learning dashboard](../assets/screenshots/en/feedback-learning-dashboard.png)

The Feedback page is the operator-side of feedback collection.

**Dashboard band** — total feedback count, average rating, positive/negative ratio, timeline chart over the selected period.

**Preference profile** — what the system learned about the user(s) the operator works with: communication style (formal / friendly / concise), tone preferences, detail level. Profiles are inputs to [Soul Editor → Adaptive prompting](05-soul-editor.md).

**Feedback list** — each entry shows the rating, free-text comment, sentiment classification, the message that triggered it, and the timestamp.

Use Feedback in tandem with [Analytics → Anomaly](06-analytics.md) and the experiments view in [Soul Editor](05-soul-editor.md): a sustained drop in average rating over a feature change is the signal to roll back the change.

## Self-Improve

The Self-Improve page is the agent's code-quality and process improvement loop. It analyses:

- The agent's own repository (commits, code quality, test coverage).
- Documentation freshness.
- Installed plugins (versioning, security advisories).
- Recent task patterns (recurring failures, slow tools).

Each finding has a **severity badge** (`critical`, `high`, `medium`, `low`) and a structured detail block: file paths, line numbers, suggested fix, blast radius.

Settings allow you to:

- Pick the **target repository** (the agent's, or a separate project).
- Define the **scan scope** (paths, file types).
- Configure **automation**: how often to scan, which finding types are eligible for an auto-generated improvement task on the [Tasks](#tasks) page, and which patterns are allowed to be auto-fixed.

> ⚠️ **Keep automation conservative.** Auto-generated tasks should produce a pull request, never a direct merge. Review every diff before it ships.

## Cross-page playbook

When you make a change to one of these pages, check its sibling pages:

| If you change… | Also check… |
| --- | --- |
| **Agents** (new managed agent) | **Tools** scopes, **Hooks** routing, **Memory** policy. |
| **Plugins** (install new) | **Tools** (newly registered tools), **Security Center → Secrets**, **Audit Trail** for `plugin_install`. |
| **MCP** (new server) | **Tools** (server capabilities), **Configuration → MCP** for enablement. |
| **Workflows / Pipelines** | **Events** for new event types, **Integrations** for the destinations. |
| **Network** (new remote) | **Tools** delegation matrix, **Security Center → Policies** for cross-agent rules. |
| **Self-Improve** | **Tasks** queue for any auto-generated tasks, **Audit Trail** for new tool calls. |
