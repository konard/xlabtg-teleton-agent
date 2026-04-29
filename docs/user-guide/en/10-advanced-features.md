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

The Network page handles multi-agent operations across deployments. Your local agent is **always present** on this page — it appears in the Topology with a "This Agent" card that lists its id, name, public endpoint, capabilities, and key state. The stats counters include the local agent so an isolated installation shows `Agents: 1`, `Available: 1`, `Trusted: 1` rather than zeros.

**Stats band** — active agents count, available count, trusted count, average load, messages and errors in the last hour. The local agent is counted in the totals.

**This Agent** card — appears at the top of the page and reflects the values from the `network` block of `~/.teleton/config.yaml`:

- **Agent ID** / **Name** — what peers see when this agent advertises itself.
- **Endpoint** — public HTTPS URL ending in `/api/agent-network` that peers POST signed messages to.
- **Discovery mode** — `central`, `peer-to-peer`, or `dns`.
- **Signing key** — whether a public key is advertised and whether the private key is loaded for outbound signing.
- **Status** — `available` while the agent lifecycle is `running`, otherwise `degraded`.

If `network.enabled` is `false`, the card shows the disabled banner and remote ingress (`POST /api/agent-network`) returns `403`.

**Remote agents** table:

| Column | Meaning |
| --- | --- |
| **Name** | Operator-set. |
| **Status** | `available`, `busy`, `offline`, `degraded`. |
| **Trust** | `trusted`, `verified`, `untrusted`. |
| **Capabilities** | Tools the remote exposes. |
| **Last seen** | Timestamp. |

**Message queue** — inbound messages waiting to be dispatched, plus the audit log of recent network exchanges.

**Add / Edit / Remove** controls let you register a new remote, change trust level, or revoke a peer.

### Why the page can show zero remote agents

Remote agents do **not** auto-discover each other yet. The local agent is always shown as "This Agent", but other agents only appear in the *Remote agents* table after one of:

- An operator registers them through `Register Agent` on this page (or `POST /api/network/agents`).
- They send a signed `heartbeat` to your `/api/agent-network` endpoint after **you have already registered them** with their public key (unsigned heartbeats from unknown peers are rejected).
- A central registry (when `discovery_mode: central` is implemented for your deployment) returns them at startup.

A fresh install therefore shows the local agent plus an empty remote-agents table. Use the steps below to add a peer.

### Detailed instructions: connect another agent deployed on another server

Both deployments must run Teleton with the network feature enabled. The protocol uses Ed25519 signatures over JSON sent to `POST /api/agent-network`. The same procedure works whether the remote agent belongs to you or to another user.

**1. Enable the network on each agent.** On every deployment that should join the network, edit `~/.teleton/config.yaml`:

```yaml
network:
  enabled: true
  agent_id: "primary"                                    # Globally unique identifier
  agent_name: "Primary Agent"                            # Human-readable name
  endpoint: "https://agent.example.com/api/agent-network" # Public HTTPS URL
  discovery_mode: "central"
  public_key: |                                          # PEM Ed25519 public key (advertised)
    -----BEGIN PUBLIC KEY-----
    ...
    -----END PUBLIC KEY-----
  private_key: |                                         # PEM Ed25519 private key (signs outbound)
    -----BEGIN PRIVATE KEY-----
    ...
    -----END PRIVATE KEY-----
  default_trust_level: "untrusted"                       # Newly-added peers start untrusted
  allowlist: []                                          # Optional: restrict accepted senders
  blocklist: []                                          # Optional: explicit blocks
  message_timeout_ms: 15000
  max_clock_skew_seconds: 300
```

The `endpoint` must be reachable from the public internet for peers to connect. Use a domain plus a TLS-terminating reverse proxy (Caddy, Nginx, Traefik) in front of the WebUI port. HTTP endpoints are only accepted for `localhost` and `127.0.0.1` testing.

**2. Generate the Ed25519 key pair** (each agent needs its own pair). Use Node from the agent's host:

```bash
node -e "const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('ed25519');\
console.log(publicKey.export({format:'pem',type:'spki'}).toString());\
console.log(privateKey.export({format:'pem',type:'pkcs8'}).toString())"
```

Paste the public-key block into `network.public_key` and the private-key block into `network.private_key`. The private key only ever lives on the host that owns the identity. Restart Teleton so the new keys load.

**3. Exchange identities with the other operator.** Both sides need the other's:

- `agent_id`
- `agent_name`
- public `endpoint` (the full `https://.../api/agent-network` URL)
- `public_key` (PEM SPKI, starting with `-----BEGIN PUBLIC KEY-----`)

Treat this exchange as you would an SSH `authorized_keys` swap — copy by a channel you trust.

**4. Register the remote agent on each side.** Open the Network page and fill **Register Agent**:

- **Agent ID** — exactly what the remote uses as `network.agent_id`.
- **Name** — human-readable label.
- **Endpoint** — full HTTPS URL ending in `/api/agent-network`.
- **Capabilities** — comma-separated list (e.g. `web-search, summarization`).
- **Status** — start with `available`.
- **Load** — start at `0`.
- **Trust** — keep at `untrusted` until you have verified inbound traffic.
- **Public Key** — paste the PEM block you received.

Equivalent REST call (from the operator's machine, with the WebUI auth token):

```bash
curl -X POST https://my-agent.example.com/api/network/agents \
  -H "Authorization: Bearer $TELETON_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-002",
    "name": "Research Remote",
    "endpoint": "https://research.example.com/api/agent-network",
    "capabilities": ["web-search", "summarization"],
    "status": "available",
    "load": 0,
    "trustLevel": "untrusted",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  }'
```

The other operator runs the same call against their server with **your** identity, so both sides know about each other.

**5. Verify the link with a signed heartbeat.** From the remote, send a `heartbeat` to your endpoint to populate the message log and confirm signatures verify:

```bash
# On the remote agent's host (uses its own private key to sign)
curl -X POST https://my-agent.example.com/api/agent-network \
  -H "Content-Type: application/json" \
  -d "$(node ./scripts/sign-heartbeat.js)"  # See the docs/agent-network.md sample
```

A successful heartbeat returns `200`. The Network page shows the remote with a fresh `Last seen`, and the `Message Log` records a `heartbeat` row with `status: received`.

**6. Promote trust once you are satisfied.** In the **Remote Agents** card, change the trust dropdown from `untrusted` to `verified` (signature check only) or `trusted` (full delegation rights). Untrusted peers cannot receive delegated tasks even if you select them in the Task Delegation form.

**7. Delegate a task.** In **Task Delegation**, choose the remote, fill **Description**, optionally list **Required Capabilities** (the coordinator only picks peers that advertise them), paste a JSON **Payload**, and click **Send Task**. The signed `task_request` is recorded in the Message Log; the remote's autonomous task manager (or manual inbox if it has none) picks it up.

**Allowlist / blocklist.** When you want to lock the network down, list the explicit peer ids you accept under `network.allowlist`, or block specific ids under `network.blocklist`. Inbound messages from peers outside the allowlist (or inside the blocklist) are rejected before signature verification.

> ⚠️ **Ingress is gated.** The agent rejects inbound messages whose recipient does not match the local agent identity, replays of previously-signed messages, messages from blocklisted or non-allowlisted senders, and messages with timestamps outside `max_clock_skew_seconds`. Capabilities and trust level drive delegation decisions; never delegate to `untrusted`.

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
