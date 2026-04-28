# Security Center

The Security Center is the audit and policy hub of the WebUI. It is the page that answers four questions: *who changed what?*, *which tool calls were allowed, denied, or escalated?*, *what is waiting for approval?*, and *what are the active rules?*.

![Audit trail](../assets/screenshots/en/audit-trail-security-page.png)

## Page layout

The page has four tabs at the top:

| Tab | Focus |
| --- | --- |
| **Audit Trail** | Hash-chained, append-only log of every important event. |
| **Validation Log** | Per-tool-call decisions: allow / deny / require_approval, with the matching policy. |
| **Approvals** | Operator queue for pending tool calls that require human approval. |
| **Settings** | Policies, secrets, session timeout, IP allowlist, WebUI rate limit. |

A status banner at the very top reports the chain verification result and the count of pending approvals.

## Audit trail

![Zero-trust security page](../assets/screenshots/en/zero-trust-security-page.png)

The audit trail is the canonical, hash-chained record. Each event has:

- **Timestamp** (UTC).
- **Actor** — operator account or `system`.
- **Action** — typed action: `agent_start`, `agent_stop`, `tool_toggle`, `tool_test`, `soul_edit`, `policy_change`, `plugin_install`, `secret_change`, `approval_grant`, `approval_deny`, `config_change`, etc.
- **Target** — tool name, file name, plugin id, etc.
- **Payload** — JSON snapshot of what changed.
- **Chain hash** — hash of the previous event plus this one's content.

Above the table:

- **Search** — text search inside actor, target, and payload.
- **Action filter** — multi-select (e.g. show only `policy_change` and `approval_grant`).
- **Date range** — restrict to a window.
- **Verify chain** — recomputes hashes from the beginning. A green badge means the chain is intact; red means a record was tampered with.
- **Export** — download the filtered range as JSON for offline review or attaching to incident reports.

Click any row to open the **chain view**: the row plus the previous and next events, so you can see the surrounding context.

> ⚠️ **Hash chain verification fails?** Stop the agent immediately, copy the latest backup, and contact the maintainer. A broken chain means somebody edited the SQLite file directly.

## Validation log

The Validation Log answers "why was this tool call allowed (or not)?". Each entry is a single tool-call decision and shows:

- **Tool name** and module.
- **Decision** — `allow`, `deny`, or `require_approval`.
- **Matched policy** — the rule that produced the decision (with a link to the rule editor).
- **Caller** — operator, autonomous task, remote agent.
- **Arguments** (truncated; click to expand).
- **Outcome** — what actually happened after the decision (executed, blocked, queued).

Use this tab right after changing a tool policy: trigger the tool from the [Tools](04-tools.md) test panel and read the matching log entry to confirm the new policy applied.

## Approval queue

![Zero-trust mobile view](../assets/screenshots/en/zero-trust-security-mobile.png)

When a policy returns `require_approval`, the tool call lands here. Each pending approval shows:

- **Tool** and module.
- **Caller** — who is requesting (operator, autonomous task, remote agent).
- **Arguments** — the exact parameters about to be passed in.
- **Reason** — the reason the policy demanded approval.
- **Created** — when the request entered the queue.
- **Expires** — the deadline; defaults vary by policy.

Approve only when you have verified:

1. The arguments match the user's intent.
2. The current risk tolerance allows it (e.g. the budget is not depleted).
3. The audit trail shows no recent unusual activity from the caller.

The mobile view trims columns but keeps the *Approve* / *Deny* buttons and the argument summary, so you can clear the queue from a phone during an incident.

## Settings

The Settings tab contains the rules and the access controls.

### Zero-trust policies

Policies match by **tool**, **module**, or **parameter pattern** and return one of:

| Action | Meaning |
| --- | --- |
| `allow` | The operation may continue. |
| `deny` | The operation is blocked. |
| `require_approval` | A human must approve before execution. |

The editor accepts a YAML-like rule set. Common patterns:

```yaml
- tool: ton_send
  action: require_approval
  reason: "Wallet transfer outside admin chat"
  unless:
    chat_type: admin

- module: exec
  action: deny
  reason: "Shell execution disabled"

- tool: workspace_delete
  action: require_approval
  reason: "Destructive workspace action"
```

> ℹ️ **Order matters.** Rules apply top to bottom, first match wins. Add narrow rules first, broad rules last.

Keep these tools behind explicit policies:

- Wallet operations (`ton_send`, `jetton_send`, `nft_transfer`).
- Workspace write and delete tools.
- `exec` and other shell-running tools.
- Anything that can mutate an external API (POST/PUT/DELETE).
- Account-control tools (block user, leave chat, change admin set).

### Secrets

Use the **Secrets** sub-section to add, rotate, and remove secrets:

- API keys for LLM providers, plugins and integrations.
- Telegram credentials.
- Webhook signing secrets.
- TON private keys (when used by tools).

> ⚠️ **Never** paste a secret into [Soul Editor](05-soul-editor.md), into a screenshot, or into an exported session. Secrets entered here are kept encrypted at rest and exposed only to the runtime.

### Access controls

- **Session timeout** — how long a WebUI session stays valid without activity. Default 30 minutes.
- **IP allowlist** — comma-separated CIDR list. Empty means localhost only.
- **WebUI rate limit** — request budget per minute per IP.
- **Token rotation** — rotate the WebUI auth token; the old one is invalidated immediately.

> ⚠️ **Keep the WebUI bound to localhost** unless you have a protected reverse proxy with TLS, strong auth, IP controls and monitoring. The Security Center cannot replace network-level protection.

## Incident checklist

When something looks wrong:

1. **Pause** the affected autonomous tasks from [Autonomous Mode](03-autonomous-mode.md).
2. **Verify the audit chain** (Audit Trail → Verify chain).
3. **Export** the relevant audit and validation rows for the incident report.
4. **Inspect the validation log** for the affected tool — match decisions against expected policy.
5. **Rotate** any potentially exposed secrets in Settings → Secrets.
6. **Tighten** tool scopes ([Tools](04-tools.md)) and policies (Settings → Policies) before resuming.
7. **Document** the timeline using session exports from [Sessions](07-sessions.md).
8. After resolution, **save a Soul Editor version** describing the policy change so the next operator finds it.
