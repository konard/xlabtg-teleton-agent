# Tools

The Tools page controls which built-in tools the agent can use and where each tool is allowed to run. Together with [Security Center](08-security.md) it is the primary safety surface in the WebUI: anything you disable here cannot be called by the LLM, by an autonomous task, or by a remote agent.

![Tool catalogue dashboard widgets](../assets/screenshots/en/dynamic-dashboard-engine.png)

## Page layout

The page is a grouped list, one row per tool, grouped by **module**. Each row shows:

- The tool **name** and a short description.
- An **Enabled** toggle.
- A **Scope** selector (`always`, `dm-only`, `group-only`, `admin-only`).
- A **cost badge** — `low`, `medium`, `high` — based on latency, paid API cost, or operational risk.
- **Stats**: total calls, success count, failures, last use, average duration.
- An **expand** arrow that opens the detail panel.

Above the list:

- **Search box** — matches the name, description, parameters, and module of every tool.
- **State filter** — *all / enabled / disabled*.
- **Sort** — *by module* (good for audits) or *by name* (when you know the exact tool).
- **Bulk actions** — checkboxes select multiple tools; the action bar appears at the top of the page.
- **Import / Export** — JSON snapshots of the entire enable/scope state.

## Concepts

| Concept | Description |
| --- | --- |
| **Module** | A group of related tools. Built-in modules: Telegram, TON, web, workspace, exec, memory. Plugin manifests register additional modules. |
| **Enabled** | When off, the tool is invisible to the LLM and the autonomous planner. The LLM never sees it in the function-calling schema. |
| **Scope** | Where the tool may run. `always` — any chat. `dm-only` — direct messages only. `group-only` — only inside groups. `admin-only` — admin chats only, regardless of group/dm. |
| **Cost badge** | Rough indicator: low = local & fast, medium = paid API, high = on-chain or destructive. Use it as a hint when you bulk-disable. |
| **Stats** | Per-tool call count, error count, last use, average duration. The page polls them so you can spot failures quickly. |

## Inspecting a tool

Click a tool to expand its detail panel. The panel shows:

- **Function signature** — name, parameter list, parameter types, return type.
- **Documentation** — markdown description from the manifest, including examples.
- **Recent failures** — the last few errors with timestamp, arguments and message.
- **Test panel** — pre-fill the parameters and click **Run** to invoke the tool from the WebUI. Test calls are scoped to the operator account and are logged in the audit trail.

> ⚠️ **Test responsibly.** A `Run` from the test panel is a real invocation. For Telegram and TON tools start with a test account and a small TON amount. Workspace and `exec` tools should be tested only against scratch directories.

## Enabling and scoping a tool

1. Find the tool by search or by expanding the module.
2. Flip the **Enabled** toggle on. (The toggle is debounced and saves automatically.)
3. Pick the **strictest usable scope**:
   - Use `admin-only` for any tool that moves money, writes files, or runs shell commands.
   - Use `dm-only` for sensitive support flows where the operator handles the user one-on-one.
   - Use `group-only` for moderation or analytics tools.
   - Use `always` only for read-only, non-billing tools.
4. If the tool is sensitive, open [Security Center](08-security.md) and confirm a `tool_toggle` event is in the audit trail and the validation log treats the new scope as expected.

## High-risk modules

The default install ships these modules disabled or admin-only. Keep them that way unless you have a specific reason and a matching policy in Security Center:

- **`exec`** — runs shell commands on the host. Disabled by default. Enable only with an admin-only scope and a matching `exec` policy in Security Center.
- **TON wallet tools** (`ton_send`, `jetton_send`) — keep admin-only and behind a `require_approval` policy.
- **Workspace write/delete** — restrict to trusted operators; consider an approval policy for `delete`.
- **External HTTP tools** — review the destination domain list, then scope to `admin-only` if the tool can post mutations.

## Bulk operations

Use the row checkboxes to select multiple tools and apply an action from the floating bar:

| Bulk action | Use case |
| --- | --- |
| **Toggle enabled** | Disable a whole module before a security review or during incident response. |
| **Set scope** | Move every TON send tool to `admin-only` in one click. |
| **Export selected** | Capture a snapshot before a large change. |
| **Import** | Apply a known-good tool configuration to a fresh install. |

> ℹ️ **Note** — Import overwrites enable state and scope; it never installs new tools. Plugin tools come from the [Plugins](10-advanced-features.md#plugins) page.

## Plugin tools

Plugin tools appear in the same list as built-ins, prefixed by the plugin identifier. Their behavior is identical to built-ins — same toggle, same scope, same audit events — but they come from the plugin manifest. Before enabling a plugin tool in production:

1. Read the plugin manifest in [Plugins](10-advanced-features.md#plugins). Check `requested_permissions`, `requested_secrets`, and the source URL.
2. Confirm the plugin author is verified (badge in Plugins → Marketplace).
3. Test in DM with a small input before allowing group scope.

## Recommended audit workflow

- **Weekly** — sort by module, look for tools with high failure counts; investigate or disable.
- **After model swap** — clear cache from the [Dashboard](02-dashboard.md), then exercise enabled tools from the test panel.
- **Before delegating to a remote agent** — open [Network](10-advanced-features.md#network) and confirm the delegate sees only tools you intentionally exposed.
- **After incident** — export the tool configuration, file the snapshot with the incident report.
