# Semantic Memory

Teleton has two memory layers:

- Local memory is always available. `MEMORY.md`, `memory/*.md`, SQLite, and FTS5 keyword search keep working without any external service.
- Semantic vector memory is optional. When Upstash Vector is configured, Teleton also writes embedded memory chunks to Upstash and can use those results before falling back to local search.

## Startup Modes

At startup, the memory log can report one of these modes:

| Mode | Meaning | Agent behavior |
|------|---------|----------------|
| `Online` | Upstash Vector credentials are configured and reachable. | Semantic vector search is used, with local memory still kept in sync. |
| `Standby` | Upstash Vector credentials are not configured. | The agent continues with local SQLite/FTS5 memory only. |
| `Fallback Mode` | Upstash Vector is configured but unavailable or timed out. | The agent continues with local SQLite/FTS5 memory only. |

Upstash failures are non-fatal. Health checks, searches, upserts, and deletes are bounded by a short timeout so an unavailable provider does not block normal agent startup or memory writes.

## Configuration

Configure Upstash Vector in `config.yaml`:

```yaml
vector_memory:
  upstash_rest_url: "https://..."
  upstash_rest_token: "..."
  namespace: "teleton-memory"
```

Environment variables override `config.yaml` values:

```bash
export UPSTASH_VECTOR_REST_URL="https://..."
export UPSTASH_VECTOR_REST_TOKEN="..."
export UPSTASH_VECTOR_NAMESPACE="teleton-memory"
```

`UPSTASH_VECTOR_NAMESPACE` is optional. If it is omitted, Teleton uses `teleton-memory`.

## Embeddings

Semantic vector memory uses the configured embedding provider:

```yaml
embedding:
  provider: "local"
  # model: "Xenova/all-MiniLM-L6-v2"
```

The default `local` provider runs on the host after downloading the ONNX model cache. Set `embedding.provider: "none"` to disable vector embeddings and use FTS5 keyword search only.

## Syncing Existing Memory

Existing `MEMORY.md` and `memory/*.md` files can be synchronized after Upstash credentials are added:

1. Open the WebUI.
2. Go to `Memory`.
3. Click `Sync Vector`.

The sync action reindexes local memory files and uploads their chunks to Upstash only when semantic vector memory is online. If Upstash is not configured or unavailable, the action reports that state and leaves local memory active.

## Operational Notes

- Do not treat Upstash as required infrastructure. Teleton keeps local memory as the source of truth.
- Use Upstash for better semantic recall across long-term memory, not as the only memory backend.
- The WebUI `Configuration -> Vector Memory` settings reconfigure the live vector adapter for future searches and writes.
- The WebUI `Memory -> Sync Vector` button is the manual migration path for existing memory files.
