# Upstash Vector Setup (Step-by-Step)

This guide walks through creating an Upstash Vector index and connecting it to Teleton so semantic memory sync actually writes vectors. Every step below matters — an index provisioned with the wrong dimension will silently reject every upsert, even though the Upstash dashboard will show "requests" climbing.

If you already created an index and are seeing errors like:

> No vectors were uploaded to Upstash Vector because of an embedding dimension mismatch. `C:\Users\User\.teleton\workspace\MEMORY.md: Embedding dimension 384 (local/Xenova/all-MiniLM-L6-v2) does not match Upstash Vector index dimension 768.`

...jump to [Fixing a dimension mismatch](#fixing-a-dimension-mismatch). The index must match the embedding provider that Teleton uses — you cannot fix it by clicking "Sync Vector" again.

---

## TL;DR

| Teleton embedding provider | Default model | Vector dimension to set on the Upstash index |
| -------------------------- | ------------- | -------------------------------------------- |
| `local` (default)          | `Xenova/all-MiniLM-L6-v2` | **384** |
| `anthropic` (Voyage)       | `voyage-3-lite` | **512** |
| `anthropic` (Voyage)       | `voyage-3`, `voyage-code-3`, `voyage-finance-2`, `voyage-multilingual-2`, `voyage-law-2` | **1024** |
| `none`                     | — keyword-only (FTS5) | N/A (do not use Upstash; it will stay idle) |

Use **cosine** similarity and **dense** vectors. Keep the region close to where Teleton runs.

---

## 1. Decide which embedding provider Teleton will use

Teleton creates embeddings locally. Whatever provider you choose produces a fixed number of dimensions, and that same number has to be set on the Upstash index when you create it. You cannot change a dimension later — you would have to delete the index and re-create it.

Open `~/.teleton/config.yaml` (or the file you are using) and check the `embedding` block:

```yaml
embedding:
  provider: "local"
  # model: "Xenova/all-MiniLM-L6-v2"  # 384-dim, default for local
```

- **Left at defaults?** You are on `local` + `Xenova/all-MiniLM-L6-v2`, which produces **384-dimensional** vectors. Your Upstash index must be 384.
- **Using `anthropic`?** Check the model:
  - `voyage-3-lite` → **512**
  - `voyage-3`, `voyage-code-3`, `voyage-finance-2`, `voyage-multilingual-2`, `voyage-law-2` → **1024**
- **Using `none`?** Teleton is not producing embeddings at all, so Upstash will stay idle. Change the provider to `local` or `anthropic` before you connect Upstash.

Write the dimension down — you need it in step 3.

---

## 2. Create an Upstash account and project

1. Go to [https://console.upstash.com/](https://console.upstash.com/) and sign up or log in.
2. In the top-left project switcher, stay on your default project or create a new one.
3. Open the **Vector** product: [https://console.upstash.com/vector](https://console.upstash.com/vector).

Teleton only needs the Vector product. You do not have to create a Redis/KV database.

---

## 3. Create the Vector index with the correct dimension

On the Vector dashboard click **Create Index** and fill the form:

| Field | Value |
| ----- | ----- |
| Name | Anything you want (e.g. `teleton-memory`). |
| Region | Pick the one closest to where Teleton runs. |
| Type | **Dense**. |
| Dimensions | **The number from step 1** — `384` for the default local provider, `512`/`1024` for Voyage. |
| Similarity / Metric | **Cosine**. |
| Embedding Model | Select **Custom** / "I will bring my own embeddings". Teleton produces the embeddings and uses Upstash only as a vector store — do **not** pick a built-in Upstash embedding model, because that hard-codes a dimension Teleton is not using. |

Click **Create**. The "Details" page for the index now shows the dimension it was created with. Confirm that it matches the number from step 1.

> If the Upstash form only exposes "Embedding Model" presets, pick a preset whose dimension equals the number from step 1 (for example, `mixedbread-ai/mxbai-embed-large-v1` = 1024, `sentence-transformers/all-MiniLM-L6-v2` = 384). The index dimension is what matters — Teleton sends its own embeddings regardless of this label.

**Cannot find a 384 option?** Delete the just-created index and recreate it with the custom-dimension input, or switch Teleton to a Voyage model that matches an available preset (step 1).

---

## 4. Copy the REST URL and REST token

On the index's **Details** page there are two values Teleton needs:

- `UPSTASH_VECTOR_REST_URL` — starts with `https://` and ends with `.upstash.io`.
- `UPSTASH_VECTOR_REST_TOKEN` — a long opaque string. Treat it as a secret.

Keep the page open — you will paste both into Teleton in the next step.

---

## 5. Connect Teleton to Upstash

You can configure Teleton through the WebUI or directly in YAML. Either works; Teleton reloads the live vector adapter when the WebUI saves settings.

### Option A — WebUI (recommended)

1. Start Teleton and open the WebUI.
2. Go to **Config** in the left sidebar.
3. Open the **Vector Memory** tab.
4. Fill in the fields:
   - **Embedding Provider** — leave as `local` (default) unless you are using Voyage.
   - **Embedding Model** — leave empty to use the provider default. The label notes *(requires restart)* because model reloads happen at startup.
   - **Upstash REST URL** — paste the value from step 4.
   - **Upstash REST Token** — paste the value from step 4. After saving, the field shows a blue `Set` badge to confirm the secret was stored.
   - **Namespace** — leave `teleton-memory` unless you need to isolate multiple Teleton deployments in the same index.
5. Click **Save**. Teleton reconfigures the live vector adapter immediately, no restart required (unless you also changed the embedding model).

![Vector memory configuration](https://github.com/xlabtg/teleton-agent/blob/main/docs/screenshots/vector-memory-config.png?raw=true)

### Option B — `config.yaml`

Add a `vector_memory` block next to `embedding`:

```yaml
embedding:
  provider: "local"
  # model: "Xenova/all-MiniLM-L6-v2"

vector_memory:
  upstash_rest_url: "https://<your-index>.upstash.io"
  upstash_rest_token: "<rest-token>"
  namespace: "teleton-memory"
```

Restart Teleton so the new credentials load.

### Option C — environment variables

Environment variables override `config.yaml`:

```bash
export UPSTASH_VECTOR_REST_URL="https://<your-index>.upstash.io"
export UPSTASH_VECTOR_REST_TOKEN="<rest-token>"
export UPSTASH_VECTOR_NAMESPACE="teleton-memory"   # optional
```

`UPSTASH_VECTOR_NAMESPACE` defaults to `teleton-memory` when omitted.

---

## 6. Verify the connection

When Teleton starts with Upstash configured, it logs the semantic memory mode. Look for one of:

- `Semantic Memory: Online (Upstash Vector, namespace=teleton-memory, vectors=<n>, dimension=<d>)` — success. `<d>` is the index dimension Upstash reported.
- `Semantic Memory: Standby (...)` — credentials are missing. Re-check step 5.
- `Semantic Memory: Fallback Mode (...)` — Upstash was configured but the health check failed (bad token, wrong URL, network). Local memory stays active.

If the dimension in the log does **not** match the embedding provider's dimension from step 1, startup also logs a warning like:

> `Upstash Vector index dimension 768. Upstash will reject every upsert from local/Xenova/all-MiniLM-L6-v2 (384-dim). Reprovision the index with dimension 384 or switch the embedding provider.`

That warning means the next sync will fail. Go to [Fixing a dimension mismatch](#fixing-a-dimension-mismatch).

---

## 7. Upload existing memory (one-time migration)

Teleton only writes to Upstash when memory changes. To push existing `MEMORY.md` and `memory/*.md` files to a new index:

1. Open the WebUI.
2. Go to **Memory** in the sidebar.
3. Click **Sync Vector** (top right).

![Memory sync vector](https://github.com/xlabtg/teleton-agent/blob/main/docs/screenshots/memory-sync-vector.png?raw=true)

Teleton reindexes local memory files and upserts their chunks to Upstash. The status banner reports one of:

- `Vector memory synchronized: <n> file(s) indexed, <m> skipped.` — success. Refresh the Upstash console: the **Vector count** grows and the **Requests** graph shows upserts.
- `No vectors were uploaded to Upstash Vector because of an embedding dimension mismatch ...` — see below.
- `No vectors were uploaded to Upstash Vector. Check that memory files contain content and embeddings are enabled.` — the provider is `none`, or embedding warmup failed, or `MEMORY.md` is empty.

After a successful sync, every new `memory_write` from the agent dual-writes locally and to Upstash automatically — you do not have to click Sync Vector again.

---

## Fixing a dimension mismatch

The error:

> `MEMORY.md: Embedding dimension 384 (local/Xenova/all-MiniLM-L6-v2) does not match Upstash Vector index dimension 768. Reprovision the index with dimension 384, or switch the embedding provider/model so it produces 768-dim vectors.`

means the index was created for one dimension and Teleton is sending a different dimension. Upstash rejects the upsert — **clicking Sync Vector again will not help** until the mismatch is resolved.

You have two options:

### Option A — recreate the index with the correct dimension (usually easiest)

1. On the Upstash dashboard, open the index and go to **Details → Danger Zone**.
2. Delete the index. (Upstash has no "change dimension" action; a new index is required.)
3. Re-run [Step 3](#3-create-the-upstash-vector-index-with-the-correct-dimension) and create a new index with the dimension the error message expects (e.g. `384`).
4. Copy the new URL/token into Teleton ([Step 5](#5-connect-teleton-to-upstash)).
5. Sync again ([Step 7](#7-upload-existing-memory-one-time-migration)).

### Option B — switch Teleton's embedding provider to match the index

Use this if you want to keep the existing index (e.g. it already has data you care about) and its dimension is one Voyage can produce.

1. Edit `~/.teleton/config.yaml`:
   ```yaml
   embedding:
     provider: "anthropic"          # Voyage via VOYAGE_API_KEY
     model: "voyage-3"              # 1024-dim, pick the model that matches the index dimension
   ```
2. Set `VOYAGE_API_KEY` in the environment or provide it through the WebUI API Keys tab.
3. Restart Teleton so the new provider loads. The startup log should now show `dimension=<d>` matching the index.
4. Sync again ([Step 7](#7-upload-existing-memory-one-time-migration)).

---

## Troubleshooting

**Upstash dashboard shows "Requests" but zero "Vector count".**
Every rejected upsert is still counted as a request. A growing requests chart with a flat vector count almost always means a dimension mismatch. Check the startup log or the last `Sync Vector` response — Teleton prints the exact provider / model / index dimension in the error message.

**`Sync Vector` reports success but Upstash is empty.**
This is the [#234](https://github.com/xlabtg/teleton-agent/issues/234) bug, fixed in [#235](https://github.com/xlabtg/teleton-agent/pull/235). Upgrade to `0.8.7` or newer. In fixed builds, `synced: true` is returned only when at least one vector was actually uploaded.

**The sync response says `No vectors were uploaded ... Check that memory files contain content and embeddings are enabled.`**
Either `~/.teleton/workspace/MEMORY.md` (and `memory/*.md`) are empty, `embedding.provider` is `none`, or the local ONNX model failed to download (check the startup logs for `Embedding model load failed`). Fix the provider/model, then click Sync Vector.

**Startup warns `Local embedding model unavailable — falling back to FTS5-only search`.**
The local ONNX download is blocked (firewall, proxy, corrupt cache at `~/.teleton/models/`). Delete the cache directory and restart, or switch to `anthropic` with a Voyage API key.

**Which namespace should I use?**
`teleton-memory` is fine for a single agent. If you run several Teleton instances against the same index, give each one a unique namespace so they do not overwrite each other's vectors.

---

## Related issues / PRs

- [#205](https://github.com/xlabtg/teleton-agent/issues/205) — EPIC: semantic vector memory with Upstash.
- [#227](https://github.com/xlabtg/teleton-agent/pull/227) — initial Upstash Vector integration.
- [#234](https://github.com/xlabtg/teleton-agent/issues/234) / [#235](https://github.com/xlabtg/teleton-agent/pull/235) — sync response now reports whether Upstash actually received vectors.
- [#246](https://github.com/xlabtg/teleton-agent/issues/246) / [#247](https://github.com/xlabtg/teleton-agent/pull/247) — dimension mismatch is detected and reported with an actionable fix.
- [#248](https://github.com/xlabtg/teleton-agent/issues/248) — this guide.

See also: [Semantic Memory](semantic-memory.md), [Configuration → embedding / vector_memory](configuration.md#embedding).
