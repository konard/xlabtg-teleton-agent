# Agent Network Protocol

Teleton can register remote agents, track their capabilities, assign trust, and send signed JSON messages to a remote `/api/agent-network` endpoint.

## Configuration

The network layer is disabled by default.

```yaml
network:
  enabled: false
  agent_id: "primary"
  agent_name: "Primary Agent"
  endpoint: null
  discovery_mode: "central"
  registry_url: null
  known_peers: []
  public_key: null
  private_key: null
  allowlist: []
  blocklist: []
  default_trust_level: "untrusted"
  message_timeout_ms: 15000
  max_clock_skew_seconds: 300
```

When `network.enabled` is `false`, authenticated inventory routes can still show stored peers, but task delegation and signed remote ingress are rejected.

Use PEM encoded Ed25519 keys for message signing. Inbound messages must come from a registered sender with a stored `publicKey`, and the signature must match the canonical message body. Production peer endpoints must use HTTPS; localhost HTTP endpoints are accepted for tests and local development.

Outbound delegation requires `private_key` so every transmitted message can be signed.

## Message Format

Messages are JSON over HTTPS:

```json
{
  "type": "task_request",
  "from": "primary",
  "to": "research-remote",
  "correlationId": "0e46d9c7-d7b2-4486-9ba8-7d9843f1c885",
  "payload": {
    "description": "Summarize this document",
    "requiredCapabilities": ["summarization"],
    "payload": { "documentId": "doc-1" }
  },
  "signature": "...",
  "timestamp": "2026-04-24T00:00:00.000Z"
}
```

Supported message types are `capability_query`, `heartbeat`, `negotiation`, `task_request`, and `task_response`.

## WebUI API

Authenticated WebUI routes:

- `GET /api/network/agents`
- `POST /api/network/agents`
- `DELETE /api/network/agents/:id`
- `GET /api/network/agents/:id/capabilities`
- `PUT /api/network/agents/:id/trust`
- `POST /api/network/agents/:id/tasks`
- `GET /api/network/status`
- `GET /api/network/messages`

Signed remote ingress:

- `POST /api/agent-network`

Inbound `task_request` messages create a local pending task with `created_by` set to `network:<agentId>`. Network messages are recorded in `network_messages` and mirrored into the tamper-evident audit trail as `network.message` events.
