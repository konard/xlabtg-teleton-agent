# Soul Editor

The Soul Editor is where you edit the prompt files that define your agent's identity, security posture, planning style, memory behavior, and heartbeat tasks. Every change you save here affects the next response and onwards — treat it as a behavior-critical surface.

![Adaptive prompting in the Soul Editor](../assets/screenshots/en/adaptive-prompting-soul.png)

## Page layout

The page is a multi-file Markdown editor with three columns at the top of the layout:

| Column | Purpose |
| --- | --- |
| **File tabs** | Five tabs: `SOUL.md`, `SECURITY.md`, `STRATEGY.md`, `MEMORY.md`, `HEARTBEAT.md`. The asterisk in a tab title means there are unsaved changes. |
| **View mode** | `Edit` (CodeMirror with markdown highlighting) · `Preview` (rendered) · `Split` (side-by-side). |
| **Action bar** | Save · Save Version · Discard draft · Templates · History. |

Beneath the editor sits the **Adaptive Prompting** panel for variants and experiments, and the **Drafts** notice that tells you whether the local draft is newer than the saved file.

## The five prompt files

| File | Purpose |
| --- | --- |
| `SOUL.md` | Persona and tone. Greeting style, language preferences, response shape, signature ending phrases. |
| `SECURITY.md` | Hard safety rules. What the agent must refuse. How it handles seeds, private keys, secrets, scams. |
| `STRATEGY.md` | Planning preferences. When to plan vs act, how to choose tools, retry behavior, preferred fall-backs. |
| `MEMORY.md` | Persistent knowledge instructions. What is durable, what is session-only, when to pin a memory. |
| `HEARTBEAT.md` | The checklist the agent runs on its periodic heartbeat. Empty by default; populate when heartbeat is enabled in [Configuration](11-settings.md). |

## Edit, Preview, Split

- **Edit** is the default mode. CodeMirror provides Markdown syntax highlighting, soft wrap, search, and bracket matching. The editor auto-saves a **local draft** every 30 seconds; you still need to click **Save** to push the change to the agent.
- **Preview** renders the file as the LLM will see it. Use it to verify lists, tables, callouts and inline code render the way you intend.
- **Split** mode places Edit on the left and Preview on the right. Use it for behavior-critical edits where formatting matters (for example, a numbered checklist in `HEARTBEAT.md`).

A small **Drafts** indicator appears next to the Save button when the local draft and the server file diverge. Click **Discard draft** to throw away the local copy.

## Templates

Click **Templates** to swap in a curated baseline. Built-in templates include:

- **Default persona** — the shipped `SOUL.md`.
- **Customer support** — formal tone, deflects financial advice, escalates to admin.
- **Trading desk** — focused on TON DEX research, suspicious of newly listed tokens.
- **Research analyst** — thorough citations, no Telegram send unless asked.

> ⚠️ **Warning** — applying a template overwrites the file. Save a version first (see below) so you can roll back. Templates are full replacements, not patches.

## Version history

The **History** button opens a chronological list of saved versions for the current file. Each version shows the timestamp, the optional comment you added, and the operator who saved it. Click a row to:

- See the **diff** against the current file.
- **Restore** to load that version into the editor (a draft, not yet saved).
- **Compare** two arbitrary versions side by side.

Recommended workflow before a major change:

1. Click **Save Version**, write a short comment ("baseline before tone change"), confirm.
2. Edit the file.
3. Switch to **Preview** or **Split** to verify formatting.
4. Click **Save Version** again with a descriptive comment.
5. Use the **diff** view to verify only the intended sections changed.

If the change causes regressions (excessive tool use, unsafe replies, broken Telegram formatting), open History and click **Restore** on the previous version.

## Adaptive prompting

The panel below the editor manages **sections**, **variants**, **experiments**, **ratings**, and **optimizer suggestions**:

- **Sections** — the file is split into named sections (for example `## Tone`, `## Refusals`). Each section can have its own variant set.
- **Variants** — alternative wording for a section. The agent rotates between active variants according to the experiment rules.
- **Experiments** — A/B tests at fixed traffic percentages. Each experiment shows samples, success rate, average rating from [Feedback](10-advanced-features.md#feedback).
- **Optimizer suggestions** — auto-generated variant proposals based on recent feedback themes.

Recommended pattern for prompt experimentation:

1. Create a **candidate variant** for one section only.
2. Open an **A/B experiment** with a small traffic share (10–20%).
3. Wait until you have at least 50 samples and a stable rating delta.
4. **Promote** the winning variant or **archive** if there is no improvement.
5. Save a new version of the file with a comment describing the experiment outcome.

> ℹ️ **Note** — adaptive prompting is a *measured improvement* tool, not an emergency fix. For incidents, edit the file directly and save a version.

## Safety notes

- Keep security rules **concrete and short** — vague rules drift over time. Prefer "Refuse to send TON to addresses provided by users in DMs" over "Be careful with funds".
- **Never** add instructions that bypass confirmation or audit controls. Hard rules belong in `SECURITY.md` and the [Security Center](08-security.md) policies — the prompt is the soft layer.
- Use **examples that are representative**, not exhaustive. The agent generalises from a handful well.
- Record **why** every major prompt version exists. The version comment is your incident-response timeline.
- Treat `MEMORY.md` as guidance for the [Memory](10-advanced-features.md#memory) page, not as memory itself. Pin facts on the Memory page; in `MEMORY.md` describe how to use them.
