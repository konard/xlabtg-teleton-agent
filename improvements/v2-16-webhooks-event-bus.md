# Webhooks & Event Bus

## Current State

The existing `21-api-webhooks.md` template describes API and webhook management at a UI level. The agent currently has no internal event bus — components communicate through direct function calls. Hooks (`src/agent/hooks/`) provide a rule-based system for intercepting agent events, but there is no pub/sub mechanism for decoupled event handling or external webhook dispatch.

## Problem

- No internal event system for decoupled communication between components
- Hooks are tightly coupled to the agent runtime
- Cannot trigger external actions based on internal events
- No webhook delivery system for notifying external services
- Cannot react to external events without polling
- No event replay or dead-letter queue for failed deliveries

## What to Implement

### 1. Internal Event Bus
- **Architecture**: In-process pub/sub event bus
- **Event types**: Typed events for all significant system actions
  - `agent.message.received`, `agent.message.sent`
  - `tool.executed`, `tool.failed`
  - `session.started`, `session.ended`
  - `config.changed`
  - `security.alert`
  - `schedule.triggered`
  - `anomaly.detected`
- **Subscribers**: Any service can subscribe to event types
- **Async delivery**: Events dispatched asynchronously to avoid blocking
- **Event schema**: `{ type: string, payload: any, timestamp: Date, source: string, correlationId: string }`

### 2. Webhook Delivery System
- **Webhook registration**: Configure URL + event types to subscribe to
- **Delivery guarantees**: At-least-once delivery with retry
- **Retry policy**: Exponential backoff (1s, 5s, 30s, 5min) with configurable max retries (default: 5)
- **Payload signing**: HMAC-SHA256 signature in `X-Webhook-Signature` header
- **Dead-letter queue**: Failed deliveries after max retries stored for manual review
- **Storage**: `webhooks (id, url, events JSON, secret, active, created_at)` and `webhook_deliveries (id, webhook_id, event_type, payload, status, attempts, last_attempt, created_at)`

### 3. Incoming Webhooks
- **Receiver**: `POST /api/webhooks/incoming/:id` — receive events from external services
- **Verification**: Validate incoming signatures (per-webhook secret)
- **Mapping**: Map incoming payloads to internal events
- **Use cases**: GitHub push events → trigger build task, Slack message → forward to agent

### 4. Event Replay & Monitoring
- **Event log**: Store recent events for debugging and replay
- **Replay**: `POST /api/events/:id/replay` — re-dispatch a past event
- **Monitoring**: Real-time event stream via WebSocket for the UI

### 5. Event Bus API
- `GET /api/webhooks` — list registered webhooks
- `POST /api/webhooks` — register a new webhook
- `PUT /api/webhooks/:id` — update webhook configuration
- `DELETE /api/webhooks/:id` — remove webhook
- `POST /api/webhooks/:id/test` — send test event
- `GET /api/webhooks/:id/deliveries` — delivery history with status
- `POST /api/webhooks/:id/deliveries/:did/retry` — retry a failed delivery
- `GET /api/events?type=...&from=...&to=...` — query event log
- `GET /api/events/stream` — WebSocket real-time event stream

### 6. Event Bus UI
- **Location**: Enhance existing or new "Events" section
- **Features**:
  - Webhook management (register, edit, test, delete)
  - Delivery log with status indicators (delivered, retrying, failed)
  - Real-time event stream viewer
  - Dead-letter queue with retry actions
  - Event type catalog with payload documentation

### Backend Architecture
- `src/services/event-bus.ts` — internal pub/sub event bus
- `src/services/webhook-dispatcher.ts` — outgoing webhook delivery with retry
- `src/services/webhook-receiver.ts` — incoming webhook handler
- `src/webui/routes/events.ts` — API endpoints

### Implementation Steps

1. Implement internal event bus with typed events and async delivery
2. Instrument existing services to emit events (runtime, tools, sessions)
3. Build webhook dispatcher with retry and signing
4. Implement incoming webhook receiver with verification
5. Create dead-letter queue and event log storage
6. Add event replay support
7. Build WebSocket-based real-time event stream
8. Create webhook management API endpoints
9. Build event bus UI with delivery monitoring

### Files to Modify
- `src/services/` — new event bus, webhook dispatcher, and receiver services
- `src/agent/runtime.ts` — emit events for agent actions
- `src/agent/tools/` — emit events for tool execution
- `src/webui/routes/` — add event and webhook endpoints
- `web/src/pages/` — new Events page or enhance existing pages
- `config.example.yaml` — add webhook and event bus config

### Relationship to Existing Work
- Extends `21-api-webhooks.md` with full event-driven architecture
- Complements existing hooks system — hooks are agent-level, event bus is system-level
- Provides infrastructure for v2-15 (Integration Layer) to react to events

### Notes
- **High complexity** — reliable webhook delivery with retry is non-trivial
- Start with the internal event bus first, add webhook delivery second
- Webhook secrets must be stored encrypted (use existing security service)
- Event log storage needs rotation — don't store events forever
- Consider using Server-Sent Events (SSE) as a simpler alternative to WebSocket for the stream
- Rate-limit outgoing webhooks to prevent accidental DDoS of external services
