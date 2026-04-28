# Hooks

Hooks are pre-response transformations: they read every incoming message and either *block* it, *inject context* before the agent answers, or *trigger* an action. They are the lightest-weight way to enforce keyword rules without changing prompts or adding code.

![Events page for hook-related event review](../assets/screenshots/en/events-page.png)

## Page layout

The Hooks page has two top-level views, switched by the toggle in the header:

| Mode | When to use |
| --- | --- |
| **Basic** | One-line keyword blocklists and context triggers. Fastest to set up. |
| **Advanced** | Full structured rule builder with condition blocks and action blocks. |

Below the mode toggle is the **Test panel** — a sandbox that lets you paste a fake message and see exactly which hooks fire. Saves are debounced (about 400 ms) so you can iterate without manually clicking save.

## Basic mode

Basic mode exposes two simple structures.

### Keyword blocklist

The blocklist rejects messages that contain any configured keyword and returns a fixed response. Use it for hard stops:

- Seed phrases, private keys, mnemonic words.
- Prohibited support topics ("when moon", "guarantee 10x").
- Words that should never reach the LLM (PII patterns, internal codenames).

For each keyword you set:

- **Match** — substring (default), word boundary, or regex.
- **Response** — the message returned to the user verbatim.
- **Audit reason** — a label that lands in [Security Center](08-security.md) when the hook fires.

> ℹ️ **Keep terms specific.** "key" is too broad and will block legitimate questions. "private key" or `\\bseed\\b` (regex) is much safer.

### Context triggers

Context triggers do the opposite of blocking — they **add instructions** to the agent before it answers. Example: a trigger on `airdrop` can inject the reminder *"Warn about scam risk; never recommend connecting wallets to unknown sites."*

For each trigger:

- **Keyword / regex** — same matching options as the blocklist.
- **Injected context** — markdown text appended to the system prompt for that one response.
- **Scope** — DM only, group only, or both.

## Advanced mode (visual rule builder)

Advanced mode combines **condition blocks** and **action blocks** into ordered rules:

| Condition | Matches when… |
| --- | --- |
| `keyword` | The message contains the substring or regex. |
| `chat_type` | The chat is `dm`, `group`, or `channel`. |
| `chat_id` | The chat is in the listed IDs. |
| `user_id` | The sender is in the listed IDs. |
| `time_window` | The current time is in the configured window. |

| Action | Effect |
| --- | --- |
| `block` | Refuse with a fixed response. |
| `inject_context` | Add markdown to the system prompt for this turn. |
| `route_to_tool` | Skip the LLM and call a tool directly. |
| `notify` | Emit an event into [Events](10-advanced-features.md#events). |
| `escalate` | Force human approval via [Security Center](08-security.md). |

Rules are ordered top to bottom; the first matching rule wins, except `notify` which is non-blocking and stacks with the next rule.

## Test panel

![Audit trail entry for a hook change](../assets/screenshots/en/audit-trail-security-page.png)

Before saving a new hook set, validate it:

1. Paste a representative user message.
2. Choose chat type (`dm`, `group`, `channel`) and, optionally, sender ID.
3. Click **Run**.
4. Read the report:
   - Which hooks fired (in order).
   - Whether the message was blocked.
   - What context was injected.
   - The final action taken.
5. Adjust keywords and rules to avoid false positives, then re-run.

Run **at least one positive case** (the message you want to catch) and **at least one negative case** (a message that should pass through unaffected).

## Where hooks fit (and where they don't)

Hooks are **local behavior controls** for incoming messages. They are not suited to:

- **Outbound automation** — use [Workflows](10-advanced-features.md#workflows) (cron / event triggered actions) and [Webhooks](10-advanced-features.md#events) instead.
- **External integrations** — use the [Integrations](10-advanced-features.md#integrations) page.
- **Hard policy** — use [Security Center → Policies](08-security.md). A hook can suggest behavior; a policy enforces it.

![Integrations page for outbound flow](../assets/screenshots/en/integrations-page.png)

## Design rules

- **Be specific.** "private key" beats "key". Regex with word boundaries beats raw substrings.
- **Block secrets, advise on the rest.** Use `block` for seeds, keys, and abuse. Use `inject_context` for advice and disclaimers.
- **Test positive and negative.** Every new hook needs at least one example of each.
- **Keep order shallow.** A handful of rules in the right order is easier to reason about than dozens of overlapping ones.
- **Audit after changes.** Open [Security Center → Audit Trail](08-security.md) and confirm a `hook_change` event was recorded.
