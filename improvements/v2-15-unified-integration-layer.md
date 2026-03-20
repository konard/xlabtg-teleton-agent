# Unified Integration Layer

## Current State

The agent integrates with external services through individual tool implementations and the MCP (Model Context Protocol) server system. The `Mcp.tsx` page manages MCP servers, and `21-api-webhooks.md` describes API and webhook management. However, each integration is implemented independently with no shared abstraction for authentication, error handling, rate limiting, or configuration.

## Problem

- Each external integration is built from scratch with its own patterns
- No shared authentication management (OAuth, API keys, tokens)
- No unified error handling across integrations
- Rate limiting is per-integration, not coordinated
- Adding a new integration requires significant boilerplate
- No integration health monitoring or status dashboard
- Cannot compose integrations (e.g., "when Slack message → create Jira ticket")

## What to Implement

### 1. Integration Abstraction Layer
- **Base interface**: All integrations implement a common interface
  ```typescript
  interface Integration {
    id: string;
    name: string;
    type: 'api' | 'webhook' | 'oauth' | 'mcp';
    auth: AuthConfig;
    healthCheck(): Promise<HealthStatus>;
    execute(action: string, params: Record<string, unknown>): Promise<IntegrationResult>;
  }
  ```
- **Built-in integrations**: Telegram (existing), Slack, GitHub, Jira, Notion, Google Workspace, email (SMTP)
- **Custom integrations**: Users define their own via HTTP endpoint configuration

### 2. Authentication Management
- **Supported auth types**: API key, OAuth 2.0, JWT, Basic Auth, custom header
- **Credential storage**: Encrypted in SQLite (extend existing security service)
- **OAuth flow**: Built-in OAuth 2.0 authorization code flow with token refresh
- **Credential rotation**: Auto-refresh expiring tokens, notify on rotation failure
- **Storage**: `integration_credentials (id, integration_id, auth_type, credentials_encrypted, expires_at, created_at)`

### 3. Unified Rate Limiting
- **Per-integration limits**: Configurable requests per minute/hour
- **Global limit**: Total outbound requests across all integrations
- **Backpressure**: Queue requests when approaching limits, reject when exceeded
- **Rate limit sharing**: Coordinate limits across agent instances (for multi-agent, v2-07)

### 4. Integration Registry
- **Storage**: `integrations (id, name, type, config JSON, auth_id FK, status, health_check_url, created_at)`
- **Discovery**: Pre-built integration catalog with setup wizards
- **Health monitoring**: Periodic health checks with status tracking

### 5. Integration Management UI
- **Location**: New "Integrations" page or enhance existing MCP page
- **Features**:
  - Integration catalog with one-click setup
  - OAuth authorization flow (redirect and callback)
  - Per-integration health status and metrics
  - Credential management (rotate, revoke)
  - Integration testing panel ("send test request")
  - Usage statistics per integration

### 6. Integration API
- `GET /api/integrations` — list all configured integrations with status
- `POST /api/integrations` — add new integration
- `PUT /api/integrations/:id` — update integration config
- `DELETE /api/integrations/:id` — remove integration
- `GET /api/integrations/:id/health` — check health
- `POST /api/integrations/:id/test` — send test request
- `POST /api/integrations/:id/execute` — execute an integration action
- `GET /api/integrations/catalog` — list available integration types

### Backend Architecture
- `src/services/integrations/base.ts` — abstract integration interface
- `src/services/integrations/registry.ts` — integration CRUD and discovery
- `src/services/integrations/auth.ts` — authentication management and OAuth
- `src/services/integrations/rate-limiter.ts` — unified rate limiting
- `src/services/integrations/providers/` — individual integration implementations

### Implementation Steps

1. Design integration abstraction interface
2. Implement integration registry with CRUD
3. Build authentication management with encrypted credential storage
4. Implement unified rate limiter
5. Create built-in integration providers (Slack, GitHub, etc.)
6. Add health monitoring with periodic checks
7. Build integration management API endpoints
8. Create integration catalog UI with setup wizards
9. Add OAuth 2.0 flow support

### Files to Modify
- `src/services/integrations/` — new directory for integration layer
- `src/services/security.ts` — extend with credential encryption
- `src/webui/routes/` — add integration endpoints
- `web/src/pages/` — new `Integrations.tsx` page
- `web/src/App.tsx` — add integrations route
- `config.example.yaml` — add integration config section

### Relationship to Existing Work
- Extends concepts from `21-api-webhooks.md`
- Subsumes MCP server management into a broader integration framework
- Provides infrastructure for v2-16 (Webhooks & Event Bus)

### Notes
- **High complexity** — OAuth flows and credential management require careful implementation
- Start with API key-based integrations before adding OAuth
- Credential encryption must be robust — use `crypto.createCipheriv` with proper key management
- Each integration provider can be added incrementally
- Integration health checks should be non-blocking and have short timeouts
- Consider a plugin architecture so community can contribute integration providers
