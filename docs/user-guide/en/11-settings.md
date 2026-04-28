# Settings (Configuration)

The Configuration page is the durable settings panel: it persists every choice into `config.yaml` and surfaces the same options as a graphical editor. The page is organised as a series of tabs, one per concern.

![Vector memory configuration](../assets/screenshots/en/vector-memory-config.png)

## Page layout

A header band shows the active configuration file path and a *server vs local* indicator — when your edits diverge from what is on disk, the **Save** button highlights and a comparison panel opens.

Below the header is the tab strip. Each tab is independent; switching tabs preserves edits in the current tab as a draft.

## All tabs

| # | Tab | What it controls |
| --- | --- | --- |
| 1 | **LLM** | Provider, model, utility model, API key, base URL, temperature, max tokens, retry behaviour. |
| 2 | **Telegram** | API ID and hash, phone, bot token, agent username, DM policy, group policy, mention requirement, admin IDs. |
| 3 | **Commands** | Custom command bindings, allowed users, allowed chats. |
| 4 | **Heartbeat** | Enable, interval (minutes), prompt source, **Test** button to fire one heartbeat now. |
| 5 | **API Keys** | Agent API key, Telegram bot token, Tavily key, TON keys, Toncenter key. |
| 6 | **TON Proxy** | `.ton` browsing proxy address and port; status indicator. |
| 7 | **Vector Memory** | Provider (local / Upstash), embedding model, namespace, dimension, sync behaviour. |
| 8 | **MTProto** | Telegram MTProto proxy: secret, host, port, fake-TLS toggle, status pill. |
| 9 | **YOLO** | Execution mode toggles (skip prompts, run unattended). Off by default. |
| 10 | **Advanced** | WebUI port, log requests (dev), deals enabled, deals expiry, deals floor thresholds, hot reload, alternate runtime home. |
| 11 | **Sessions** | Daily reset, idle expiry, soft cap on concurrent sessions. |
| 12 | **Tool RAG** | Tool discovery: how many tools to retrieve per turn, embedding model, threshold. |
| 13 | **Backup** | Export the entire configuration to JSON; import from a JSON snapshot. |

The 13 tabs are visible in this order in the [actual page](https://github.com/xlabtg/teleton-agent/blob/main/web/src/pages/Config.tsx). Each tab edits its slice of `config.yaml` plus secrets where relevant.

## LLM

The LLM tab gates provider changes. When the target provider requires an API key:

1. Pick the provider from the dropdown. The form re-renders with provider-specific fields.
2. Paste the API key. The **Validate** button calls the provider's whoami / models endpoint.
3. Once validation succeeds, **Save** is enabled.

For keyless providers (Claude Code, Cocoon, local OpenAI-compatible), the form skips the validation step.

The **Utility model** is a smaller, cheaper model used for tasks like the natural-language parser in [Autonomous Mode](03-autonomous-mode.md), classification, and summarisation. Choosing a fast utility model often improves perceived latency without changing answer quality.

## Telegram

![Bot token validation](../assets/screenshots/en/agents-bot-token-validation.png)

Recommended production defaults:

- `dm_policy: admin-only` or `allowlist`.
- `group_policy: allowlist` unless public group operation is the explicit goal.
- `require_mention: true` for groups.
- Non-empty `admin_ids` (numeric Telegram user IDs).

The bot token field validates in place: paste a token and a green check appears once `getMe` succeeds.

## MTProto

![MTProto proxy status](../assets/screenshots/en/mtproto-proxy-status.png)

If your network blocks the Telegram CDN, configure the MTProto proxy here:

- **Secret** — supports both raw secrets and the `dd…` / `ee…` prefixed fake-TLS forms.
- **Host** and **Port**.
- **Fake-TLS** toggle.
- **Status** pill — green when the proxy validates against a saved session.

The page falls over to the saved session when validation through the proxy fails — the agent stays connected even if the proxy's health endpoint times out. Auth and proxy health are surfaced separately so you can tell network problems from auth problems.

## Vector Memory

Vector memory can run locally (default) or through Upstash Vector. Two checks before saving:

1. **Index dimension matches the embedding model.** The embedding model determines the dimension; mismatching them returns 4xx errors at sync time.
2. **Namespace** is set if you share the index with other agents. Each agent reads / writes inside its namespace only.

After changing vector settings, open [Memory](10-advanced-features.md#memory) and run **Sync** to push embeddings to the new index.

## Heartbeat

Heartbeat runs the agent's `HEARTBEAT.md` checklist on a fixed interval. Configure:

- **Enable** toggle.
- **Interval** in minutes.
- **Prompt source** — `HEARTBEAT.md` (default) or a custom prompt file.
- **Test** button — fire one heartbeat immediately and stream the result into the page.

> ℹ️ **Pair heartbeat with [Autonomous Mode](03-autonomous-mode.md).** Heartbeat is good for periodic checks (queue depth, alerts), Autonomous Mode is good for goal-driven work.

## TON Proxy

The `.ton` browsing proxy lets the agent fetch resources from `.ton` domains. Configure:

- **Address** and **port**.
- **Status** pill — green when reachable.

Used by web research tools when a request returns a `.ton` URL.

## Backup (Export and Import)

The Backup tab snapshots:

- The full configuration (`config.yaml` shape).
- Hooks definitions ([Hooks](09-hooks.md)).
- Tool enable/scope state ([Tools](04-tools.md)).
- Soul prompt files ([Soul Editor](05-soul-editor.md)).

> ⚠️ **Export before any large change.** Imports overwrite hooks, prompts and tool settings — those can materially change agent behaviour. Import only from trusted snapshots, ideally one you exported yourself.

## Restart requirements

Some settings hot-reload immediately:

- Telegram policy fields (DM/group, allowlists, admin IDs, mentions).
- Tool enable/scope state (lives on the [Tools](04-tools.md) page anyway).
- Hooks (live on the [Hooks](09-hooks.md) page).
- Heartbeat interval and prompt.

Others require an agent restart:

- Provider / model / API key.
- Telegram transport mode (bot vs personal).
- Vector memory provider switch.
- WebUI port.
- MCP server set.

The UI marks restart-sensitive fields with a small icon. The agent control at the bottom of the sidebar restarts the runtime cleanly — Telegram session and queued tasks survive.
