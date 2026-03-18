# API & Webhooks Management

## Current State

The backend Hono server has internal API routes (`/api/*`) used by the web UI. These are not documented or designed for external consumption. There is no webhook system for external integrations.

## Problem

- External systems cannot interact with the agent programmatically
- No webhook notifications for events
- No API documentation (Swagger/OpenAPI)
- No API key management for external clients
- Cannot integrate with CI/CD, monitoring tools, or other services

## What to Implement

### 1. Public API Layer
- **Separate route prefix**: `/api/v1/*` for versioned public API
- **Authentication**: API key header (`X-API-Key`) with per-key permissions
- **Rate limiting**: Per-key rate limits (configurable)
- **Endpoints**:
  - `POST /api/v1/message` — send message to agent
  - `GET /api/v1/status` — agent status
  - `GET /api/v1/metrics` — usage metrics
  - `POST /api/v1/tools/:name/execute` — execute a tool
  - `GET /api/v1/config` — read configuration
  - `PUT /api/v1/config` — update configuration

### 2. Webhook System
- **Outgoing webhooks**: Agent sends HTTP POST to configured URLs when events occur
- **Events**: message_received, message_sent, tool_executed, agent_started, agent_stopped, error
- **Configuration**: URL, events to subscribe, secret (for HMAC signature verification)
- **Retry**: Retry failed webhook deliveries (3 attempts with exponential backoff)

### 3. API Management Page (`/api-settings` or section in Config)
- **API Keys**: Generate, revoke, list API keys with permissions
- **Webhooks**: Add/edit/delete webhook endpoints
- **Webhook logs**: Show delivery history with status (success/failed)
- **Documentation link**: Link to OpenAPI spec

### 4. API Documentation
- Auto-generate OpenAPI/Swagger spec from Hono routes
- Library: `@hono/zod-openapi` for schema-first API design
- Serve Swagger UI at `/api/docs`

### Backend Requirements
- API key storage: `api_keys (id, key_hash, name, permissions, rate_limit, created_at)`
- Webhook config: `webhooks (id, url, events, secret, enabled, created_at)`
- Webhook log: `webhook_deliveries (id, webhook_id, event, status_code, response, created_at)`
- Webhook delivery service with retry logic

### Implementation Steps

1. Design public API routes with versioning
2. Create API key management service
3. Create webhook delivery service
4. Add OpenAPI spec generation
5. Create API management UI in web frontend
6. Create webhook configuration UI
7. Add webhook delivery logging
8. Add API documentation endpoint

### Notes
- High complexity — significant backend infrastructure
- API versioning is important for backward compatibility
- HMAC signature on webhooks prevents spoofing
- Consider starting with just outgoing webhooks (simpler than full public API)
- Swagger UI can be served as a static page
