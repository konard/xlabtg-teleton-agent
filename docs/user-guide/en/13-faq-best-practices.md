# FAQ and Best Practices

This page collects the questions operators ask most often and the habits we have seen pay off in production.

![Adaptive prompting](../assets/screenshots/en/adaptive-prompting-soul.png)

## FAQ

### Should I use user mode or bot mode?

Use **user mode** when you need full Telegram account access — dialogs, history, media, advanced features (joining groups by invite, reading channel history, sending stickers as the user). User mode is the only way to make the agent participate in DMs initiated by other users.

Use **bot mode** when you want lower account risk and simpler deployment. Bots have a clean permission model, can be added by anyone, and cannot read messages they are not addressed in. They are easier to scale across multiple chats.

You can run both at once via the [Agents](10-advanced-features.md#agents) page: a personal agent for power users, and a separate bot for public groups.

### Why is `telegram.admin_ids` required?

Autonomous actions must be attributable to a real administrator. Without admin IDs:

- The autonomous scheduler refuses to start.
- Heartbeat cannot deliver escalations.
- Approvals in [Security Center](08-security.md) have no recipient.
- Tools scoped to `admin-only` cannot be invoked.

The admin IDs are numeric Telegram user IDs (not usernames). Set them in [Configuration → Telegram](11-settings.md).

### Can I expose the WebUI to the internet?

**Do not expose it directly.** Keep the WebUI bound to `localhost` and reach it via SSH tunnel, VPN, or a hardened reverse proxy. If you must put it behind a public reverse proxy:

- **TLS** is required.
- Use **strong authentication** at the proxy layer (mTLS, Cloudflare Access, an OAuth proxy).
- Set the **IP allowlist** in [Security Center → Settings](08-security.md) to operator IPs only.
- Rotate the WebUI auth token regularly.
- Watch the audit trail and the rate-limit metrics.

The Security Center has rate-limiting and IP allowlists, but those are defence in depth — they do not replace network-level protection.

### How many tools should be enabled?

Enable only the tools the agent currently needs. The default install ships almost everything **disabled** for a reason. Use:

- **Tool RAG** ([Configuration → Tool RAG](11-settings.md)) to retrieve only the relevant tools per turn — the LLM stays focused and the prompt stays small.
- **Scope** ([Tools](04-tools.md)) to limit dangerous tools to `admin-only`.
- **Policies** ([Security Center](08-security.md)) to require approval on the riskiest tools.

### How do I control cost?

In order of impact:

1. Set a **token budget** in autonomous tasks; the loop halts at the boundary.
2. Use a **utility model** ([Configuration → LLM](11-settings.md)) for parsing, classification, summarisation; reserve the powerful model for the final answer.
3. Keep **cache** enabled and watch the hit rate on the [Dashboard](02-dashboard.md).
4. **Pause** looping autonomous tasks the moment Analytics flags them.
5. Lower **iteration limit** on autonomous tasks until you see a measurable success rate change.
6. Review **Cost by tool** in [Analytics](06-analytics.md) and disable tools that consistently overshoot.

### Where should I put long-term instructions?

| Need | Place |
| --- | --- |
| Behaviour, tone, refusals | [Soul Editor](05-soul-editor.md) (`SOUL.md`, `SECURITY.md`, `STRATEGY.md`). |
| Factual long-term context | [Memory](10-advanced-features.md#memory) — pin the fact. |
| Settings (provider, ports, keys) | [Configuration](11-settings.md). |
| Periodic checklist | `HEARTBEAT.md` plus [Configuration → Heartbeat](11-settings.md). |
| Hard policy ("must require approval to send TON") | [Security Center → Policies](08-security.md). |

**Do not** hide settings or secrets inside prompts; they belong in the structured surfaces above. Prompts are the soft layer; configuration and policies are the hard layer.

### What's the difference between a Workflow and a Pipeline?

A **Workflow** is a single trigger plus a chain of actions — typically a quick automation like "every morning at 9am, post the digest to Telegram". Workflows are linear.

A **Pipeline** is a DAG with typed steps, retries, branching, and per-step timeouts — better for repeatable research or reporting chains where steps depend on each other and can fan out.

Use Workflows for **one-shot triggers** and Pipelines for **complex orchestration**. Both live under [Advanced Features](10-advanced-features.md).

### My autonomous task escalated. Now what?

An `escalate` event in the autonomous log means the agent paused itself and is waiting for human approval. Open [Security Center → Approvals](08-security.md), read the requested arguments and reason, and decide:

- **Approve** if the operation is what you want and the policy was unnecessarily strict — consider relaxing the policy if it triggers often.
- **Deny** if the operation is wrong — the task ends in `failed`. Look at the prior `plan` event to understand the agent's intent, then refine the goal.

After resolution, save a [Soul Editor](05-soul-editor.md) version describing the lesson learned.

### How do I migrate to a new machine?

1. On the source machine, [Configuration → Backup](11-settings.md) → **Export**.
2. Install on the target machine (`npm install -g teleton@latest`, run `teleton setup --ui` and finish the wizard).
3. On the target, [Configuration → Backup](11-settings.md) → **Import** the file from step 1.
4. Re-create the Telegram session on the target (the export does not carry credentials).
5. Re-create plugin secrets in [Security Center → Secrets](08-security.md).
6. Run [Memory → Sync](10-advanced-features.md#memory) to push embeddings to the configured vector store.

## Best practices

### Security

- Use a **dedicated Telegram account** for personal-mode agents. Never connect your main account.
- Keep wallet tools (`ton_send`, `jetton_send`, `nft_transfer`) **approval-gated** in [Security Center](08-security.md).
- Keep `exec` **off** unless a specific operator workflow requires it.
- **Rotate secrets** after any accidental exposure (screenshot, paste into chat, repository commit). Use [Security Center → Secrets](08-security.md).
- **Review audit logs** after every production change. The cost is small; the value when something goes wrong is large.

### Operations

- **Start each day from the Dashboard.** Status, banners, then a glance at Tokens / Tools / Activity.
- **Review pending approvals** before resuming autonomous work.
- **Keep one focused dashboard** for daily use; build a separate one for diagnostics so the two do not get tangled.
- Use **Workflows** and **Pipelines** for repeatable procedures — write them once, get reliable execution forever.
- **Export configuration** before any major change. Imports are destructive.

### Prompt management

- **Save a version** before editing prompts. The version comment is your incident-response timeline.
- Use **A/B experiments** for tone changes. Promote only after a stable rating delta.
- Keep **security prompts concrete**. "Refuse seed phrases" is enforceable; "be careful with funds" is not.
- **Do not duplicate configuration** in prompts. If a behaviour is set in [Configuration](11-settings.md), the prompt should not contradict it.
- Treat `MEMORY.md` as **how to use** memory, not as memory itself.

### Memory

![Memory prioritization](../assets/screenshots/en/memory-prioritization.png)

- **Pin durable facts.** Pinned memories survive cleanup.
- **Clean stale memory periodically** from the Priority tab. Old memories age out by TTL anyway, but proactive cleanup keeps the index small.
- **Sync vectors** after changing the embedding model or the Upstash configuration.
- Use **Sessions** for recent conversational context and **Memory** for long-term knowledge.

### Autonomous tasks

- **Write measurable success criteria.** "Report when count > 3" beats "monitor pools".
- **Define failure conditions.** Without them the loop will retry forever inside its budget.
- **Restrict risky tools.** Only allow what the goal explicitly needs.
- **Pause instead of delete** when a task needs more context. The checkpoint is preserved.
- **Inspect checkpoints before restarting failed work.** Sometimes the failure is fixable by changing the policy, not the goal.

### Audit and incident response

![Audit trail](../assets/screenshots/en/audit-trail-security-page.png)

- After every change to a tool, policy, plugin, or secret, **verify the audit trail** records the change.
- Run **Verify chain** weekly. A broken hash chain is a serious incident.
- Keep **incident timelines** built from [Sessions](07-sessions.md) exports plus [Security Center](08-security.md) exports — they reconstruct what happened far better than memory.
