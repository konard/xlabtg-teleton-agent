# Dashboard

The Dashboard is the first page that loads after sign-in. It is the operational cockpit: live status, current provider and model, token and cost counters, system health, custom widgets, and quick actions. The data refreshes by polling every 10 seconds.

![Dynamic dashboard with widgets](../assets/screenshots/en/dynamic-dashboard-engine.png)

## What you see at a glance

The page is split into bands from top to bottom:

| Area | Content |
| --- | --- |
| **Status header** | Provider, model, uptime, sessions, tool count, token totals, service health pill. |
| **Quick actions row** | Buttons for low-risk, frequently used operations: clear cache, export logs, restart agent, send a test message. Risky actions show a confirmation dialog. |
| **Notification banners** | Warnings (degraded provider, expired tokens, denied tool calls), info messages, and unread approval prompts. Banners stack from top to bottom by severity. |
| **Widget grid** | Built-in widgets and any custom widgets you generated. The grid is draggable and resizable in edit mode. |

The bottom half of the sidebar is always visible and tells you whether the runtime is running, lets you switch agents, restart the runtime, toggle the theme, and log out. The Command Palette (`Ctrl+K` / `Cmd+K`) opens from anywhere on the page.

## Built-in widgets

Out of the box the Dashboard ships with widgets that cover most operations:

- **Status** — provider, model, model fallback, current task counters.
- **Tokens & Costs** — daily token spend, projected monthly cost, top model by cost.
- **Tool usage** — most-used and most-failing tools with mini sparklines.
- **Activity heatmap** — hour × day grid of message and tool-call activity.
- **Predictions** — proactive suggestions such as "tool X is rate-limited, route to Y" or "session backlog rising".
- **Cache** — hit rate, evictions, top keys, and a *Clear cache* button.
- **Health checks** — service status for Telegram, LLM, MCP servers, vector store, TON proxy.

![Predictions widget](../assets/screenshots/en/predictions-widget-dashboard.png)
![Cache widget](../assets/screenshots/en/cache-widget.png)

## Edit mode and custom widgets

![Widget generator](../assets/screenshots/en/widget-generator.png)

Click **Edit** on the dashboard to enter layout mode. You can:

1. **Drag** widgets to reorder them and **resize** by the bottom-right handle.
2. Click **Add widget** to choose a built-in widget from the catalogue.
3. Click **Generate widget** to describe a widget in natural language ("show failed tools this week", "compare daily token cost by provider"). The generator returns a preview, the source query, and the Recharts component before saving.
4. **Remove** a widget with the trash icon.
5. Click **Done** to leave edit mode and persist the layout.

You can also **Export** the dashboard bundle (layout JSON + generator prompts) and **Import** it on another installation.

> ℹ️ **Note** — Generated widgets are convenient for personal operational views but they are not the source of truth. For audit, security and configuration always go to the dedicated pages: [Security Center](08-security.md), [Analytics](06-analytics.md), [Configuration](11-settings.md).

## Quick actions

| Action | What it does |
| --- | --- |
| **Clear cache** | Drops the in-memory request cache. Use after model changes. |
| **Export logs** | Downloads the recent logs as a `.zip` for support tickets. |
| **Restart agent** | Re-creates the runtime; preserves Telegram session and queued tasks. |
| **Send test message** | Sends a single message to the admin chat to verify the Telegram path. |

Anything destructive (Clear cache, Restart agent) opens a *Confirm* dialog with a description and a typed-in confirmation when the change is irreversible.

## Daily workflow

1. **Glance at the status header.** Provider, model, agent ready indicator should all be green.
2. **Read banners.** Resolve red banners first — they usually point at expired credentials, denied tool policies, or pending approvals.
3. **Skim Tokens, Tools, Activity.** A sudden spike usually maps to one autonomous task or one runaway loop.
4. **Run quick actions** if needed (clear cache after a model swap, export logs for an incident).
5. **Open dedicated pages** for anything beyond a glance — [Analytics](06-analytics.md) for trends, [Tasks](10-advanced-features.md#tasks) for queue depth, [Security](08-security.md) for the audit trail.

## Recommended habits

- Keep one **compact dashboard** for daily operations and a separate one for diagnostics.
- Treat predictions and anomaly cards as *hints*, not approvals — confirm in the source page before reacting.
- After a Quick Action that mutates state (restart, cache clear), open Security Center to confirm the matching audit event was recorded.
- Save your custom widget layouts via Export so you can restore them after a re-install.
