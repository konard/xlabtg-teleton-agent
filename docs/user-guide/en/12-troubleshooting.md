# Troubleshooting

Use this page when the WebUI, the agent runtime, the Telegram connection, the tools, memory or autonomous tasks do not behave the way you expect. Each section describes the symptom, the most likely root cause, and a step-by-step recovery.

> ℹ️ **Always check the Dashboard first.** The status header and health-check widgets identify most problems in 30 seconds.

## WebUI sign-in fails

**Symptoms**: token is rejected, the *Invalid token* banner appears, or the page reloads to the login screen.

1. Confirm you are using the **current** token. Run `teleton start --webui` again — the terminal prints either the saved token reminder or, if you regenerated it, a fresh startup exchange link.
2. Open the printed local URL. The fragment after `#` carries a one-time exchange nonce that bypasses the token field.
3. Check that the browser is not blocking **local cookies**. Cookie-blocking extensions and strict tracking settings sometimes drop the WebUI session cookie.
4. If you sit behind a reverse proxy, confirm it forwards `Set-Cookie` headers and does not strip the `__Host-` cookie prefix.
5. After three failed attempts the WebUI rate-limit fires; wait one minute or rotate the token in [Security Center → Settings](08-security.md).

## Agent does not respond to Telegram

**Symptoms**: messages reach Telegram but the agent stays silent.

1. Check the **agent state** at the bottom of the sidebar. If `stopped`, click *Start*.
2. Open the **Dashboard** and read the health-check widgets. A red Telegram pill points at the next step.
3. Verify the **Telegram session** is alive — open [Configuration → Telegram](11-settings.md) and confirm the bot/user is logged in.
4. Confirm the chat is allowed by your **DM / group / mention** policy in [Configuration → Telegram](11-settings.md).
5. Open [Sessions](07-sessions.md) and find the chat. If the message arrived, the agent is processing; if not, the issue is on the Telegram side (proxy or auth).

## Autonomous Mode tasks stay `pending`

**Symptoms**: tasks created on the Autonomous page never leave `pending`.

1. Confirm **`telegram.admin_ids`** has at least one numeric ID. An empty admin list blocks the autonomous scheduler.
2. Open [Security Center → Validation Log](08-security.md) and look for `denied` decisions on tools the task needs.
3. Check the task's **iteration limit** and **duration limit** — a value too small can make the loop refuse to start.
4. Move high-risk tools the task does not need into **restricted tools**; some tasks fail-fast when an unrestricted tool would mean a policy violation.
5. The **autonomous toggle** at the top of the [Autonomous](03-autonomous-mode.md) page must be **on**.

## Telegram authentication fails

![MTProto proxy status](../assets/screenshots/en/mtproto-proxy-status.png)

**Symptoms**: setup wizard or [Configuration → Telegram](11-settings.md) reports `auth failed` or the connection drops shortly after start.

1. **API ID / API hash / phone number / code** — re-check each. The most common error is a missing `+` in front of the country code.
2. **2FA password** — if your account has 2FA, enter it in the wizard's password field.
3. **MTProto proxy** — if your network blocks Telegram, configure the MTProto proxy in [Configuration → MTProto](11-settings.md). Both raw and `dd…`/`ee…` fake-TLS secrets are supported.
4. **Bot mode** — for bot transport, validate the **bot token** and **username** match. The username field accepts `@bot_name` or `bot_name`.
5. After fixing credentials, restart the runtime; the Telegram client only re-reads the credentials at startup.

## Tools fail

**Symptoms**: a tool call returns `error` or `denied`, or the agent reports it has no matching tool.

1. Open [Tools](04-tools.md) and verify the tool is **enabled** and that its **scope** matches the chat where it must run.
2. Expand the tool to read the **recent failures** entries — the error usually contains the upstream cause (rate limit, expired key, invalid argument).
3. Open [Security Center → Validation Log](08-security.md) and look for the tool's row. A `deny` decision points to a policy; a `require_approval` points at the [Approvals](08-security.md) queue.
4. For **plugin tools**, open [Plugins](10-advanced-features.md#plugins) → the plugin → **Secrets** tab and confirm every required secret is set.
5. If the tool is rate-limited at the upstream, lower call frequency in the autonomous task or add a `time_window` condition in [Hooks](09-hooks.md).

## Memory or vector sync fails

![Vector memory configuration](../assets/screenshots/en/vector-memory-config.png)

**Symptoms**: [Memory](10-advanced-features.md#memory) sync button reports an error, or memory search returns nothing.

1. **Local mode**: confirm the SQLite files in the runtime home are writable by the agent user.
2. **Upstash mode**: verify URL, token and namespace in [Configuration → Vector Memory](11-settings.md).
3. **Dimension mismatch** is the single most common Upstash error — the embedding model and the index dimension must match. If you change the embedding model, recreate the index.
4. After credentials are correct, click **Sync** in Memory; the page reports the new index size and any per-document failures.
5. **Pin** important memories before any cleanup so they survive the prune step.

## Cost or latency spikes

**Symptoms**: Dashboard tokens widget shows a sudden growth, Analytics performance tab shows a regression.

1. Open [Analytics](06-analytics.md) → **Tokens** and switch to 24h. Identify the model, session or autonomous task driving the increase.
2. Open [Tasks](10-advanced-features.md#tasks) and check whether an autonomous task is **looping** (status `running` for hours, increasing iteration count).
3. Lower the **iteration limit** or **pause** noisy tasks from the [Autonomous](03-autonomous-mode.md) page.
4. Open [Dashboard](02-dashboard.md) → **Cache** widget and verify hit rate. A dropped hit rate after a model swap usually means the cache must be cleared.
5. If the regression follows a model swap, [Configuration → LLM](11-settings.md) → switch back to the previous model and re-check.

## WebUI is slow

**Symptoms**: pages take seconds to render or polling spinner stays up.

1. Open browser DevTools → Network. If `/api/...` calls are slow, the bottleneck is the agent runtime, not the UI.
2. Reduce **request logging** in [Configuration → Advanced](11-settings.md) — verbose logs slow the runtime in dev mode.
3. Restart the runtime from the bottom of the sidebar. Caches and Recharts buffers reset.

## When to escalate

Escalate to maintainers with:

- Exact agent version (visible at the bottom of the sidebar).
- The configuration area you are in (LLM, Telegram, MTProto, Memory, etc.).
- Reproduction steps with input.
- Log excerpts (use [Dashboard](02-dashboard.md) → *Export logs*).
- Screenshots — preferably the [Security Center](08-security.md) audit row for the action and the [Sessions](07-sessions.md) message for the chat.
- A note saying which area is affected: Telegram only, TON only, memory only, tools only, or WebUI only.

Open issues at <https://github.com/xlabtg/teleton-agent/issues>.
