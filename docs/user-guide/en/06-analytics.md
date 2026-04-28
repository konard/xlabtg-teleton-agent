# Analytics

The Analytics page is where you understand how the agent is being used, where the cost is going, and whether performance is healthy. It is a multi-tab dashboard with charts, tables, and filters built on Recharts.

![Temporal context analytics](../assets/screenshots/en/temporal-context-analytics.png)

## Page layout

A header band carries the period selector and an export button. Below it is the tab strip:

| Tab | Focus |
| --- | --- |
| **Tokens** | Token usage by day, model, provider, and session. |
| **Costs** | Money spent: per provider, per model, per tool. Includes the budget bar. |
| **Tools** | Most-used and most-failing tools, success rate, average duration. |
| **Activity** | Heatmap of message and tool-call volume by hour and day. |
| **Performance** | Latency p50/p95/p99, error rate, queue depth. |
| **Anomaly** | Auto-detected unusual events with severity and context. |
| **Temporal** | Long-term recurring patterns (peak hours, weekly cycles). |

The **period selector** offers `1h`, `24h`, `7d`, `30d`, or a custom range. The **export** button downloads the active tab's underlying data as JSON or CSV.

## Tokens

The Tokens tab shows three views:

- **Daily totals** — line chart of input + output tokens; switch to stacked area to compare by provider.
- **By model** — bar chart of token spend per model. Hover for the count of calls.
- **Top sessions** — table of the highest token sessions over the period; click a row to jump to [Sessions](07-sessions.md).

Look here when:

- The Dashboard token widget shows a spike — open Tokens, switch to 24h, and find the model or session driving it.
- You are evaluating a new model — compare the same task family for a week before and after the swap.

## Costs

The Costs tab adds a money axis on top of token data. It includes:

- **Cumulative spend** for the current period.
- **Projection** — extrapolated spend at the end of the calendar month (only after enough samples).
- **Budget bar** — current spend vs. the budget set in [Configuration](11-settings.md). Turns yellow at 70%, red at 90%.
- **Cost by tool** — useful when an external API tool unexpectedly drives the bill.

> ℹ️ **Note** — Cost is computed from per-model price tables. Self-hosted providers default to `$0`. Update the price table in [Configuration → LLM](11-settings.md) if your real cost differs.

## Tools

The Tools tab feeds back into [Tools](04-tools.md) decisions:

- **Top by calls** — bar chart of most-called tools.
- **Top by failures** — bar chart sorted by failure count, with success rate alongside.
- **Latency** — table with average duration and p95.
- **Unused** — list of enabled tools that have not been called in the period.

Use it weekly to find candidates for disabling (unused, never successful) or scoping down (admin-only after a failure cluster).

## Activity

The Activity tab is an hour × day heatmap of total events: messages received, replies sent, tool calls, autonomous events. Brighter cells indicate more activity.

Use it to:

- Schedule heartbeat / digest tasks during low-activity windows.
- Justify increasing concurrency during peak hours.
- Spot weekend vs. weekday patterns.

## Performance

The Performance tab shows latency and reliability:

- **End-to-end response time** — p50, p95, p99 line charts.
- **Tool latency** — per-tool p95.
- **Error rate** — percentage of failed responses.
- **Queue depth** — autonomous task queue and message backlog.

A regression here usually points to a provider issue, a model swap, or a runaway autonomous task. Cross-check [Tasks](10-advanced-features.md#tasks) for stuck tasks before opening a vendor ticket.

## Anomaly

![Anomaly monitoring](../assets/screenshots/en/anomaly-monitoring.png)

The Anomaly tab lists auto-detected events with three severity levels: `info`, `warning`, `critical`. Each card shows:

- **What changed** (e.g. token growth +320% week over week).
- **Suspected cause** — model, tool, autonomous task, or operator.
- **Recommended action** — link to the page that can fix it.
- **Acknowledge** — operator confirms the anomaly was reviewed.

Acknowledge an anomaly only after you understand the cause; an unacknowledged anomaly stays at the top with a red banner on the Dashboard.

## Temporal

The Temporal tab tracks long-term patterns:

- **Peak hours by day of week** — useful for scheduling.
- **Recurring incident windows** — when failures cluster repeatedly.
- **Drift** — slow trends in token cost or latency that the daily Dashboard misses.

## Feedback learning

![Feedback learning dashboard](../assets/screenshots/en/feedback-learning-dashboard.png)

The Tokens tab links into the [Feedback](10-advanced-features.md#feedback) page, which has its own analytics view. Feedback metrics show:

- **Average rating** over time.
- **Positive vs. negative ratio**.
- **Themes** — clusters of feedback content (e.g. "tone too formal", "missed context").
- **Recent feedback** — chronological list with rating, sentiment, and the message that triggered it.

Use feedback metrics together with [Soul Editor](05-soul-editor.md) experiments when adjusting tone or response style.

## Exporting data

The export button downloads the active tab's data as JSON (full structure) or CSV (rows). Use exports for:

- **Cost reviews** — month-over-month comparisons in a spreadsheet.
- **Incident reports** — attaching raw data to a write-up.
- **Long-term archival** — when you rotate the SQLite database.

> ⚠️ **Treat exports as sensitive** — they contain operational timing, chat-derived metadata, and tool names. Store them in the same place you keep the agent config.

## Weekly review checklist

- Token growth matches real workload — not a runaway loop.
- Tool failures are not concentrated in one module.
- Cost projection stays below the configured budget.
- Every anomaly has an owner and an explanation; acknowledge or escalate.
- Feedback themes are reflected in either a prompt change ([Soul Editor](05-soul-editor.md)) or a policy change ([Security Center](08-security.md)).
